# Architecture

The service gives each TwakeSpace space a TMail team mailbox. It follows the space and its members from ldap-rest events, and manages the mailbox with TMail's webadmin API. It reports the mail of each team mailbox to the space feed.

## Events consumed

The service reads one quorum queue, bound to four exchanges. The names below are the defaults; [operations](operations.md) lists the settings.

- `space`, routing key `twake.space.#`: published by ldap-rest. The service handles `twake.space.created`, `twake.space.updated` (a rename), `twake.space.deleted`, the member events (added, removed, role changed), `twake.space.synced` and `twake.space.sync.completed`.
- `admin-panel`, routing key `dns.validated`: an organization's mail domain passed DNS validation. Published by the admin panel.
- `b2b`, routing key `domain.user.deleted`: a user was deleted. ldap-rest publishes no space member event for a deleted user.
- `tmail`, routing keys `team-mailbox.message.received` and `team-mailbox.message.sent`: a message was delivered to a team mailbox, or filed in its Sent folder. Published by the team mailbox events plugin of TMail.

The routing key picks the handler. A message with no handler is acked and counted as `ignored`.

```mermaid
flowchart LR
  ldap[ldap-rest] -->|space: twake.space.#| q[(twake-mail-side-service queue)]
  ldap -->|b2b: domain.user.deleted| q
  admin[admin panel] -->|admin-panel: dns.validated| q
  plugin[TMail plugin] -->|tmail: team-mailbox.message.*| q
  q --> svc[mail side service]
  svc -->|webadmin| tmail[TMail]
  svc -->|activity: com.twake.mail.*| space[TwakeSpace]
```

## Provisioning

- The service stores each space, its members and their roles, and each organization's mail domain, since later events only carry ids.
- A space gets its team mailbox once its organization's mail DNS is validated: when the space is created if the DNS event came first, otherwise when the DNS event arrives.
- The address comes from the space name: accents dropped, lowercased, any character other than a letter, a digit, `-` or `_` replaced by `-`, at most 64 characters. When another space or a TMail team mailbox, user or alias holds it, `-2`, `-3` and so on up to `-20` are added. Renaming a space still waiting for its mailbox changes the address it will get; renaming a provisioned space keeps its address.
- The address is stored before the mailbox is created in TMail, so a retry resumes with the same one.
- Admins are managers and editors are members. Viewers get no access, since TMail team mailboxes have no read-only access.
- Once the members are added, the service reads the id of the team mailbox's root mailbox and publishes `com.twake.mail.space.provisioned.v1` with the space id and that id as the mailbox id. It is the JMAP mailbox id the Twake Mail embed opens.
- A deleted user is removed from every team mailbox they were in.
- A malformed event goes straight to the dead letter queue.

```mermaid
sequenceDiagram
  participant R as RabbitMQ
  participant M as mail side service
  participant T as TMail webadmin
  R->>M: twake.space.created
  M->>M: store the space and its members
  R->>M: DNS event, mail validated
  M->>M: store the domain, pick the address
  M->>T: PUT team mailbox, PUT each manager and member
  M->>T: GET its mailboxes, keep the root's id
  M->>R: activity, com.twake.mail.space.provisioned.v1
```

## Deletion

- When a space is deleted, the service removes every member of its team mailbox in TMail. The mailbox and its mail stay, with no one able to open them.
- 30 days later, the service deletes the team mailbox. Until then the space keeps its address, so no other space gets it.
- The service looks for mailboxes due for deletion when it starts and every hour. A deletion TMail fails is tried again at the next run.
- A space deleted before it got a mailbox is simply forgotten.
- Member events and mail of a deleted space are ignored.

## Sync

ldap-rest publishes a snapshot of every space each night, and on request. It repairs what an event lost or a dead letter left behind.

- On `twake.space.synced`, the service makes the team mailbox match the space: its members and roles, read from TMail, so a member added there by hand is removed too. A space it never heard of is stored and provisioned like a created one.
- On `twake.space.sync.completed`, the service closes, as on a deletion, the spaces of the organization the snapshot no longer lists. A space whose last event is newer than the snapshot stays.
- The service keeps the timestamp of the last event it applied to each space and ignores an older one, so a late or redelivered event never undoes a newer change.
- On a start with no space stored, the service requests a sync of every organization, which provisions the spaces created before it was deployed.

## Mail activity

- For each plugin event, the service finds the space by its team address and publishes `com.twake.mail.message.received.v1` or `com.twake.mail.message.sent.v1` on the activity exchange.
- The event's object is the message: its id, its subject as the title (`(no subject)` when empty), and a link that opens it in Twake Mail web. Its container is the root mailbox id announced at provisioning.
- The event id is the mailbox id, the message id and the direction, so a redelivered event is not shown twice.
- The event names no actor and has no preview: the sender of a received mail is not a member, the plugin does not say which member sent a team mail, and viewers have no access to the mailbox.
- Mail of a team mailbox that no space owns is acked and dropped. Mail of a space still being provisioned is retried, since its provisioned event has to come first.

## Ordering and retries

- The queue has single active consumer on, so with several replicas one reads at a time and events are handled in publish order.
- A failing handler runs at most `RABBITMQ_MAX_RETRIES` times in process (attempts, not retries), then the message goes to the dead letter queue `twake-mail-side-service.dlq`. Nobody replays it, since it could apply an old event over newer ones; the next sync repairs the space.
- The source exchanges belong to their publishers, so the service only checks that they exist and fails to start when one is missing.
- After a RabbitMQ reconnect that fails to restore the subscription, the process exits with code 1 so that it is restarted.

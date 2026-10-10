# Events

Every event the service reads or publishes, with the fields it uses. Exchange and routing key names are the defaults; [operations](operations.md) lists the settings that change them.

Payloads are validated on arrival. Fields not listed here are accepted and ignored. A payload that fails validation is logged and dropped, without retries.

## Consumed

All of them land on one queue, `twake-mail-side-service.v2`, and the routing key picks the handler. A routing key with no handler is acked and counted as `unrouted`.

An event with a message id is handled once: its id is recorded in `processed_events` after its handler succeeds, and a copy arriving later is acked untouched. The record is written after the handler's own transactions, so a crash in between runs the handler again. That is safe because handlers are idempotent and skip events older than what they already applied.

### Space events

Exchange `space`, bound with `twake.space.#`.

- `twake.space.created`: `organizationId`, `id` (uuid), `name`, `members` (optional, defaults to none), `timestamp`.
- `twake.space.synced`: same shape as created. `members` is the full list, including members through linked groups.
- `twake.space.updated`: `id`, `name`, `timestamp`. Only the name is read.
- `twake.space.deleted`: `id`, `organizationId` and `timestamp` (both optional).
- `twake.space.member.added`, `twake.space.member.removed`, `twake.space.member.role.changed`: `organizationId`, `id`, `members`, `timestamp`. `members` holds the members the event is about.
- `twake.space.sync.completed`: `organizationId`, `spaceIds` (every space the snapshot listed for the organization), `timestamp`.

A member is `uuid`, `email` and `role` (`viewer`, `editor` or `admin`). Timestamps are ISO 8601 with an offset.

### DNS validation

Exchange `admin-panel`, routing key `dns.validated`: `organizationId`, `domain`, `mailDnsConfigurationValidated` (boolean, false when absent).

### User deletion

Exchange `b2b`, routing key `domain.user.deleted`: `uuid`, the user id.

### Team mail

Exchange `tmail`, routing keys `team-mailbox.message.received` and `team-mailbox.message.sent`: `teamMailbox` (the address), `direction` (`received` or `sent`), `messageId`, `subject` (may be null), `timestamp`. The AMQP message id leaves out the team mailbox, so duplicates are found by `teamMailbox`, `messageId` and `direction` instead.

## Published

Every published message is first written to the `outbox` table, in the transaction that stores what it describes, then sent by the relay. A message can go out twice, after a crash between the broker's confirm and the row's deletion, but always under the same id.

### Activity events

Exchange `activity` (topic, durable, declared on first publish). The routing key is the event type. Events are CloudEvents 1.0:

```json
{
  "specversion": "1.0",
  "id": "…",
  "source": "twake://mail",
  "type": "com.twake.mail.space.provisioned.v1",
  "time": "2026-10-09T08:00:00.000Z",
  "twakeorg": "<organization id>",
  "data": {}
}
```

- `com.twake.mail.space.provisioned.v1`: a space's team mailbox is ready. `data` is `{ "space_id", "resource": { "kind": "mailbox", "id" } }`, where `id` is the JMAP id of the team mailbox's root mailbox. The event id is `<space id>:<mailbox id>:provisioned`, so a republish keeps it.
- `com.twake.mail.message.received.v1` and `com.twake.mail.message.sent.v1`: a message reached the team mailbox or its Sent folder. `data` is `{ "object": { "type": "message", "id", "title", "container": { "kind": "mailbox", "id" } } }`. `title` is the subject, or `(no subject)`. `container.id` is the root mailbox id from the provisioned event. The event id is `<mailbox id>:<message id>:<direction>`, so a redelivered message keeps the same id. `time` is the plugin event's timestamp.

### Sync request

Exchange `space`, routing key `twake.space.sync.requested`, payload `{ "timestamp" }` with no organization. Sent once at startup when the database holds no space, so ldap-rest answers with a `twake.space.synced` for every space.

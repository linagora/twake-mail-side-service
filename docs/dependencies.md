# Dependencies

What the service needs from each system it talks to, and what happens when one is down. The [architecture](architecture.md#context) shows how they connect, [operations](operations.md) lists the settings and [events](events.md) the messages.

## Infrastructure

### RabbitMQ

- The service reads one quorum queue, `twake-mail-side-service.v2`, with a delivery limit of 20, from every replica at once. It declares the queue, its dead letter exchange `twake-mail-side-service.v2.dlx` and the dead letter queue `twake-mail-side-service.v2.dlq`.
- The four source exchanges (`space`, `admin-panel`, `b2b`, `tmail`) must exist before the service starts: it binds to them without declaring them, so their publishers are deployed first.
- It publishes on `activity` and, for the startup sync request, on `space`. The client declares an exchange (topic, durable) on its first publish to it, so `activity` is created by the service.
- When RabbitMQ is unreachable at startup, the client makes 5 connection attempts, then the process exits with code 1. The client reconnects on its own after that; when a reconnect cannot restore the subscription, the process exits with code 1 so that it is restarted.
- The RabbitMQ user's permissions are listed in [operations](operations.md#rabbitmq-permissions).

### PostgreSQL

- The service owns its database and applies its migrations at startup. See [data model](data-model.md).
- It uses a pool of twice `RABBITMQ_PREFETCH` plus 8 connections, and `/health/ready` answers 503 when the database does not answer.
- When PostgreSQL is down, every handler fails: messages are retried, then dead-lettered. [Ordering and retries](architecture.md#ordering-and-retries) says what repairs each kind of dead letter.

## Twake apps

### ldap-rest

- Publishes the space events on `space` ([`spaces.ts`](https://github.com/linagora/ldap-rest/blob/bbd4e47c70779d4479cc93ffdb2aeaaa275509d5/src/plugins/twake/spaces.ts#L1582)): creation, rename, deletion, members, and the nightly snapshot (`twake.space.synced`, then `twake.space.sync.completed` per organization).
- Answers `twake.space.sync.requested` on `space` ([`spaces.ts`](https://github.com/linagora/ldap-rest/blob/bbd4e47c70779d4479cc93ffdb2aeaaa275509d5/src/plugins/twake/spaces.ts#L681-L685)). The service sends one at its first start.
- Publishes `domain.user.deleted` on `b2b` when a user is deleted ([`cozyProvision.ts`](https://github.com/linagora/ldap-rest/blob/bbd4e47c70779d4479cc93ffdb2aeaaa275509d5/src/plugins/twake/cozyProvision.ts#L73-L74), [`clouderyProvision.ts`](https://github.com/linagora/ldap-rest/blob/bbd4e47c70779d4479cc93ffdb2aeaaa275509d5/src/plugins/twake/clouderyProvision.ts#L985)). No space member event is published for a deleted user.

### Admin panel

- Publishes `dns.validated` on `admin-panel` each time it validates an organization's DNS ([`config.ts`](https://github.com/linagora/twake-workplace-private/blob/f23bcec9f89e5badaa173d36ec26c2b68cf6a238/admin-panel-backend/src/utils/config.ts#L35-L36)). Its `RABBITMQ_PUBLISHER_EXCHANGE` and `RABBITMQ_DNS_ROUTING_KEY` must match the service's `RABBITMQ_DNS_EXCHANGE` and `RABBITMQ_DNS_ROUTING_KEY`.
- Runs a validation again on `dns.validation.requested` on `operator` ([`config.ts`](https://github.com/linagora/twake-workplace-private/blob/f23bcec9f89e5badaa173d36ec26c2b68cf6a238/admin-panel-backend/src/utils/config.ts#L62-L65)), which is how organizations validated before the service was deployed get their mailboxes.

### TMail

- Webadmin API ([`TeamMailboxManagementRoutes.java`](https://github.com/linagora/tmail-backend/blob/fba0f98c599f182cde7ab6e8282f6d1a6256ae3f/tmail-backend/webadmin/webadmin-team-mailboxes/src/main/java/com/linagora/tmail/webadmin/TeamMailboxManagementRoutes.java#L124-L127)). The service calls:
  - `GET /domains/{domain}/team-mailboxes`, to see which addresses are taken.
  - `PUT` and `DELETE /domains/{domain}/team-mailboxes/{name}`. A 409 on `PUT` means a user or alias holds the address.
  - `GET /domains/{domain}/team-mailboxes/{name}/members`, and `PUT` (`?role=manager|member`) or `DELETE` on `.../members/{user}`.
  - `GET /domains/{domain}/team-mailboxes/{name}/mailboxes`, to read the root mailbox id.
- The team mailbox events plugin publishes `team-mailbox.message.received` and `team-mailbox.message.sent` on `tmail` ([`TeamMailboxEventsConfiguration.java`](https://github.com/linagora/tmail-backend/blob/fba0f98c599f182cde7ab6e8282f6d1a6256ae3f/tmail-backend/mailbox/plugin/team-mailbox-events/src/main/java/com/linagora/tmail/team/events/TeamMailboxEventsConfiguration.java#L33-L35)). It declares the `tmail` exchange ([`RabbitMQTeamMailboxEventPublisher.java`](https://github.com/linagora/tmail-backend/blob/fba0f98c599f182cde7ab6e8282f6d1a6256ae3f/tmail-backend/mailbox/plugin/team-mailbox-events/src/main/java/com/linagora/tmail/team/events/RabbitMQTeamMailboxEventPublisher.java#L71)), so TMail with the plugin is deployed before the service.
- Each webadmin call has a 10 second timeout and no retry of its own.
  - A timeout, a 401, 403, 408, 429 or a 5xx: the handler is retried, then dead-lettered. A 401 or 403 means the service's password is wrong.
  - A 404: TMail does not have the domain or the team mailbox yet, and the event is parked. Listing or removing the members of a missing team mailbox, and deleting one, are not failures.
  - Any other 4xx dead letters the event at once, since the same call would fail again.
- A failed mailbox deletion is tried again at the next hourly purge.

### TwakeSpace

- Reads the `activity` exchange ([`envelope.ts`](https://github.com/linagora/twake-space/blob/d6a834a8628ba4fe5e37ec47e391c3d7d8442505/apps/backend/src/events/envelope.ts#L3)).
- `com.twake.mail.space.provisioned.v1` stores the mailbox id as the space's mail resource ([`resources.ts`](https://github.com/linagora/twake-space/blob/d6a834a8628ba4fe5e37ec47e391c3d7d8442505/apps/backend/src/modules/spaces/resources.ts#L80)). The other `com.twake.mail.*` events go to the mail feed handler ([`activity.ts`](https://github.com/linagora/twake-space/blob/d6a834a8628ba4fe5e37ec47e391c3d7d8442505/apps/backend/src/modules/feed/activity.ts#L251-L253)).

## Deployment order

1. RabbitMQ and PostgreSQL.
2. ldap-rest, the admin panel, and TMail with the team mailbox events plugin, so the source exchanges exist.
3. The service.

## Libraries

Runtime:

- `@linagora/rabbitmq-client`: connection, reconnects, queue and dead letter declaration, in-process retries.
- `drizzle-orm` over `postgres` (postgres.js): queries and migrations.
- `zod`: configuration and event payload validation.
- `pino`: JSON logs.
- `prom-client`: Prometheus metrics.

Development: TypeScript, `tsx` for `npm run dev`, `vitest` with testcontainers for RabbitMQ and PostgreSQL, `drizzle-kit` to generate migrations, ESLint and Prettier.

The runtime image is Node.js 20 on distroless. See [development](development.md#building-the-image).

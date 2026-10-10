# Operations

## Configuration

Environment variables, validated at startup. The service exits on an invalid value.

- `RABBITMQ_URL` (required): AMQP URL.
- `RABBITMQ_QUEUE` (default `twake-mail-side-service`): the queue the service declares and reads.
- `RABBITMQ_SPACE_EXCHANGE` (default `space`): the space events, read with `twake.space.#`.
- `RABBITMQ_DNS_EXCHANGE` (default `admin-panel`) and `RABBITMQ_DNS_ROUTING_KEY` (default `dns.validated`): the DNS validation event. The service provisions an organization's spaces when its `mailDnsConfigurationValidated` is true. Set these to where the admin panel publishes it.
- `RABBITMQ_USER_DELETED_EXCHANGE` (default `b2b`) and `RABBITMQ_USER_DELETED_ROUTING_KEY` (default `domain.user.deleted`): user deletion.
- `RABBITMQ_MAIL_EXCHANGE` (default `tmail`), `RABBITMQ_MAIL_RECEIVED_ROUTING_KEY` (default `team-mailbox.message.received`) and `RABBITMQ_MAIL_SENT_ROUTING_KEY` (default `team-mailbox.message.sent`): the TMail plugin's team mail events. Match the plugin's `exchange`, `receivedRoutingKey` and `sentRoutingKey` settings.
- `RABBITMQ_PREFETCH` (default 1), `RABBITMQ_MAX_RETRIES` (default 8, handler attempts before the dead letter queue), `RABBITMQ_RETRY_DELAY` in ms (default 1000, the first wait), `RABBITMQ_MAX_RETRY_DELAY` in ms (default 30000, the cap of a wait that doubles after each attempt). The defaults ride out about a minute and a half of outage.

The queue's delivery limit (20 broker redeliveries, for example after a crash mid-message) and single active consumer are fixed in code. RabbitMQ refuses to redeclare a queue with different arguments, so change them with a policy.

- `RABBITMQ_ACTIVITY_EXCHANGE` (default `activity`): where the service publishes its `com.twake.mail.*` events.
- `OUTBOX_INTERVAL_MS` (default 1000): how often the relay looks for pending messages in the outbox. Each run sends everything pending.
- `PARKING_INTERVAL_MS` (default 5000): how often parked events are replayed. `PARKING_MAX_WAIT_MS` (default 600000): how long an event stays parked before it goes to the dead letter queue.
- `DATABASE_URL` (required): PostgreSQL URL. The service applies its migrations at startup.
- `TMAIL_WEBADMIN_URL` (required): TMail's webadmin, for example `http://tmail-admin.tmail.svc.cluster.local:8000`.
- `TMAIL_WEBADMIN_PASSWORD` (optional): sent as the `Password` header when webadmin asks for one.
- `LOG_LEVEL` (default `info`), `HEALTH_PORT` (default 8080), `SHUTDOWN_TIMEOUT_MS` (default 10000).

## RabbitMQ permissions

The user in `RABBITMQ_URL` needs:

- `read` on the four source exchanges. They must exist before the service starts, so TMail with its plugin is deployed first.
- `configure` and `write` on the `space` exchange, to request a sync of every organization when its database holds no space yet. The client declares the exchange on its first publish, which takes `configure` even though it already exists.
- `configure`, `write` and `read` on the `twake-mail-side-service` queue, its `.dlq` twin and the `twake-mail-side-service.dlx` exchange, which the service declares.
- `configure` and `write` on the `activity` exchange, which the service declares (topic, durable) on its first publish.

## Organizations validated before the first deployment

The admin panel publishes the DNS event only when a validation runs. The service never hears about an organization whose mail DNS was validated before it was deployed, and that organization's spaces wait. After the first deployment, ask the admin panel to validate those organizations again, for example by publishing `dns.validation.requested` on its `operator` exchange.

## Spaces created before the first deployment

On a start with no space stored, the service publishes `twake.space.sync.requested` on `space` with no organization, and ldap-rest answers with a `twake.space.synced` for every space. To repair one organization or one space later, publish `twake.space.sync.requested` with `{"organizationId"}` or `{"organizationId", "id"}`.

## A space whose address is already a team mailbox

The service logs `<address> is a team mailbox no space holds, store it as space <space id>'s address to use it`, and the event goes to the dead letter queue. A DNS event may carry another space's error there instead, so search the logs. The service does not know that mailbox, for example because it was created by hand or the space's row was lost. If it is the space's mailbox, store its address and request a sync of that space:

```sql
UPDATE spaces SET address = lower('<address>') WHERE space_id = '<space id>';
```

The sync makes the mailbox's members those of the space, removing anyone else, and publishes its id. If it is not the space's, rename the space so it gets another address, or delete the mailbox, then request a sync of that space.

## Endpoints

- `GET /healthz`: the process is alive.
- `GET /readyz`: the consumer is subscribed and PostgreSQL answers. 503 with a `reason` otherwise.
- `GET /metrics`: Prometheus metrics.

## Metrics

- `tmss_messages_processed_total{event,outcome}`: one per handler attempt. `event` is the routing key, `outcome` is `handled`, `ignored`, `parked` or `failed`.
- `tmss_message_latency_seconds{event,outcome}`: handling time.
- `tmss_outbox_pending`: messages written to the outbox and not yet confirmed by RabbitMQ. Zero in steady state.
- `tmss_parked_events`: events waiting for an object a later event may bring. Zero in steady state.
- The default Node.js process metrics.

Alert on a growing `twake-mail-side-service.dlq`, on `outcome="failed"` rising, on `tmss_outbox_pending` above zero for more than a minute, and on `tmss_parked_events` above zero for longer than `PARKING_MAX_WAIT_MS`. The relay sends the outbox in order and stops at the first message the broker refuses, so one message it can never publish (for example on an exchange the service may not write to) holds back every event after it. Its logs name that message.

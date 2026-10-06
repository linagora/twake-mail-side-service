# Operations

## Configuration

Environment variables, validated at startup. The service exits on an invalid value.

- `RABBITMQ_URL` (required): AMQP URL.
- `RABBITMQ_QUEUE` (default `twake-mail-side-service`): the queue the service declares and reads.
- `RABBITMQ_SPACE_EXCHANGE` (default `space`): the space events, read with `twake.space.#`.
- `RABBITMQ_DNS_EXCHANGE` (default `admin-panel`) and `RABBITMQ_DNS_ROUTING_KEY` (default `dns.validated`): the DNS validation event. The service provisions an organization's spaces when its `mailDnsConfigurationValidated` is true. Set these to where the admin panel publishes it.
- `RABBITMQ_USER_DELETED_EXCHANGE` (default `b2b`) and `RABBITMQ_USER_DELETED_ROUTING_KEY` (default `domain.user.deleted`): user deletion.
- `RABBITMQ_MAIL_EXCHANGE` (default `tmail`), `RABBITMQ_MAIL_RECEIVED_ROUTING_KEY` (default `team-mailbox.message.received`) and `RABBITMQ_MAIL_SENT_ROUTING_KEY` (default `team-mailbox.message.sent`): the TMail plugin's team mail events. Match the plugin's `exchange`, `receivedRoutingKey` and `sentRoutingKey` settings.
- `RABBITMQ_PREFETCH` (default 1), `RABBITMQ_MAX_RETRIES` (default 5, handler attempts before the dead letter queue), `RABBITMQ_RETRY_DELAY` in ms (default 1000).

The queue's delivery limit (20 broker redeliveries, for example after a crash mid-message) and single active consumer are fixed in code. RabbitMQ refuses to redeclare a queue with different arguments, so change them with a policy.

- `RABBITMQ_ACTIVITY_EXCHANGE` (default `activity`): where the service publishes its `com.twake.mail.*` events.
- `DATABASE_URL` (required): PostgreSQL URL. The service applies its migrations at startup.
- `TMAIL_WEBADMIN_URL` (required): TMail's webadmin, for example `http://tmail-admin.tmail.svc.cluster.local:8000`.
- `TMAIL_WEBADMIN_PASSWORD` (optional): sent as the `Password` header when webadmin asks for one.
- `TMAIL_WEB_URL` (required): Twake Mail web, for example `https://mail.example.com`. The feed links each mail to `<TMAIL_WEB_URL>/dashboard/<message id>?type=normal`.
- `LOG_LEVEL` (default `info`), `HEALTH_PORT` (default 8080), `SHUTDOWN_TIMEOUT_MS` (default 10000).

## RabbitMQ permissions

The user in `RABBITMQ_URL` needs:

- `read` on the four source exchanges. They must exist before the service starts, so TMail with its plugin is deployed first.
- `write` on the `space` exchange, to request a sync of every organization when its database holds no space yet.
- `configure`, `write` and `read` on the `twake-mail-side-service` queue, its `.dlq` twin and the `twake-mail-side-service.dlx` exchange, which the service declares.
- `configure` and `write` on the `activity` exchange, which the service declares (topic, durable) on its first publish.

## Organizations validated before the first deployment

The admin panel publishes the DNS event only when a validation runs. The service never hears about an organization whose mail DNS was validated before it was deployed, and that organization's spaces wait. After the first deployment, ask the admin panel to validate those organizations again, for example by publishing `dns.validation.requested` on its `operator` exchange.

## Spaces created before the first deployment

On a start with no space stored, the service publishes `twake.space.sync.requested` on `space` with no organization, and ldap-rest answers with a `twake.space.synced` for every space. To repair one organization or one space later, publish `twake.space.sync.requested` with `{"organizationId"}` or `{"organizationId", "id"}`.

## Endpoints

- `GET /healthz`: the process is alive.
- `GET /readyz`: the consumer is subscribed and PostgreSQL answers. 503 with a `reason` otherwise.
- `GET /metrics`: Prometheus metrics.

## Metrics

- `tmss_messages_processed_total{event,outcome}`: one per handler attempt. `event` is the routing key, `outcome` is `handled`, `ignored` or `failed`.
- `tmss_message_latency_seconds{event,outcome}`: handling time.
- The default Node.js process metrics.

Alert on a growing `twake-mail-side-service.dlq`, and on `outcome="failed"` rising.

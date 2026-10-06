# Operations

## Configuration

Environment variables, validated at startup. The service exits on an invalid value.

- `RABBITMQ_URL` (required): AMQP URL.
- `RABBITMQ_QUEUE` (default `twake-mail-side-service`): the queue the service declares and reads.
- `RABBITMQ_SPACE_EXCHANGE` (default `space`), `RABBITMQ_ADMIN_PANEL_EXCHANGE` (default `admin-panel`), `RABBITMQ_B2B_EXCHANGE` (default `b2b`): the source exchanges.
- `RABBITMQ_PREFETCH` (default 1), `RABBITMQ_MAX_RETRIES` (default 5), `RABBITMQ_RETRY_DELAY` in ms (default 1000).
- `RABBITMQ_DELIVERY_LIMIT` (default 20): broker redeliveries before a message is dead-lettered, for example after a crash mid-message.
- `DATABASE_URL` (required): PostgreSQL URL.
- `LOG_LEVEL` (default `info`), `HEALTH_PORT` (default 8080), `SHUTDOWN_TIMEOUT_MS` (default 10000).

## RabbitMQ permissions

The user in `RABBITMQ_URL` needs:

- `read` on the `space`, `admin-panel` and `b2b` exchanges. They must exist before the service starts.
- `configure`, `write` and `read` on the `twake-mail-side-service` queue, its `.dlq` twin and the `twake-mail-side-service.dlx` exchange, which the service declares.

## Endpoints

- `GET /healthz`: the process is alive.
- `GET /readyz`: the consumer is subscribed and PostgreSQL answers. 503 with a `reason` otherwise.
- `GET /metrics`: Prometheus metrics.

## Metrics

- `tmss_messages_processed_total{event,outcome}`: one per handler attempt. `event` is the routing key, `outcome` is `handled`, `ignored` or `failed`.
- `tmss_message_latency_seconds{event,outcome}`: handling time.
- The default Node.js process metrics.

Alert on a growing `twake-mail-side-service.dlq`, and on `outcome="failed"` rising.

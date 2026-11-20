# twake-mail-side-service

> [!WARNING]
> This service is no longer used and the repository is archived. TMail 1.0.23 replaces it with its Twake Space extension: see the [feature](https://github.com/linagora/tmail-backend/blob/022c11c78c1af524264e8d14b89bf09348dcea54/docs/modules/ROOT/pages/tmail-backend/features/twake-space.adoc) and its [configuration](https://github.com/linagora/tmail-backend/blob/022c11c78c1af524264e8d14b89bf09348dcea54/docs/modules/ROOT/pages/tmail-backend/configure/twake-space.adoc).

Gives each TwakeSpace space a TMail team mailbox, keeps its members in step with the space, and reports the mailbox's mail to the space feed.

## Quick start

```sh
npm install
npm run test:unit         # npm test also runs the integration tests, which need Docker
```

[Running locally](docs/development.md#running-locally) starts the service against Docker RabbitMQ and PostgreSQL. The service reads its configuration from the environment only; [operations](docs/operations.md#configuration) lists every variable.

## Documentation

- [Architecture](docs/architecture.md): the systems around the service, its parts, startup, ordering and retries.
- [Team mailboxes](docs/team-mailboxes.md): provisioning, members, deletion, sync and mail activity.
- [Events](docs/events.md): every event consumed and published.
- [Data model](docs/data-model.md): tables and migrations.
- [Dependencies](docs/dependencies.md): what the service needs from each system it talks to, and its libraries.
- [Operations](docs/operations.md): configuration, permissions, probes, metrics, alerts and repairs.
- [Development](docs/development.md): project layout, checks, running locally, releasing.

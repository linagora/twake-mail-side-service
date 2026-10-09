# twake-mail-side-service

Gives each TwakeSpace space a TMail team mailbox, keeps its members in step with the space, and reports the mailbox's mail to the space feed.

## Quick start

```sh
npm install
npm run test:unit         # npm test also runs the integration tests, which need Docker
```

[Running locally](docs/running-locally.md) starts the service against Docker RabbitMQ and PostgreSQL. The service reads its configuration from the environment only; [Operations](docs/operations.md#configuration) lists every variable.

## Documentation

- [Architecture](docs/architecture.md): the systems around the service, its parts, startup, ordering and retries.
- [Dependencies](docs/dependencies.md): what the service needs from each system it talks to, and its libraries.
- [Events](docs/events.md): every event consumed and published.
- [Team mailboxes](docs/team-mailboxes.md): provisioning, members, deletion, sync and mail activity.
- [Data model](docs/data-model.md): tables and migrations.
- [Operations](docs/operations.md): configuration, permissions, endpoints, metrics and repairs.
- [Development](docs/development.md): project layout, checks, releasing.

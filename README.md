# twake-mail-side-service

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

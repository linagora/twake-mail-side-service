# twake-mail-side-service

Gives each TwakeSpace space a TMail team mailbox, and publishes the mailbox's activity to the space feed. The design is in ADR 005 (Mail side service) and ADR 006 (activity events) of the TwakeSpace architecture.

## Quick start

```sh
npm install
cp .env.example .env  # then edit
npm run dev
npm run test:unit  # npm test also runs the integration tests, which need Docker
```

## Documentation

- [Architecture](docs/architecture.md): what the service does and how events flow.
- [Operations](docs/operations.md): configuration, RabbitMQ and database permissions, endpoints and metrics.
- [Development](docs/development.md): project layout, tests, releasing.
- [Running locally](docs/running-locally.md): run the service against Docker RabbitMQ and PostgreSQL.

# twake-mail-side-service

Gives each TwakeSpace space a TMail team mailbox and keeps its members in step with the space.

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

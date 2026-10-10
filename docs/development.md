# Development

## Prerequisites

- Node.js 20 or newer.
- Docker, for the integration tests (testcontainers).

## Project layout

```
src/
  index.ts            Entrypoint: config, wiring, health server, graceful shutdown
  config.ts           Environment parsing with zod
  consumers/index.ts  The queue, its bindings and its arguments
  consumers/router.ts Routing key to handler
  spaces/events.ts    Event payload schemas
  spaces/service.ts   Provisioning and membership
  mail/service.ts     Team mail to activity events
  mailbox/address.ts  Team mailbox name from the space name
  clients/tmail.ts    TMail webadmin client
  activity.ts         Events published on the activity exchange
  outbox.ts           Outbox writes and the relay that publishes them
  db.ts               drizzle over postgres-js, migrations at startup
  schema.ts           Database tables
  health.ts           /healthz, /readyz, /metrics
  metrics.ts          prom-client registry
  logger.ts           pino
drizzle/              Generated migrations
tests/
  unit/               No Docker
  integration/        testcontainers: RabbitMQ and PostgreSQL
```

## Database changes

Edit `src/schema.ts`, then generate the migration with `npm run db:generate` and commit it with the change.

## Checks

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration  # needs Docker
npm run build
```

CI runs lint, typecheck, all tests and the build on every pull request.

## Building the image

```sh
docker build -t twake-mail-side-service:dev .
```

The runtime image is `gcr.io/distroless/nodejs20-debian12:nonroot`: no shell, no package manager, no root user.

## Releasing

1. Bump the version in `package.json`.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The release workflow publishes `ghcr.io/<owner>/twake-mail-side-service:vX.Y.Z` and a GitHub release. Every push to `main` publishes `latest`.

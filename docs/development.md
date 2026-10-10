# Development

## Prerequisites

- Node.js 20 or newer.
- Docker, for the integration tests (testcontainers).

## Project layout

```
src/
  main.ts                     Entrypoint: config, wiring, health server, graceful shutdown
  config.ts                   Environment parsing with zod
  infra/
    rabbitmq.ts               The queue, its bindings and its arguments
    db.ts                     drizzle over postgres-js, migrations at startup
    health.ts                 /healthz, /readyz, /metrics
    metrics.ts                prom-client registry
    logger.ts                 pino
  product/
    port.ts                   The TMail interface the logic depends on
    api.ts                    Its webadmin adapter
  events/
    router.ts                 Routing key to handler
    activity.ts               Events published on the activity exchange
    outbox.ts                 Outbox writes and the relay that publishes them
    parking.ts                Events that wait for a later one, and their replay
    schema.ts                 The outbox and parked events tables
  modules/
    spaces/                   Provisioning and membership: events, service, address, schema
    mail/                     Team mail to activity events
  testing/helpers.ts          Shared test helpers
drizzle/                      Generated migrations
```

Tests sit next to the code: `*.spec.ts` need no Docker, `*.int.spec.ts` run RabbitMQ and PostgreSQL in testcontainers.

## Database changes

Edit the `schema.ts` of the module or of `events/`, then generate the migration with `npm run db:generate` and commit it with the change.

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

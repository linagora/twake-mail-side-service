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
  db.ts               drizzle over postgres-js
  health.ts           /healthz, /readyz, /metrics
  metrics.ts          prom-client registry
  logger.ts           pino
tests/
  unit/               No Docker
  integration/        testcontainers: RabbitMQ
```

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

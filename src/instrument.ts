import { readFileSync } from 'node:fs';
import * as Sentry from '@sentry/node';

const { name, version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };

// Loaded with --import, before main.ts, so Sentry can instrument the modules main.ts loads.
// Sentry reads SENTRY_DSN and SENTRY_ENVIRONMENT itself. Without SENTRY_DSN, nothing is sent.
Sentry.init({
  release: `${name}@${version}`,
  initialScope: { tags: { service: name } },
});

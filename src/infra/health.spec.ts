import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger as logger } from '../testing/helpers.js';
import { createHealthServer, type HealthServer } from './health.js';
import { createMetrics } from './metrics.js';

let server: HealthServer | undefined;
let ports = { health: 0, metrics: 0 };
let clock = 0;

interface State {
  ready?: boolean;
  ping?: () => Promise<void>;
  busySince?: number;
}

const start = async ({ ready = true, ping = async () => {}, busySince }: State = {}) => {
  const state = { ready, busySince };
  server = createHealthServer({
    port: 0,
    metricsPort: 0,
    consumer: { isReady: () => state.ready },
    busySince: () => state.busySince,
    db: { ping },
    metrics: createMetrics(),
    logger,
    now: () => clock,
  });
  ports = await server.start();
  return state;
};

const get = (path: string, port = ports.health) => fetch(`http://localhost:${port}${path}`);

describe('health server', () => {
  afterEach(async () => {
    await server?.stop();
    clock = 0;
  });

  it('is live and ready when the consumer is subscribed and the database answers', async () => {
    await start();
    expect((await get('/health/live')).status).toBe(200);
    expect((await get('/health/ready')).status).toBe(200);
  });

  it('is not ready before the consumer subscribes', async () => {
    await start({ ready: false });
    const res = await get('/health/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: 'consumer_not_connected' });
  });

  it('is not ready when the database is down', async () => {
    await start({
      ping: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await get('/health/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: 'db_unreachable' });
  });

  it('stays live through a short disconnection, not a long one', async () => {
    const state = await start({ ready: false });
    expect((await get('/health/live')).status).toBe(200);

    clock = 30_000;
    expect((await get('/health/live')).status).toBe(200);

    clock = 61_000;
    const res = await get('/health/live');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: 'consumer_disconnected' });

    state.ready = true;
    expect((await get('/health/live')).status).toBe(200);
  });

  it('is not live when a message has been in hand for over ten minutes', async () => {
    const state = await start({ busySince: 0 });
    clock = 9 * 60_000;
    expect((await get('/health/live')).status).toBe(200);

    clock = 11 * 60_000;
    const res = await get('/health/live');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: 'consumer_stuck' });

    state.busySince = undefined;
    expect((await get('/health/live')).status).toBe(200);
  });

  it('serves the metrics on their own port only', async () => {
    await start();
    const res = await get('/metrics', ports.metrics);
    expect(await res.text()).toContain('tmss_messages_processed_total');
    expect((await get('/metrics')).status).toBe(404);
  });
});

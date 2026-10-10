import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger as logger } from '../testing/helpers.js';
import { createHealthServer, type HealthServer } from './health.js';
import { createMetrics } from './metrics.js';

let server: HealthServer | undefined;
let port = 0;

const start = async (ready: boolean, ping: () => Promise<void>) => {
  server = createHealthServer({
    port: 0,
    consumer: { isReady: () => ready },
    db: { ping },
    metrics: createMetrics(),
    logger,
  });
  port = await server.start();
};

const get = (path: string) => fetch(`http://localhost:${port}${path}`);

describe('health server', () => {
  afterEach(async () => {
    await server?.stop();
  });

  it('is ready when the consumer is subscribed and the database answers', async () => {
    await start(true, async () => {});
    expect((await get('/readyz')).status).toBe(200);
    expect((await get('/healthz')).status).toBe(200);
  });

  it('is not ready before the consumer subscribes', async () => {
    await start(false, async () => {});
    const res = await get('/readyz');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: 'consumer_not_connected' });
  });

  it('is not ready when the database is down', async () => {
    await start(true, async () => {
      throw new Error('connection refused');
    });
    const res = await get('/readyz');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: 'db_unreachable' });
  });

  it('serves the metrics', async () => {
    await start(true, async () => {});
    expect(await (await get('/metrics')).text()).toContain('tmss_messages_processed_total');
  });
});

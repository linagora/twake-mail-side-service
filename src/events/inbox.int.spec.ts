import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClient, type DbClient } from '../infra/db.js';
import { createInbox } from './inbox.js';

const DAY = 24 * 60 * 60 * 1000;
const body = { id: 'space-1' };
const props = (messageId?: string) => ({
  exchange: 'space',
  routingKey: 'twake.space.created',
  headers: {},
  messageId,
});

let container: StartedPostgreSqlContainer;
let client: DbClient;

const inbox = () => createInbox({ db: client.db, lock: client.withLock });

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  client = createDbClient(container.getConnectionUri());
  await client.migrate();
}, 120_000);

afterAll(async () => {
  await client?.close();
  await container?.stop();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE processed_events`);
});

describe('inbox', () => {
  it('handles a message id once', async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const handler = inbox().wrap(handle);

    await expect(handler(body, props('m1'))).resolves.toBeUndefined();
    await expect(handler(body, props('m1'))).resolves.toBe('duplicate');
    await handler(body, props('m2'));

    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('handles once two copies of a message delivered at the same time', async () => {
    const handle = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    const handler = inbox().wrap(handle);

    await Promise.all([handler(body, props('m1')), handler(body, props('m1'))]);

    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('handles once a message by the key its handler gives', async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const handler = inbox().wrap(handle, (message) => ({
      source: 'tmail',
      id: (message as { id: string }).id,
    }));

    await handler({ id: 'a' }, props('m1'));
    await handler({ id: 'a' }, props('m2'));
    await handler({ id: 'b' }, props('m3'));

    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('handles a message without an id every time', async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const handler = inbox().wrap(handle);

    await handler(body, props());
    await handler(body, props());

    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('handles a message again after its handler failed', async () => {
    const handle = vi
      .fn()
      .mockRejectedValueOnce(new Error('tmail down'))
      .mockResolvedValue(undefined);
    const handler = inbox().wrap(handle);

    await expect(handler(body, props('m1'))).rejects.toThrow('tmail down');
    await handler(body, props('m1'));
    await handler(body, props('m1'));

    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('forgets message ids older than the retention', async () => {
    const events = inbox();
    const handle = vi.fn().mockResolvedValue(undefined);
    await events.wrap(handle)(body, props('m1'));

    await events.purge(new Date(Date.now() + 6 * DAY));
    await events.wrap(handle)(body, props('m1'));
    await events.purge(new Date(Date.now() + 8 * DAY));
    await events.wrap(handle)(body, props('m1'));

    expect(handle).toHaveBeenCalledTimes(2);
  });
});

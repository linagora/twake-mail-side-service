import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClient, type DbClient } from '../../src/db.js';
import { createOutboxRelay, enqueue, type OutboxMessage } from '../../src/outbox.js';
import { broker, silentLogger } from '../helpers.js';

const message = (n: number): OutboxMessage => ({
  exchange: 'activity',
  routingKey: 'com.twake.mail.message.received.v1',
  messageId: `m${n}`,
  body: { id: `m${n}` },
});

let container: StartedPostgreSqlContainer;
let client: DbClient;

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
  await client.db.execute(sql`TRUNCATE outbox`);
});

const published = (publish: ReturnType<typeof vi.fn>) =>
  publish.mock.calls.map(([, , , options]) => options.messageId);

describe('outbox relay', () => {
  it('publishes pending messages once, in the order they were written', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const relay = createOutboxRelay({
      db: client.db,
      client: broker(publish),
      logger: silentLogger,
    });
    for (const n of [1, 2, 3]) await enqueue(client.db, message(n));

    await relay.relay();
    await relay.relay();

    expect(publish.mock.calls[0]).toEqual([
      'activity',
      'com.twake.mail.message.received.v1',
      { id: 'm1' },
      { messageId: 'm1', maxAttempts: 1 },
    ]);
    expect(published(publish)).toEqual(['m1', 'm2', 'm3']);
  });

  it('drains a backlog in one run', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const relay = createOutboxRelay({
      db: client.db,
      client: broker(publish),
      logger: silentLogger,
    });
    for (let n = 0; n < 250; n++) await enqueue(client.db, message(n));

    await relay.relay();

    expect(publish).toHaveBeenCalledTimes(250);
  });

  it('waits for the broker connection before relaying', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const disconnected = { ...broker(publish), isConnected: () => false };
    await enqueue(client.db, message(1));

    await createOutboxRelay({ db: client.db, client: disconnected, logger: silentLogger }).relay();
    expect(publish).not.toHaveBeenCalled();

    await createOutboxRelay({
      db: client.db,
      client: broker(publish),
      logger: silentLogger,
    }).relay();
    expect(published(publish)).toEqual(['m1']);
  });

  it('publishes nothing a rolled back transaction wrote', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const relay = createOutboxRelay({
      db: client.db,
      client: broker(publish),
      logger: silentLogger,
    });

    await expect(
      client.db.transaction(async (tx) => {
        await enqueue(tx, message(1));
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    await relay.relay();

    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps a message it failed to publish, and those after it, for the next run', async () => {
    const publish = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('broker down'))
      .mockResolvedValue(undefined);
    const relay = createOutboxRelay({
      db: client.db,
      client: broker(publish),
      logger: silentLogger,
    });
    for (const n of [1, 2, 3]) await enqueue(client.db, message(n));

    await relay.relay();
    await relay.relay();

    expect(published(publish)).toEqual(['m1', 'm2', 'm2', 'm3']);
  });

  it('lets a single replica relay at a time', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const slow = vi.fn(() => blocked);
    const fast = vi.fn().mockResolvedValue(undefined);
    const first = createOutboxRelay({
      db: client.db,
      client: broker(slow),
      logger: silentLogger,
    });
    const second = createOutboxRelay({
      db: client.db,
      client: broker(fast),
      logger: silentLogger,
    });
    await enqueue(client.db, message(1));

    const running = first.relay();
    await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce());
    await second.relay();
    release();
    await running;

    expect(fast).not.toHaveBeenCalled();
  });
});

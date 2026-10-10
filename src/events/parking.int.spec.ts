import { DeadLetterError, type RabbitMQMessageHandler } from '@linagora/rabbitmq-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createDbClient, type DbClient } from '../../src/db.js';
import { createParking, NotYetKnownError, parkedCount } from '../../src/parking.js';
import { broker, silentLogger } from '../helpers.js';

const MINUTE = 60_000;
const body = { teamMailbox: 'sales@acme.com', messageId: 'm1' };
const props = {
  exchange: 'tmail',
  routingKey: 'team-mailbox.message.received',
  headers: {},
  messageId: 'm1:received',
};
const notYet = () => new NotYetKnownError('sales@acme.com has no mailbox yet');

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
  await client.db.execute(sql`TRUNCATE parked_events`);
});

const setup = (handler: Mock<RabbitMQMessageHandler>) => {
  const publish = vi.fn().mockResolvedValue(undefined);
  const parking = createParking({
    db: client.db,
    client: broker(publish),
    handlers: { 'team-mailbox.message.received': handler },
    deadLetterQueue: 'twake-mail-side-service.dlq',
    maxWaitMs: 10 * MINUTE,
    logger: silentLogger,
  });
  return { parking, publish };
};

describe('parking', () => {
  it('replays a parked event once the object it needs is known', async () => {
    const handler = vi.fn().mockRejectedValueOnce(notYet()).mockResolvedValue(undefined);
    const { parking } = setup(handler);
    await parking.park(body, props, notYet());

    await parking.retry();
    await parking.retry();
    await parking.retry();

    expect(handler.mock.calls).toEqual([
      [body, props],
      [body, props],
    ]);
  });

  it('counts the events waiting', async () => {
    const { parking } = setup(vi.fn().mockRejectedValue(notYet()));
    await parking.park(body, props, notYet());
    await parking.park(body, props, notYet());

    expect(await parkedCount(client.db)).toBe(2);
  });

  it('replays again a parked event whose replay failed', async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue(undefined);
    const { parking } = setup(handler);
    await parking.park(body, props, notYet());

    await parking.retry();
    await parking.retry();
    await parking.retry();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('dead letters at once an event its replay rejects', async () => {
    const { parking, publish } = setup(vi.fn().mockRejectedValue(new DeadLetterError('bad')));
    await parking.park(body, props, notYet());

    await parking.retry();

    expect(publish).toHaveBeenCalledOnce();
    expect(await parkedCount(client.db)).toBe(0);
  });

  it('dead letters at once an event no handler takes any more', async () => {
    const { parking, publish } = setup(vi.fn());
    await parking.park(body, { ...props, routingKey: 'team-mailbox.message.moved' }, notYet());

    await parking.retry();

    expect(publish).toHaveBeenCalledOnce();
    expect(await parkedCount(client.db)).toBe(0);
  });

  it('dead letters an event still unknown after the wait', async () => {
    const handler = vi.fn().mockRejectedValue(notYet());
    const { parking, publish } = setup(handler);
    await parking.park(body, props, notYet());

    await parking.retry(new Date(Date.now() + 9 * MINUTE));
    expect(publish).not.toHaveBeenCalled();

    await parking.retry(new Date(Date.now() + 11 * MINUTE));
    await parking.retry(new Date(Date.now() + 12 * MINUTE));

    expect(publish.mock.calls).toEqual([
      [
        '',
        'twake-mail-side-service.dlq',
        body,
        {
          messageId: 'm1:received',
          maxAttempts: 1,
          mandatory: true,
          headers: {
            'x-original-exchange': 'tmail',
            'x-original-routing-key': 'team-mailbox.message.received',
            'x-parked-reason': 'sales@acme.com has no mailbox yet',
          },
        },
      ],
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

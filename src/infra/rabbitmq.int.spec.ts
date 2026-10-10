import { DeadLetterError, RabbitMQClient, silentLogger } from '@linagora/rabbitmq-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { NotYetKnownError } from '../events/errors.js';
import { createParking } from '../events/parking.js';
import { silentLogger as logger } from '../testing/helpers.js';
import { createDbClient, type DbClient } from './db.js';
import { createConsumer, deadLetters, type Consumer } from './rabbitmq.js';

const QUEUE = 'twake-mail-side-service.v2';
// The permissions of the service's user on dev.
const SCOPE = '^(twake-mail-side-service(\\..*)?|activity|space)$';

describe('consumer', () => {
  let container: StartedRabbitMQContainer;
  let postgres: StartedPostgreSqlContainer;
  let db: DbClient;
  let publisher: RabbitMQClient;
  let consumer: Consumer;
  const handler = vi.fn().mockResolvedValue(undefined);

  const admin = async (path: string, init?: RequestInit) => {
    const res = await fetch(
      `http://${container.getHost()}:${container.getMappedPort(15672)}/api/${path}`,
      {
        ...init,
        headers: {
          authorization: `Basic ${btoa('guest:guest')}`,
          'content-type': 'application/json',
        },
      },
    );
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.status === 200 ? res.json() : undefined;
  };
  const deadLettered = async () =>
    ((await admin(`queues/%2F/${QUEUE}.dlq`)) as { messages?: number }).messages ?? 0;

  beforeAll(async () => {
    [container, postgres] = await Promise.all([
      new RabbitMQContainer('rabbitmq:4-management-alpine').start(),
      new PostgreSqlContainer('postgres:17-alpine').start(),
    ]);
    db = createDbClient(postgres.getConnectionUri());
    await db.migrate();

    publisher = new RabbitMQClient({ url: container.getAmqpUrl(), logger: silentLogger });
    await publisher.init();
    // The exchanges belong to ldap-rest, admin-panel and TMail: publishing declares them first.
    for (const exchange of ['space', 'admin-panel', 'b2b', 'tmail']) {
      await publisher.publish(exchange, 'warmup', {});
    }

    const body = (value: object) => ({ method: 'PUT', body: JSON.stringify(value) });
    await admin('users/tmss', body({ password: 'tmss', tags: '' }));
    await admin('permissions/%2F/tmss', body({ configure: SCOPE, write: SCOPE, read: '.*' }));
    const url = new URL(container.getAmqpUrl());
    url.username = 'tmss';
    url.password = 'tmss';

    consumer = createConsumer({
      config: loadConfig({
        RABBITMQ_URL: url.toString(),
        DATABASE_URL: 'postgres://unused',
        TMAIL_WEBADMIN_URL: 'http://unused',
      }),
      logger,
      handler,
    });
    await consumer.start();
  }, 120_000);

  afterAll(async () => {
    await consumer?.stop();
    await publisher?.close();
    await db?.close();
    await Promise.all([container?.stop(), postgres?.stop()]);
  });

  it('receives the space, dns, user deletion and team mail events on one queue', async () => {
    await publisher.publish('space', 'twake.space.created', { id: 's1' });
    await publisher.publish('admin-panel', 'dns.validated', { organizationId: 'o1' });
    await publisher.publish('b2b', 'domain.user.deleted', { uuid: 'u1' });
    await publisher.publish('b2b', 'b2b.member.created', { uuid: 'u2' });
    await publisher.publish('tmail', 'team-mailbox.message.received', { messageId: 'm1' });
    await publisher.publish('tmail', 'team-mailbox.message.sent', { messageId: 'm2' });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(5), { timeout: 10_000 });
    const keys = handler.mock.calls.map(([, props]) => props.routingKey).sort();
    expect(keys).toEqual([
      'dns.validated',
      'domain.user.deleted',
      'team-mailbox.message.received',
      'team-mailbox.message.sent',
      'twake.space.created',
    ]);
    expect(consumer.isReady()).toBe(true);
  });

  it('dead letters an event of any source to the dead letter queue', async () => {
    handler.mockImplementation(async (body: { messageId?: string }) => {
      if (body.messageId === 'dead') throw new DeadLetterError('refused');
    });
    const before = await deadLettered();

    await publisher.publish('tmail', 'team-mailbox.message.received', { messageId: 'dead' });
    await publisher.publish('admin-panel', 'dns.validated', { messageId: 'dead' });

    await vi.waitFor(async () => expect(await deadLettered()).toBe(before + 2), {
      timeout: 15_000,
      interval: 500,
    });
  });

  it('dead letters a parked event whose wait is over to the same queue', async () => {
    const parking = createParking({
      db: db.db,
      tryLock: db.tryLock,
      client: consumer.publisher,
      handlers: {
        'team-mailbox.message.received': vi.fn().mockRejectedValue(new NotYetKnownError('later')),
      },
      deadLetters: deadLetters(QUEUE),
      maxWaitMs: 0,
      logger,
    });
    const before = await deadLettered();
    await parking.park(
      { messageId: 'm3' },
      { exchange: 'tmail', routingKey: 'team-mailbox.message.received', headers: {} },
      new NotYetKnownError('later'),
    );

    await parking.retry();

    await vi.waitFor(async () => expect(await deadLettered()).toBe(before + 1), {
      timeout: 15_000,
      interval: 500,
    });
  });
});

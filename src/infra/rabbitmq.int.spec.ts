import { RabbitMQClient, silentLogger } from '@linagora/rabbitmq-client';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createConsumer, type Consumer } from '../../src/consumers/index.js';
import { silentLogger as logger } from '../helpers.js';

describe('consumer', () => {
  let container: StartedRabbitMQContainer;
  let publisher: RabbitMQClient;
  let consumer: Consumer;
  const handler = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    container = await new RabbitMQContainer('rabbitmq:4-management-alpine').start();
    const url = container.getAmqpUrl();

    publisher = new RabbitMQClient({ url, logger: silentLogger });
    await publisher.init();
    // The exchanges belong to ldap-rest, admin-panel and TMail: publishing declares them first.
    for (const exchange of ['space', 'admin-panel', 'b2b', 'tmail']) {
      await publisher.publish(exchange, 'warmup', {});
    }

    consumer = createConsumer({
      config: loadConfig({
        RABBITMQ_URL: url,
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
    await container?.stop();
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
});

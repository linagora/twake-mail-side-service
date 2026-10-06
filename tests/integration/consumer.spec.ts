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
    // The exchanges belong to ldap-rest and admin-panel: publishing declares them first.
    for (const exchange of ['space', 'admin-panel', 'b2b']) {
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

  it('receives the space, dns and user deletion events on one queue', async () => {
    await publisher.publish('space', 'twake.space.created', { id: 's1' });
    await publisher.publish('admin-panel', 'dns.validated', { organizationId: 'o1' });
    await publisher.publish('b2b', 'domain.user.deleted', { uuid: 'u1' });
    await publisher.publish('b2b', 'b2b.member.created', { uuid: 'u2' });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(3), { timeout: 10_000 });
    const keys = handler.mock.calls.map(([, props]) => props.routingKey).sort();
    expect(keys).toEqual(['dns.validated', 'domain.user.deleted', 'twake.space.created']);
    expect(consumer.isReady()).toBe(true);
  });
});

import type { RabbitMQClientOptions } from '@linagora/rabbitmq-client';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { silentLogger } from '../testing/helpers.js';
import { createConsumer } from './rabbitmq.js';

const options = vi.hoisted(() => ({ last: undefined as RabbitMQClientOptions | undefined }));
const subscribe = vi.hoisted(() => vi.fn());

vi.mock('@linagora/rabbitmq-client', () => ({
  RabbitMQClient: class {
    constructor(opts: RabbitMQClientOptions) {
      options.last = opts;
    }
    isConnected() {
      return true;
    }
    async init() {}
    subscribe = subscribe;
  },
}));

const config = loadConfig({
  RABBITMQ_URL: 'amqp://x',
  DATABASE_URL: 'postgres://x',
  TMAIL_WEBADMIN_URL: 'http://x',
});

describe('createConsumer', () => {
  it('retries a failing handler with a delay that doubles up to a cap', async () => {
    const consumer = createConsumer({
      config: { ...config, RABBITMQ_MAX_RETRIES: 7, RABBITMQ_MAX_RETRY_DELAY: 30_000 },
      logger: silentLogger,
      handler: vi.fn(),
    });

    await consumer.start();

    expect(options.last).toMatchObject({ retryDelay: 1000 });
    expect(subscribe.mock.lastCall?.[4]).toMatchObject({ maxRetries: 7, maxRetryDelay: 30_000 });
  });

  it('lets every replica read the queue, each handling up to its prefetch at once', async () => {
    const consumer = createConsumer({
      config: { ...config, RABBITMQ_PREFETCH: 4 },
      logger: silentLogger,
      handler: vi.fn(),
    });

    await consumer.start();

    expect(options.last).toMatchObject({ prefetch: 4 });
    const [, , queue, , subscription] = subscribe.mock.lastCall!;
    expect(queue).toBe('twake-mail-side-service.v2');
    expect(subscription.concurrency ?? 4).toBe(4);
    expect(subscription.queueArguments).not.toHaveProperty('x-single-active-consumer');
  });

  it('reports a subscription lost when a reconnect fails to restore it', () => {
    const onSubscriptionLost = vi.fn();
    const consumer = createConsumer({
      config,
      logger: silentLogger,
      handler: vi.fn(),
      onSubscriptionLost,
    });

    options.last!.hooks!.onReconnect!({ subscriptionsRestored: 1, subscriptionsFailed: 0 });
    expect(onSubscriptionLost).not.toHaveBeenCalled();

    options.last!.hooks!.onReconnect!({ subscriptionsRestored: 0, subscriptionsFailed: 1 });
    expect(onSubscriptionLost).toHaveBeenCalledOnce();
    expect(consumer.isReady()).toBe(false);
  });
});

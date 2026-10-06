import type { RabbitMQClientOptions } from '@linagora/rabbitmq-client';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config.js';
import { createConsumer } from '../../../src/consumers/index.js';
import { silentLogger } from '../../helpers.js';

const options = vi.hoisted(() => ({ last: undefined as RabbitMQClientOptions | undefined }));

vi.mock('@linagora/rabbitmq-client', () => ({
  RabbitMQClient: class {
    constructor(opts: RabbitMQClientOptions) {
      options.last = opts;
    }
    isConnected() {
      return true;
    }
  },
}));

const config = loadConfig({
  RABBITMQ_URL: 'amqp://x',
  DATABASE_URL: 'postgres://x',
  TMAIL_WEBADMIN_URL: 'http://x',
  TMAIL_WEB_URL: 'http://x',
});

describe('createConsumer', () => {
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

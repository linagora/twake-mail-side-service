import { RabbitMQClient, type RabbitMQMessageHandler } from '@linagora/rabbitmq-client';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

export interface Consumer {
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
}

export interface ConsumerDeps {
  config: Config;
  logger: Logger;
  handler: RabbitMQMessageHandler;
}

export const createConsumer = ({ config, logger, handler }: ConsumerDeps): Consumer => {
  let subscribed = false;
  const client = new RabbitMQClient({
    url: config.RABBITMQ_URL,
    maxRetries: config.RABBITMQ_MAX_RETRIES,
    retryDelay: config.RABBITMQ_RETRY_DELAY,
    prefetch: config.RABBITMQ_PREFETCH,
    closeTimeout: config.SHUTDOWN_TIMEOUT_MS,
    logger,
  });

  return {
    async start() {
      logger.info({ queue: config.RABBITMQ_QUEUE }, 'connecting to RabbitMQ');
      await client.init();
      await client.subscribe(
        config.RABBITMQ_SPACE_EXCHANGE,
        'twake.space.#',
        config.RABBITMQ_QUEUE,
        handler,
        {
          bindings: [
            { exchange: config.RABBITMQ_ADMIN_PANEL_EXCHANGE, routingKey: 'dns.validated' },
            { exchange: config.RABBITMQ_B2B_EXCHANGE, routingKey: 'domain.user.deleted' },
          ],
          deadLetterExchange: `${config.RABBITMQ_QUEUE}.dlx`,
          passiveExchanges: true,
          // Single active consumer keeps one replica reading, so events stay in publish order.
          queueArguments: {
            'x-single-active-consumer': true,
            'x-delivery-limit': config.RABBITMQ_DELIVERY_LIMIT,
          },
          concurrency: 1,
        },
      );
      subscribed = true;
      logger.info('consumer subscribed');
    },
    async stop() {
      subscribed = false;
      await client.close();
    },
    isReady() {
      return subscribed && client.isConnected();
    },
  };
};

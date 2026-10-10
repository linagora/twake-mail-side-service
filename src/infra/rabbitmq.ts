import { RabbitMQClient, type RabbitMQMessageHandler } from '@linagora/rabbitmq-client';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

export interface Consumer {
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
  publisher: Pick<RabbitMQClient, 'publish' | 'isConnected'>;
}

export interface ConsumerDeps {
  config: Config;
  logger: Logger;
  handler: RabbitMQMessageHandler;
  onSubscriptionLost?: () => void;
}

export const createConsumer = ({
  config,
  logger,
  handler,
  onSubscriptionLost,
}: ConsumerDeps): Consumer => {
  let subscribed = false;
  const client = new RabbitMQClient({
    url: config.RABBITMQ_URL,
    maxRetries: config.RABBITMQ_MAX_RETRIES,
    retryDelay: config.RABBITMQ_RETRY_DELAY,
    prefetch: config.RABBITMQ_PREFETCH,
    // Half the budget, so closing the connection and the database still fits before the forced exit.
    closeTimeout: Math.floor(config.SHUTDOWN_TIMEOUT_MS / 2),
    logger,
    hooks: {
      // The client never retries a failed resubscribe, so a restart is the way back.
      onReconnect: ({ subscriptionsFailed }) => {
        subscribed = subscriptionsFailed === 0;
        if (!subscribed) onSubscriptionLost?.();
      },
    },
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
            {
              exchange: config.RABBITMQ_DNS_EXCHANGE,
              routingKey: config.RABBITMQ_DNS_ROUTING_KEY,
            },
            {
              exchange: config.RABBITMQ_USER_DELETED_EXCHANGE,
              routingKey: config.RABBITMQ_USER_DELETED_ROUTING_KEY,
            },
            {
              exchange: config.RABBITMQ_MAIL_EXCHANGE,
              routingKey: config.RABBITMQ_MAIL_RECEIVED_ROUTING_KEY,
            },
            {
              exchange: config.RABBITMQ_MAIL_EXCHANGE,
              routingKey: config.RABBITMQ_MAIL_SENT_ROUTING_KEY,
            },
          ],
          deadLetterExchange: `${config.RABBITMQ_QUEUE}.dlx`,
          passiveExchanges: true,
          // Single active consumer keeps one replica reading, so events stay in publish order.
          // Both are fixed: RabbitMQ refuses to redeclare a queue with different arguments.
          queueArguments: {
            'x-single-active-consumer': true,
            'x-delivery-limit': 20,
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
    publisher: client,
  };
};

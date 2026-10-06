import type { RabbitMQMessageHandler } from '@linagora/rabbitmq-client';
import type { Logger } from '../logger.js';
import type { Metrics } from '../metrics.js';

export interface RouterDeps {
  handlers: Record<string, RabbitMQMessageHandler>;
  logger: Logger;
  metrics: Metrics;
}

// One queue is bound to several exchanges, so the routing key alone picks the handler.
export const createRouter = ({ handlers, logger, metrics }: RouterDeps): RabbitMQMessageHandler => {
  return async (message, properties) => {
    const event = properties.routingKey;
    const started = Date.now();
    const handler = handlers[event];
    if (!handler) {
      logger.debug({ event, exchange: properties.exchange }, 'no handler for routing key');
      metrics.observe(event, 'ignored', Date.now() - started);
      return;
    }
    try {
      await handler(message, properties);
      metrics.observe(event, 'handled', Date.now() - started);
    } catch (err) {
      metrics.observe(event, 'failed', Date.now() - started);
      throw err;
    }
  };
};

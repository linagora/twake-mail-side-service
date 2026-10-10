import type { RabbitMQMessageHandler } from '@linagora/rabbitmq-client';
import type { Logger } from '../infra/logger.js';
import type { Metrics, Outcome } from '../infra/metrics.js';
import { NotYetKnownError, type Parking } from './parking.js';

export interface RouterDeps {
  handlers: Record<string, RabbitMQMessageHandler>;
  park: Parking['park'];
  logger: Logger;
  metrics: Metrics;
}

// One queue is bound to several exchanges, so the routing key alone picks the handler.
export const createRouter = ({
  handlers,
  park,
  logger,
  metrics,
}: RouterDeps): RabbitMQMessageHandler => {
  return async (message, properties) => {
    const event = properties.routingKey;
    const started = Date.now();
    const handler = handlers[event];
    if (!handler) {
      logger.debug({ event, exchange: properties.exchange }, 'no handler for routing key');
      metrics.observe(event, 'ignored', Date.now() - started);
      return;
    }
    let outcome: Outcome = 'failed';
    try {
      await handler(message, properties);
      outcome = 'handled';
    } catch (err) {
      if (!(err instanceof NotYetKnownError)) throw err;
      await park(message, properties, err);
      outcome = 'parked';
    } finally {
      metrics.observe(event, outcome, Date.now() - started);
    }
  };
};

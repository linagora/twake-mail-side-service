import type { RabbitMQMessageHandler } from '@linagora/rabbitmq-client';
import * as Sentry from '@sentry/node';
import type { Logger } from '../infra/logger.js';
import type { Metrics, Outcome } from '../infra/metrics.js';
import { MalformedEventError, NotYetKnownError } from './errors.js';
import type { Parking } from './parking.js';

export interface RouterDeps {
  handlers: Record<string, RabbitMQMessageHandler>;
  park: Parking['park'];
  logger: Logger;
  metrics: Metrics;
}

export type Router = RabbitMQMessageHandler & {
  /** When the oldest message still in hand was received. */
  busySince(): number | undefined;
};

// One queue is bound to several exchanges, so the routing key alone picks the handler.
export const createRouter = ({ handlers, park, logger, metrics }: RouterDeps): Router => {
  const inHand = new Set<{ started: number }>();

  const route: RabbitMQMessageHandler = async (message, properties) => {
    const event = properties.routingKey;
    const started = Date.now();
    const handler = handlers[event];
    if (!handler) {
      logger.debug({ event, exchange: properties.exchange }, 'no handler for routing key');
      metrics.observe(event, 'ignored', Date.now() - started);
      return;
    }
    let outcome: Outcome = 'failed';
    const handling = { started };
    inHand.add(handling);
    try {
      await handler(message, properties);
      outcome = 'handled';
    } catch (err) {
      if (err instanceof MalformedEventError) {
        logger.warn({ event, messageId: properties.messageId, err }, 'malformed event dropped');
        outcome = 'dropped';
        return;
      }
      if (!(err instanceof NotYetKnownError)) {
        Sentry.captureException(err, { tags: { event } });
        throw err;
      }
      await park(message, properties, err);
      outcome = 'parked';
    } finally {
      inHand.delete(handling);
      metrics.observe(event, outcome, Date.now() - started);
    }
  };

  return Object.assign(route, {
    // A Set iterates in insertion order, so its first entry is the oldest.
    busySince: () => inHand.values().next().value?.started,
  });
};

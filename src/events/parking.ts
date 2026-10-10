import {
  DeadLetterError,
  type RabbitMQClient,
  type RabbitMQMessageHandler,
} from '@linagora/rabbitmq-client';
import { asc, count, eq, sql } from 'drizzle-orm';
import type { Db } from '../infra/db.js';
import type { Logger } from '../infra/logger.js';
import { MalformedEventError, NotYetKnownError } from './errors.js';
import type { Handler } from './router.js';
import { parkedEvents } from './schema.js';

export const parkedCount = async (db: Db): Promise<number> => {
  const [row] = await db.select({ n: count() }).from(parkedEvents);
  return row?.n ?? 0;
};

export interface Parking {
  park(...args: [...Parameters<RabbitMQMessageHandler>, NotYetKnownError]): Promise<void>;
  retry(now?: Date): Promise<void>;
  start(intervalMs: number): void;
  stop(): Promise<void>;
}

interface ParkingDeps {
  db: Db;
  client: Pick<RabbitMQClient, 'publish' | 'isConnected'>;
  handlers: Record<string, Handler>;
  deadLetterQueue: string;
  maxWaitMs: number;
  logger: Logger;
}

export const createParking = ({
  db,
  client,
  handlers,
  deadLetterQueue,
  maxWaitMs,
  logger,
}: ParkingDeps): Parking => {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  // The message was acked when parked, so it goes to the queue directly, its headers standing in for x-death.
  const deadLetter = (row: typeof parkedEvents.$inferSelect) =>
    client.publish('', deadLetterQueue, row.body, {
      messageId: row.properties.messageId,
      maxAttempts: 1,
      mandatory: true,
      headers: {
        'x-original-exchange': row.properties.exchange,
        'x-original-routing-key': row.properties.routingKey,
        'x-parked-reason': row.reason,
      },
    });

  const replay = async (row: typeof parkedEvents.$inferSelect, now: Date) => {
    const handler = handlers[row.properties.routingKey];
    try {
      if (!handler) throw new DeadLetterError(`no handler for ${row.properties.routingKey}`);
      await handler(row.body, row.properties);
      await db.delete(parkedEvents).where(eq(parkedEvents.id, row.id));
      logger.info({ messageId: row.properties.messageId }, 'parked event handled');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const waited = now.getTime() - row.parkedAt.getTime();
      if (err instanceof MalformedEventError) {
        await db.delete(parkedEvents).where(eq(parkedEvents.id, row.id));
        logger.warn(
          { messageId: row.properties.messageId, reason },
          'malformed parked event dropped',
        );
        return;
      }
      if (!(err instanceof DeadLetterError) && waited < maxWaitMs) {
        if (!(err instanceof NotYetKnownError)) {
          logger.warn({ err, messageId: row.properties.messageId }, 'parked event replay failed');
        }
        if (reason !== row.reason) {
          await db.update(parkedEvents).set({ reason }).where(eq(parkedEvents.id, row.id));
        }
        return;
      }
      await deadLetter({ ...row, reason });
      await db.delete(parkedEvents).where(eq(parkedEvents.id, row.id));
      logger.warn({ messageId: row.properties.messageId, reason }, 'parked event dead lettered');
    }
  };

  // The transaction-scoped lock keeps a single replica replaying, so no event runs twice at once.
  const retry = (now = new Date()) =>
    db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext('parking')) as locked`,
      );
      if (!lock?.locked) return;
      const parked = await tx.select().from(parkedEvents).orderBy(asc(parkedEvents.id));
      for (const row of parked) {
        await replay(row, now).catch((err) =>
          logger.error({ err, messageId: row.properties.messageId }, 'parked event retry failed'),
        );
      }
    });

  const tick = (intervalMs: number) => {
    running = (client.isConnected() ? retry() : Promise.resolve())
      .catch((err) => logger.error({ err }, 'parked events retry failed'))
      .finally(() => {
        if (timer) timer = setTimeout(() => tick(intervalMs), intervalMs);
      });
  };

  return {
    async park(body, properties, reason) {
      await db.insert(parkedEvents).values({ properties, body, reason: reason.message });
      logger.info({ messageId: properties.messageId, reason: reason.message }, 'event parked');
    },
    retry,
    start(intervalMs) {
      timer = setTimeout(() => tick(intervalMs), intervalMs);
    },
    async stop() {
      clearTimeout(timer);
      timer = undefined;
      await running;
    },
  };
};

import type { RabbitMQMessageHandler, RabbitMQMessageProperties } from '@linagora/rabbitmq-client';
import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../infra/db.js';
import { processedEvents } from './schema.js';

// Longer than any redelivery or parking wait, so a duplicate still finds its row.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type InboxKey = (
  message: unknown,
  properties: RabbitMQMessageProperties,
) => { source: string; id: string } | undefined;

const byMessageId: InboxKey = (_, { messageId }) =>
  messageId ? { source: 'amqp', id: messageId } : undefined;

export interface Inbox {
  wrap(handler: RabbitMQMessageHandler, key?: InboxKey): RabbitMQMessageHandler;
  purge(now?: Date): Promise<void>;
}

// Handlers commit each step as they go, so a crash keeps their progress. The row is written
// once the handler succeeds: a crash in between runs it again, which its idempotent steps allow.
export const createInbox = ({ db }: { db: Db }): Inbox => ({
  wrap:
    (handler, key = byMessageId) =>
    async (message, properties) => {
      const seen = key(message, properties);
      if (seen) {
        const [done] = await db
          .select({ id: processedEvents.id })
          .from(processedEvents)
          .where(and(eq(processedEvents.source, seen.source), eq(processedEvents.id, seen.id)));
        if (done) return;
      }
      await handler(message, properties);
      if (seen) await db.insert(processedEvents).values(seen).onConflictDoNothing();
    },

  async purge(now = new Date()) {
    await db
      .delete(processedEvents)
      .where(lt(processedEvents.processedAt, new Date(now.getTime() - RETENTION_MS)));
  },
});

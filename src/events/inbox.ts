import type { RabbitMQMessageProperties } from '@linagora/rabbitmq-client';
import { and, eq, lt } from 'drizzle-orm';
import type { Db, Lock } from '../infra/db.js';
import type { Handler } from './router.js';
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
  wrap(handler: Handler, key?: InboxKey): Handler;
  purge(now?: Date): Promise<void>;
}

// Handlers commit each step as they go, so a crash keeps their progress. The row is written
// once the handler succeeds: a crash in between runs it again, which its idempotent steps allow.
// The lock makes a copy delivered meanwhile to another replica wait, then find the row.
export const createInbox = ({ db, lock }: { db: Db; lock: Lock }): Inbox => ({
  wrap:
    (handler, key = byMessageId) =>
    async (message, properties) => {
      const seen = key(message, properties);
      if (!seen) return handler(message, properties);
      return lock(`${seen.source}:${seen.id}`, async () => {
        const [done] = await db
          .select({ id: processedEvents.id })
          .from(processedEvents)
          .where(and(eq(processedEvents.source, seen.source), eq(processedEvents.id, seen.id)));
        if (done) return 'duplicate';
        const skipped = await handler(message, properties);
        await db.insert(processedEvents).values(seen).onConflictDoNothing();
        return skipped;
      });
    },

  async purge(now = new Date()) {
    await db
      .delete(processedEvents)
      .where(lt(processedEvents.processedAt, new Date(now.getTime() - RETENTION_MS)));
  },
});

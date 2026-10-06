import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ActivityPublisher } from '../activity.js';
import type { Db } from '../db.js';
import type { Logger } from '../logger.js';
import { spaces } from '../schema.js';
import { parseEvent } from '../spaces/events.js';

export interface MailService {
  messageAdded(body: unknown): Promise<void>;
}

interface MailServiceDeps {
  db: Db;
  activity: ActivityPublisher;
  logger: Logger;
}

const teamMessage = z.looseObject({
  teamMailbox: z.string().min(1),
  direction: z.enum(['received', 'sent']),
  messageId: z.string().min(1),
  subject: z
    .string()
    .nullish()
    .transform((s) => s ?? ''),
  timestamp: z.iso.datetime({ offset: true }),
});

export const createMailService = ({ db, activity, logger }: MailServiceDeps): MailService => ({
  async messageAdded(body) {
    const event = parseEvent(teamMessage, body);
    const [space] = await db
      .select({ organizationId: spaces.organizationId, mailboxId: spaces.mailboxId })
      .from(spaces)
      .where(eq(spaces.address, event.teamMailbox.toLowerCase()));
    if (!space) {
      logger.info({ teamMailbox: event.teamMailbox }, 'mail of a team mailbox no space owns');
      return;
    }
    // Mail can land before the provisioned event is published, and the feed needs that event first, so retry.
    if (!space.mailboxId) {
      throw new Error(`${event.teamMailbox} is still being provisioned`);
    }
    await activity.message({
      organizationId: space.organizationId,
      mailboxId: space.mailboxId,
      direction: event.direction,
      messageId: event.messageId,
      subject: event.subject,
      time: event.timestamp,
    });
  },
});

import type { OutboxMessage } from './outbox.js';

export type MailDirection = 'received' | 'sent';

export interface Activity {
  provisioned(mailbox: {
    organizationId: string;
    spaceId: string;
    mailboxId: string;
  }): OutboxMessage;
  message(mail: {
    organizationId: string;
    mailboxId: string;
    direction: MailDirection;
    messageId: string;
    subject: string;
    time: string;
  }): OutboxMessage;
}

const SOURCE = 'twake://mail';

export const createActivity = (exchange: string): Activity => {
  const event = (
    type: string,
    twakeorg: string,
    data: Record<string, unknown>,
    { id, time = new Date().toISOString() }: { id: string; time?: string },
  ): OutboxMessage => ({
    exchange,
    routingKey: type,
    messageId: id,
    body: { specversion: '1.0', id, source: SOURCE, type, time, twakeorg, data },
  });

  return {
    // The Mail embed opens a team mailbox by its root JMAP mailbox id, so that is the resource id.
    // A space gets one mailbox, so the pair names the event and a republish keeps it.
    provisioned: ({ organizationId, spaceId, mailboxId }) =>
      event(
        'com.twake.mail.space.provisioned.v1',
        organizationId,
        { space_id: spaceId, resource: { kind: 'mailbox', id: mailboxId } },
        { id: `${spaceId}:${mailboxId}:provisioned` },
      ),

    // TwakeSpace deduplicates on the event id, so a redelivered mail keeps the same one.
    // The mailbox id is in it since a copy to another mailbox may keep the message id.
    message: ({ organizationId, mailboxId, direction, messageId, subject, time }) =>
      event(
        `com.twake.mail.message.${direction}.v1`,
        organizationId,
        {
          object: {
            type: 'message',
            id: messageId,
            title: subject.trim() || '(no subject)',
            container: { kind: 'mailbox', id: mailboxId },
          },
        },
        { id: `${mailboxId}:${messageId}:${direction}`, time },
      ),
  };
};

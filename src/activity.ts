import { randomUUID } from 'node:crypto';
import type { RabbitMQClient } from '@linagora/rabbitmq-client';

export type MailDirection = 'received' | 'sent';

export interface ActivityPublisher {
  provisioned(mailbox: {
    organizationId: string;
    spaceId: string;
    mailboxId: string;
  }): Promise<void>;
  message(mail: {
    organizationId: string;
    mailboxId: string;
    direction: MailDirection;
    messageId: string;
    subject: string;
    time: string;
  }): Promise<void>;
}

interface ActivityDeps {
  client: Pick<RabbitMQClient, 'publish'>;
  exchange: string;
  mailWebUrl: string;
}

const SOURCE = 'twake://mail';

export const createActivityPublisher = ({
  client,
  exchange,
  mailWebUrl,
}: ActivityDeps): ActivityPublisher => {
  const webRoot = mailWebUrl.replace(/\/+$/, '');

  const publish = async (
    type: string,
    twakeorg: string,
    data: Record<string, unknown>,
    { id = randomUUID(), time = new Date().toISOString() }: { id?: string; time?: string } = {},
  ) => {
    const event = { specversion: '1.0', id, source: SOURCE, type, time, twakeorg, data };
    await client.publish(exchange, type, event, { messageId: event.id });
  };

  return {
    // The Mail embed opens a team mailbox by its root JMAP mailbox id, so that is the resource id.
    provisioned: ({ organizationId, spaceId, mailboxId }) =>
      publish('com.twake.mail.space.provisioned.v1', organizationId, {
        space_id: spaceId,
        resource: { kind: 'mailbox', id: mailboxId },
      }),

    // TwakeSpace deduplicates on the event id, so a redelivered mail keeps the same one.
    // The mailbox id is in it since a copy to another mailbox may keep the message id.
    message: ({ organizationId, mailboxId, direction, messageId, subject, time }) =>
      publish(
        `com.twake.mail.message.${direction}.v1`,
        organizationId,
        {
          object: {
            type: 'message',
            id: messageId,
            title: subject.trim() || '(no subject)',
            url: `${webRoot}/dashboard/${encodeURIComponent(messageId)}?type=normal`,
            container: { kind: 'mailbox', id: mailboxId },
          },
        },
        { id: `${mailboxId}:${messageId}:${direction}`, time },
      ),
  };
};

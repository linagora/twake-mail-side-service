import { randomUUID } from 'node:crypto';
import type { RabbitMQClient } from '@linagora/rabbitmq-client';

export interface ActivityPublisher {
  provisioned(mailbox: {
    organizationId: string;
    spaceId: string;
    mailboxId: string;
  }): Promise<void>;
}

interface ActivityDeps {
  client: Pick<RabbitMQClient, 'publish'>;
  exchange: string;
}

const SOURCE = 'twake://mail';

export const createActivityPublisher = ({ client, exchange }: ActivityDeps): ActivityPublisher => {
  const publish = async (type: string, twakeorg: string, data: Record<string, unknown>) => {
    const event = {
      specversion: '1.0',
      id: randomUUID(),
      source: SOURCE,
      type,
      time: new Date().toISOString(),
      twakeorg,
      data,
    };
    await client.publish(exchange, type, event, { messageId: event.id });
  };

  return {
    // The Mail embed opens a team mailbox by its root JMAP mailbox id, so that is the resource id.
    provisioned: ({ organizationId, spaceId, mailboxId }) =>
      publish('com.twake.mail.space.provisioned.v1', organizationId, {
        space_id: spaceId,
        resource: { kind: 'mailbox', id: mailboxId },
      }),
  };
};

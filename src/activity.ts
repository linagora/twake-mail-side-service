import { randomUUID } from 'node:crypto';
import type { RabbitMQClient } from '@linagora/rabbitmq-client';

export interface ActivityPublisher {
  provisioned(mailbox: { organizationId: string; spaceId: string; address: string }): Promise<void>;
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
    provisioned: ({ organizationId, spaceId, address }) =>
      publish('com.twake.mail.space.provisioned.v1', organizationId, {
        space_id: spaceId,
        resource: { kind: 'mailbox', id: address },
      }),
  };
};

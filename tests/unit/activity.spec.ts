import { describe, expect, it } from 'vitest';
import { createActivity } from '../../src/activity.js';

const activity = createActivity('activity');

describe('createActivity', () => {
  it('announces a provisioned team mailbox as a CloudEvent, under an id fixed by the space and its mailbox', () => {
    const provisioned = {
      organizationId: 'acme',
      spaceId: '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10',
      mailboxId: '847df6f0-c19d-11f1-9d3a-17ee7235c6d5',
    };

    const message = activity.provisioned(provisioned);

    expect(message).toEqual({
      exchange: 'activity',
      routingKey: 'com.twake.mail.space.provisioned.v1',
      messageId:
        '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10:847df6f0-c19d-11f1-9d3a-17ee7235c6d5:provisioned',
      body: {
        specversion: '1.0',
        id: '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10:847df6f0-c19d-11f1-9d3a-17ee7235c6d5:provisioned',
        source: 'twake://mail',
        type: 'com.twake.mail.space.provisioned.v1',
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        twakeorg: 'acme',
        data: {
          space_id: '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10',
          resource: { kind: 'mailbox', id: '847df6f0-c19d-11f1-9d3a-17ee7235c6d5' },
        },
      },
    });
    expect(activity.provisioned(provisioned).messageId).toBe(message.messageId);
  });

  it('reports a team mail as a CloudEvent with the mailbox as container', () => {
    const message = activity.message({
      organizationId: 'acme',
      mailboxId: '847df6f0-c19d-11f1-9d3a-17ee7235c6d5',
      direction: 'received',
      messageId: '956ee570-c1aa-11f1-bdf6-19e2a75a28cc',
      subject: 'Quarterly numbers',
      time: '2026-10-06T17:23:03.281571409Z',
    });

    expect(message).toEqual({
      exchange: 'activity',
      routingKey: 'com.twake.mail.message.received.v1',
      messageId:
        '847df6f0-c19d-11f1-9d3a-17ee7235c6d5:956ee570-c1aa-11f1-bdf6-19e2a75a28cc:received',
      body: {
        specversion: '1.0',
        id: '847df6f0-c19d-11f1-9d3a-17ee7235c6d5:956ee570-c1aa-11f1-bdf6-19e2a75a28cc:received',
        source: 'twake://mail',
        type: 'com.twake.mail.message.received.v1',
        time: '2026-10-06T17:23:03.281571409Z',
        twakeorg: 'acme',
        data: {
          object: {
            type: 'message',
            id: '956ee570-c1aa-11f1-bdf6-19e2a75a28cc',
            title: 'Quarterly numbers',
            container: { kind: 'mailbox', id: '847df6f0-c19d-11f1-9d3a-17ee7235c6d5' },
          },
        },
      },
    });
  });

  it('gives a mail without subject a title', () => {
    const message = activity.message({
      organizationId: 'acme',
      mailboxId: 'root-id',
      direction: 'sent',
      messageId: 'm1',
      subject: '  ',
      time: '2026-10-06T17:23:03Z',
    });

    expect(message.routingKey).toBe('com.twake.mail.message.sent.v1');
    expect(message.body).toMatchObject({ data: { object: { title: '(no subject)' } } });
  });
});

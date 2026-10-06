import { describe, expect, it, vi } from 'vitest';
import { createActivityPublisher } from '../../src/activity.js';

describe('createActivityPublisher', () => {
  it('announces a provisioned team mailbox as a CloudEvent', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const activity = createActivityPublisher({ client: { publish }, exchange: 'activity' });

    await activity.provisioned({
      organizationId: 'acme',
      spaceId: '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10',
      mailboxId: '847df6f0-c19d-11f1-9d3a-17ee7235c6d5',
    });

    const [exchange, routingKey, event, options] = publish.mock.calls[0]!;
    expect(exchange).toBe('activity');
    expect(routingKey).toBe('com.twake.mail.space.provisioned.v1');
    expect(event).toEqual({
      specversion: '1.0',
      id: expect.any(String),
      source: 'twake://mail',
      type: 'com.twake.mail.space.provisioned.v1',
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      twakeorg: 'acme',
      data: {
        space_id: '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10',
        resource: { kind: 'mailbox', id: '847df6f0-c19d-11f1-9d3a-17ee7235c6d5' },
      },
    });
    expect(options).toEqual({ messageId: event.id });
  });
});

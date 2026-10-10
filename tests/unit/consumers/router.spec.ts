import { describe, expect, it, vi } from 'vitest';
import { createRouter } from '../../../src/consumers/router.js';
import { createMetrics } from '../../../src/metrics.js';
import { NotYetKnownError } from '../../../src/parking.js';
import { silentLogger } from '../../helpers.js';

const props = (routingKey: string) => ({ exchange: 'space', routingKey, headers: {} });

describe('createRouter', () => {
  it('hands a message to the handler of its routing key', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const route = createRouter({
      handlers: { 'twake.space.created': handler },
      park: vi.fn(),
      logger: silentLogger,
      metrics: createMetrics(),
    });

    await route({ id: 's1' }, props('twake.space.created'));

    expect(handler).toHaveBeenCalledWith({ id: 's1' }, props('twake.space.created'));
  });

  it('acks a routing key it has no handler for', async () => {
    const metrics = createMetrics();
    const route = createRouter({ handlers: {}, park: vi.fn(), logger: silentLogger, metrics });

    await expect(route({}, props('twake.space.group.linked'))).resolves.toBeUndefined();

    const ignored = await metrics.messagesProcessed.get();
    expect(ignored.values).toContainEqual(
      expect.objectContaining({
        labels: { event: 'twake.space.group.linked', outcome: 'ignored' },
        value: 1,
      }),
    );
  });

  it('parks a message that needs an object a later event may bring', async () => {
    const metrics = createMetrics();
    const park = vi.fn().mockResolvedValue(undefined);
    const error = new NotYetKnownError('sales@acme.com has no mailbox yet');
    const route = createRouter({
      handlers: { 'team-mailbox.message.received': vi.fn().mockRejectedValue(error) },
      park,
      logger: silentLogger,
      metrics,
    });

    await expect(
      route({ messageId: 'm1' }, props('team-mailbox.message.received')),
    ).resolves.toBeUndefined();

    expect(park).toHaveBeenCalledWith(
      { messageId: 'm1' },
      props('team-mailbox.message.received'),
      error,
    );
    const parked = await metrics.messagesProcessed.get();
    expect(parked.values).toContainEqual(
      expect.objectContaining({
        labels: { event: 'team-mailbox.message.received', outcome: 'parked' },
      }),
    );
  });

  it('counts a message it could not park as failed', async () => {
    const metrics = createMetrics();
    const route = createRouter({
      handlers: {
        'team-mailbox.message.received': vi.fn().mockRejectedValue(new NotYetKnownError('x')),
      },
      park: vi.fn().mockRejectedValue(new Error('database down')),
      logger: silentLogger,
      metrics,
    });

    await expect(route({}, props('team-mailbox.message.received'))).rejects.toThrow(
      'database down',
    );

    const failed = await metrics.messagesProcessed.get();
    expect(failed.values).toContainEqual(
      expect.objectContaining({
        labels: { event: 'team-mailbox.message.received', outcome: 'failed' },
      }),
    );
  });

  it('rethrows a handler error so the client retries the message', async () => {
    const metrics = createMetrics();
    const route = createRouter({
      handlers: { 'dns.validated': vi.fn().mockRejectedValue(new Error('tmail down')) },
      park: vi.fn(),
      logger: silentLogger,
      metrics,
    });

    await expect(route({}, props('dns.validated'))).rejects.toThrow('tmail down');

    const failed = await metrics.messagesProcessed.get();
    expect(failed.values).toContainEqual(
      expect.objectContaining({ labels: { event: 'dns.validated', outcome: 'failed' } }),
    );
  });
});

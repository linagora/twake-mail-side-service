import { describe, expect, it, vi } from 'vitest';
import { createRouter } from '../../../src/consumers/router.js';
import { createMetrics } from '../../../src/metrics.js';
import { silentLogger } from '../../helpers.js';

const props = (routingKey: string) => ({ exchange: 'space', routingKey, headers: {} });

describe('createRouter', () => {
  it('hands a message to the handler of its routing key', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const route = createRouter({
      handlers: { 'twake.space.created': handler },
      logger: silentLogger,
      metrics: createMetrics(),
    });

    await route({ id: 's1' }, props('twake.space.created'));

    expect(handler).toHaveBeenCalledWith({ id: 's1' }, props('twake.space.created'));
  });

  it('acks a routing key it has no handler for', async () => {
    const metrics = createMetrics();
    const route = createRouter({ handlers: {}, logger: silentLogger, metrics });

    await expect(route({}, props('twake.space.group.linked'))).resolves.toBeUndefined();

    const ignored = await metrics.messagesProcessed.get();
    expect(ignored.values).toContainEqual(
      expect.objectContaining({
        labels: { event: 'twake.space.group.linked', outcome: 'ignored' },
        value: 1,
      }),
    );
  });

  it('rethrows a handler error so the client retries the message', async () => {
    const metrics = createMetrics();
    const route = createRouter({
      handlers: { 'dns.validated': vi.fn().mockRejectedValue(new Error('tmail down')) },
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

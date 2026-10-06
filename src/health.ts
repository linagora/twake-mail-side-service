import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from './logger.js';
import type { Metrics } from './metrics.js';

export interface HealthServer {
  /** Resolves with the bound port, so port 0 picks a free one. */
  start(): Promise<number>;
  stop(): Promise<void>;
}

export interface HealthDeps {
  port: number;
  consumer: { isReady(): boolean };
  db: { ping(): Promise<void> };
  metrics: Metrics;
  logger: Logger;
}

const json = (res: ServerResponse, status: number, body: object) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const createHealthServer = ({
  port,
  consumer,
  db,
  metrics,
  logger,
}: HealthDeps): HealthServer => {
  let server: Server | null = null;

  return {
    async start() {
      server = createServer(async (req, res) => {
        try {
          if (req.url === '/healthz') return json(res, 200, { status: 'ok' });
          if (req.url === '/readyz') {
            if (!consumer.isReady()) {
              return json(res, 503, { status: 'not_ready', reason: 'consumer_not_connected' });
            }
            try {
              await db.ping();
            } catch (err) {
              return json(res, 503, {
                status: 'not_ready',
                reason: 'db_unreachable',
                error: err instanceof Error ? err.message : String(err),
              });
            }
            return json(res, 200, { status: 'ready' });
          }
          if (req.url === '/metrics') {
            const body = await metrics.registry.metrics();
            res.writeHead(200, { 'Content-Type': metrics.registry.contentType });
            res.end(body);
            return;
          }
          res.writeHead(404).end();
        } catch (err) {
          logger.error({ err }, 'health endpoint error');
          res.writeHead(500).end();
        }
      });

      await new Promise<void>((resolve) => server!.listen(port, resolve));
      const bound = (server.address() as AddressInfo).port;
      logger.info({ port: bound }, 'health server listening');
      return bound;
    },
    async stop() {
      if (!server) return;
      const closed = new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    },
  };
};

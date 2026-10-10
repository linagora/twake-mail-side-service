import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type Outcome = 'handled' | 'ignored' | 'dropped' | 'parked' | 'failed';

export interface Metrics {
  registry: Registry;
  messagesProcessed: Counter<'event' | 'outcome'>;
  observe(event: string, outcome: Outcome, latencyMs: number): void;
}

interface Counts {
  outboxPending?: () => Promise<number>;
  parked?: () => Promise<number>;
}

export const createMetrics = ({
  outboxPending = async () => 0,
  parked = async () => 0,
}: Counts = {}): Metrics => {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const messagesProcessed = new Counter({
    name: 'tmss_messages_processed_total',
    help: 'Messages processed, by routing key and outcome',
    labelNames: ['event', 'outcome'] as const,
    registers: [registry],
  });

  const messageLatency = new Histogram({
    name: 'tmss_message_latency_seconds',
    help: 'Message processing latency in seconds, by routing key and outcome',
    labelNames: ['event', 'outcome'] as const,
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  new Gauge({
    name: 'tmss_outbox_pending',
    help: 'Messages written to the outbox and not yet confirmed by the broker',
    registers: [registry],
    async collect() {
      this.set(await outboxPending());
    },
  });

  new Gauge({
    name: 'tmss_parked_events',
    help: 'Events waiting for an object a later event may bring',
    registers: [registry],
    async collect() {
      this.set(await parked());
    },
  });

  return {
    registry,
    messagesProcessed,
    observe(event, outcome, latencyMs) {
      messagesProcessed.labels(event, outcome).inc();
      messageLatency.labels(event, outcome).observe(latencyMs / 1000);
    },
  };
};

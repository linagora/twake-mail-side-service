import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type Outcome = 'handled' | 'ignored' | 'failed';

export interface Metrics {
  registry: Registry;
  messagesProcessed: Counter<'event' | 'outcome'>;
  messageLatency: Histogram<'event' | 'outcome'>;
  observe(event: string, outcome: Outcome, latencyMs: number): void;
}

export const createMetrics = (): Metrics => {
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

  return {
    registry,
    messagesProcessed,
    messageLatency,
    observe(event, outcome, latencyMs) {
      messagesProcessed.labels(event, outcome).inc();
      messageLatency.labels(event, outcome).observe(latencyMs / 1000);
    },
  };
};

import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_QUEUE: z.string().default('twake-mail-side-service'),
  RABBITMQ_SPACE_EXCHANGE: z.string().default('space'),
  RABBITMQ_DNS_EXCHANGE: z.string().default('admin-panel'),
  RABBITMQ_DNS_ROUTING_KEY: z.string().default('dns.validated'),
  RABBITMQ_USER_DELETED_EXCHANGE: z.string().default('b2b'),
  RABBITMQ_USER_DELETED_ROUTING_KEY: z.string().default('domain.user.deleted'),
  RABBITMQ_ACTIVITY_EXCHANGE: z.string().default('activity'),
  RABBITMQ_PREFETCH: positiveInt.default(1),
  RABBITMQ_MAX_RETRIES: positiveInt.default(5),
  RABBITMQ_RETRY_DELAY: positiveInt.default(1000),

  DATABASE_URL: z.string().min(1),

  TMAIL_WEBADMIN_URL: z.url(),
  TMAIL_WEBADMIN_PASSWORD: z.string().optional(),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  HEALTH_PORT: positiveInt.default(8080),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(10_000),
});

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (env: Record<string, string | undefined> = process.env): Config => {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

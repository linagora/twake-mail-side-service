import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_QUEUE: z.string().default('twake-mail-side-service'),
  RABBITMQ_SPACE_EXCHANGE: z.string().default('space'),
  RABBITMQ_ADMIN_PANEL_EXCHANGE: z.string().default('admin-panel'),
  RABBITMQ_B2B_EXCHANGE: z.string().default('b2b'),
  RABBITMQ_PREFETCH: positiveInt.default(1),
  RABBITMQ_MAX_RETRIES: positiveInt.default(5),
  RABBITMQ_RETRY_DELAY: positiveInt.default(1000),

  DATABASE_URL: z.string().min(1),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  HEALTH_PORT: positiveInt.default(8080),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(10_000),
});

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (env: Record<string, string | undefined> = process.env): Config => {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return result.data;
};

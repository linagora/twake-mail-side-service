import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const baseEnv = {
  RABBITMQ_URL: 'amqp://localhost',
  DATABASE_URL: 'postgres://localhost/mail',
};

describe('loadConfig', () => {
  it('returns defaults for optional fields', () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.RABBITMQ_QUEUE).toBe('twake-mail-side-service');
    expect(cfg.RABBITMQ_SPACE_EXCHANGE).toBe('space');
    expect(cfg.RABBITMQ_ADMIN_PANEL_EXCHANGE).toBe('admin-panel');
    expect(cfg.RABBITMQ_B2B_EXCHANGE).toBe('b2b');
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.HEALTH_PORT).toBe(8080);
  });

  it('throws when RABBITMQ_URL is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/RABBITMQ_URL/);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ RABBITMQ_URL: 'amqp://x' })).toThrow(/DATABASE_URL/);
  });

  it('coerces numeric env vars', () => {
    const cfg = loadConfig({ ...baseEnv, RABBITMQ_PREFETCH: '10', HEALTH_PORT: '9090' });
    expect(cfg.RABBITMQ_PREFETCH).toBe(10);
    expect(cfg.HEALTH_PORT).toBe(9090);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ...baseEnv, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});

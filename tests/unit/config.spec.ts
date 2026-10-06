import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const baseEnv = {
  RABBITMQ_URL: 'amqp://localhost',
  DATABASE_URL: 'postgres://localhost/mail',
  TMAIL_WEBADMIN_URL: 'http://tmail-admin:8000',
  TMAIL_WEB_URL: 'https://mail.acme.com',
};

describe('loadConfig', () => {
  it('returns defaults for optional fields', () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.RABBITMQ_QUEUE).toBe('twake-mail-side-service');
    expect(cfg.RABBITMQ_SPACE_EXCHANGE).toBe('space');
    expect(cfg.RABBITMQ_DNS_EXCHANGE).toBe('admin-panel');
    expect(cfg.RABBITMQ_DNS_ROUTING_KEY).toBe('dns.validated');
    expect(cfg.RABBITMQ_USER_DELETED_EXCHANGE).toBe('b2b');
    expect(cfg.RABBITMQ_USER_DELETED_ROUTING_KEY).toBe('domain.user.deleted');
    expect(cfg.RABBITMQ_ACTIVITY_EXCHANGE).toBe('activity');
    expect(cfg.RABBITMQ_MAIL_EXCHANGE).toBe('tmail');
    expect(cfg.RABBITMQ_MAIL_RECEIVED_ROUTING_KEY).toBe('team-mailbox.message.received');
    expect(cfg.RABBITMQ_MAIL_SENT_ROUTING_KEY).toBe('team-mailbox.message.sent');
    expect(cfg.TMAIL_WEBADMIN_PASSWORD).toBeUndefined();
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.HEALTH_PORT).toBe(8080);
  });

  it('throws when RABBITMQ_URL is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/RABBITMQ_URL/);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ RABBITMQ_URL: 'amqp://x' })).toThrow(/DATABASE_URL/);
  });

  it('throws when TMAIL_WEBADMIN_URL is not a URL', () => {
    expect(() => loadConfig({ ...baseEnv, TMAIL_WEBADMIN_URL: 'tmail-admin' })).toThrow(
      /TMAIL_WEBADMIN_URL/,
    );
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

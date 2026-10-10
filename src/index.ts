import { randomUUID } from 'node:crypto';
import { createActivity } from './activity.js';
import { createTmailClient } from './clients/tmail.js';
import { loadConfig } from './config.js';
import { createConsumer } from './consumers/index.js';
import { createRouter } from './consumers/router.js';
import { createDbClient } from './db.js';
import { createHealthServer } from './health.js';
import { logger } from './logger.js';
import { createMailService } from './mail/service.js';
import { createMetrics } from './metrics.js';
import { createOutboxRelay, enqueue, pendingCount } from './outbox.js';
import { createParking, parkedCount } from './parking.js';
import { createSpaceService } from './spaces/service.js';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const main = async (): Promise<void> => {
  const config = loadConfig();
  logger.level = config.LOG_LEVEL;

  const db = createDbClient(config.DATABASE_URL);
  const metrics = createMetrics({
    outboxPending: () => pendingCount(db.db),
    parked: () => parkedCount(db.db),
  });
  // The router is built after the consumer, whose client publishes the activity events.
  const consumer = createConsumer({
    config,
    logger,
    handler: (message, properties) => route(message, properties),
    onSubscriptionLost: () => {
      logger.fatal('a reconnect left the queue unsubscribed');
      void shutdown('subscriptionLost', 1);
    },
  });
  const activity = createActivity(config.RABBITMQ_ACTIVITY_EXCHANGE);
  const outbox = createOutboxRelay({ db: db.db, client: consumer.publisher, logger });
  const spaces = createSpaceService({
    db: db.db,
    tmail: createTmailClient({
      baseUrl: config.TMAIL_WEBADMIN_URL,
      password: config.TMAIL_WEBADMIN_PASSWORD,
    }),
    activity,
    logger,
  });
  const mail = createMailService({ db: db.db, activity, logger });
  const handlers = {
    'twake.space.created': spaces.spaceCreated,
    'twake.space.synced': spaces.spaceSynced,
    'twake.space.sync.completed': spaces.syncCompleted,
    'twake.space.updated': spaces.spaceRenamed,
    'twake.space.deleted': spaces.spaceDeleted,
    'twake.space.member.added': spaces.memberAdded,
    'twake.space.member.removed': spaces.memberRemoved,
    'twake.space.member.role.changed': spaces.memberRoleChanged,
    [config.RABBITMQ_DNS_ROUTING_KEY]: spaces.dnsValidated,
    [config.RABBITMQ_USER_DELETED_ROUTING_KEY]: spaces.userDeleted,
    [config.RABBITMQ_MAIL_RECEIVED_ROUTING_KEY]: mail.messageAdded,
    [config.RABBITMQ_MAIL_SENT_ROUTING_KEY]: mail.messageAdded,
  };
  const parking = createParking({
    db: db.db,
    client: consumer.publisher,
    handlers,
    deadLetterQueue: `${config.RABBITMQ_QUEUE}.dlq`,
    maxWaitMs: config.PARKING_MAX_WAIT_MS,
    logger,
  });
  const route = createRouter({ handlers, park: parking.park, logger, metrics });
  const health = createHealthServer({ port: config.HEALTH_PORT, consumer, db, metrics, logger });

  await health.start();

  try {
    await db.migrate();
    await consumer.start();
    // A sync request fans out to every app and every space, so only a first deployment sends one,
    // and a restart while it is still in the outbox does not add another.
    if (!(await spaces.hasSpaces()) && !(await pendingCount(db.db, 'twake.space.sync.requested'))) {
      await enqueue(db.db, {
        exchange: config.RABBITMQ_SPACE_EXCHANGE,
        routingKey: 'twake.space.sync.requested',
        messageId: randomUUID(),
        body: { timestamp: new Date().toISOString() },
      });
      logger.info('no space stored yet, sync of every organization requested');
    }
  } catch (err) {
    logger.fatal({ err }, 'startup failed');
    await health.stop();
    process.exit(1);
  }

  outbox.start(config.OUTBOX_INTERVAL_MS);
  parking.start(config.PARKING_INTERVAL_MS);

  // Each run deletes only what is due, so replicas running it at the same time are harmless.
  const purge = () =>
    spaces.purgeDeleted().catch((err) => logger.error({ err }, 'purge of deleted spaces failed'));
  void purge();
  const purger = setInterval(() => void purge(), PURGE_INTERVAL_MS);
  purger.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received');

    const timer = setTimeout(() => {
      logger.error({ timeoutMs: config.SHUTDOWN_TIMEOUT_MS }, 'shutdown timeout; forcing exit');
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    clearInterval(purger);
    try {
      // Rows a handler writes after this stay in the outbox for the next start.
      await parking.stop();
      await outbox.stop();
      await consumer.stop();
      await db.close();
      await health.stop();
      logger.info('shutdown complete');
      process.exit(exitCode);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection');
    void shutdown('unhandledRejection', 1);
  });
};

main().catch((err) => {
  logger.fatal({ err }, 'fatal error during startup');
  process.exit(1);
});

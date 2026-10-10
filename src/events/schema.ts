import type { RabbitMQMessageProperties } from '@linagora/rabbitmq-client';
import { bigserial, index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const processedEvents = pgTable(
  'processed_events',
  {
    source: text('source').notNull(),
    id: text('id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.id] }), index().on(t.processedAt)],
);

export const outbox = pgTable('outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  exchange: text('exchange').notNull(),
  routingKey: text('routing_key').notNull(),
  messageId: text('message_id').notNull(),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const parkedEvents = pgTable('parked_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  properties: jsonb('properties').$type<RabbitMQMessageProperties>().notNull(),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  parkedAt: timestamp('parked_at', { withTimezone: true }).notNull().defaultNow(),
});

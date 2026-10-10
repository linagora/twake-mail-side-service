import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  organizationId: text('organization_id').primaryKey(),
  domain: text('domain').notNull(),
  mailValidated: boolean('mail_validated').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const spaces = pgTable('spaces', {
  spaceId: uuid('space_id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  address: text('address').unique(),
  mailboxId: text('mailbox_id').unique(),
  provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.spaceId, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    email: text('email').notNull(),
    role: text('role', { enum: ['viewer', 'editor', 'admin'] }).notNull(),
    // A removed member keeps its row, so an older event about it cannot add it back.
    removedAt: timestamp('removed_at', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] }), index().on(t.userId)],
);

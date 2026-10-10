import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as events from '../events/schema.js';
import * as spaces from '../modules/spaces/schema.js';

const schema = { ...events, ...spaces };

export type Db = PostgresJsDatabase<typeof schema>;

export type Lock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export interface DbClient {
  db: Db;
  withLock: Lock;
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const createDbClient = (databaseUrl: string): DbClient => {
  const client = postgres(databaseUrl, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });

  // A session lock on a reserved connection, so no transaction stays open while it is held.
  const withLock: Lock = async (key, fn) => {
    const connection = await client.reserve();
    try {
      await connection`select pg_advisory_lock(hashtextextended(${key}, 0))`;
      try {
        return await fn();
      } finally {
        await connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
      }
    } finally {
      connection.release();
    }
  };

  return {
    db,
    withLock,
    // The drizzle migrator takes no lock, so replicas starting together would apply
    // the same migration.
    async migrate() {
      await withLock('migrations', () => migrate(db, { migrationsFolder: MIGRATIONS }));
    },
    async ping() {
      await db.execute(sql`SELECT 1`);
    },
    async close() {
      await client.end();
    },
  };
};

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
/** Runs `fn` only when no one holds the key, and says whether it ran. */
export type TryLock = (key: string, fn: () => Promise<void>) => Promise<boolean>;

export interface DbClient {
  db: Db;
  withLock: Lock;
  tryLock: TryLock;
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const CLOSE_TIMEOUT_S = 5;

export const createDbClient = (databaseUrl: string, { max = 5 } = {}): DbClient => {
  const client = postgres(databaseUrl, { max, onnotice: () => {} });
  const db = drizzle(client, { schema });

  // A session lock on a reserved connection, so no transaction stays open while it is held.
  const locked = async <T>(key: string, wait: boolean, fn: () => Promise<T>) => {
    const connection = await client.reserve();
    try {
      const [lock] = wait
        ? await connection`select pg_advisory_lock(hashtextextended(${key}, 0)), true as held`
        : await connection`select pg_try_advisory_lock(hashtextextended(${key}, 0)) as held`;
      if (!lock?.held) return { held: false } as const;
      const unlock = () => connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
      let value: T;
      try {
        value = await fn();
      } catch (err) {
        // A lost connection releases the lock with it; the holder's error is the one to report.
        await unlock().catch(() => {});
        throw err;
      }
      await unlock();
      return { held: true, value } as const;
    } finally {
      connection.release();
    }
  };

  const withLock: Lock = async (key, fn) => {
    const lock = await locked(key, true, fn);
    if (!lock.held) throw new Error(`lock ${key} not taken`);
    return lock.value;
  };

  const tryLock: TryLock = async (key, fn) => (await locked(key, false, fn)).held;

  return {
    db,
    withLock,
    tryLock,
    // The drizzle migrator takes no lock, so replicas starting together would apply
    // the same migration.
    async migrate() {
      await withLock('migrations', () => migrate(db, { migrationsFolder: MIGRATIONS }));
    },
    async ping() {
      await db.execute(sql`SELECT 1`);
    },
    // postgres.js waits forever on a connection the server dropped mid-query, so the wait is bounded.
    async close() {
      await client.end({ timeout: CLOSE_TIMEOUT_S });
    },
  };
};

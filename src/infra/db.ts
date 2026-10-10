import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbClient {
  db: Db;
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const createDbClient = (databaseUrl: string): DbClient => {
  const client = postgres(databaseUrl, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });

  return {
    db,
    // The drizzle migrator takes no lock, so replicas starting together would apply
    // the same migration. A reserved connection holds the lock while the pool migrates.
    async migrate() {
      const connection = await client.reserve();
      try {
        await connection`select pg_advisory_lock(hashtext('migrations'))`;
        try {
          await migrate(db, { migrationsFolder: MIGRATIONS });
        } finally {
          await connection`select pg_advisory_unlock(hashtext('migrations'))`;
        }
      } finally {
        connection.release();
      }
    },
    async ping() {
      await db.execute(sql`SELECT 1`);
    },
    async close() {
      await client.end();
    },
  };
};

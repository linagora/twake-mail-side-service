import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface DbClient {
  db: PostgresJsDatabase;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export const createDbClient = (databaseUrl: string, poolSize = 5): DbClient => {
  const client = postgres(databaseUrl, { max: poolSize });
  const db = drizzle(client);

  return {
    db,
    async ping() {
      await db.execute(sql`SELECT 1`);
    },
    async close() {
      await client.end();
    },
  };
};

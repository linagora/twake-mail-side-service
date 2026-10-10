import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient } from './db.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  client = createDbClient(container.getConnectionUri());
}, 120_000);

afterAll(async () => {
  await client?.close();
  await container?.stop();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('withLock', () => {
  it('runs one holder of a key at a time, and other keys alongside', async () => {
    const steps: string[] = [];
    let otherKeyRan!: () => void;
    const otherKey = new Promise<void>((resolve) => (otherKeyRan = resolve));
    const hold = (name: string) =>
      client.withLock('space:1', async () => {
        steps.push(`${name} in`);
        // Never resolves if the other key waited for this one.
        await otherKey;
        await tick();
        steps.push(`${name} out`);
      });

    await Promise.all([
      hold('a'),
      hold('b'),
      client.withLock('space:2', async () => otherKeyRan()),
    ]);

    expect(steps.join()).toMatch(/^(a in,a out,b in,b out|b in,b out,a in,a out)$/);
  });

  it('releases the key when the holder fails', async () => {
    await expect(
      client.withLock('space:1', async () => {
        throw new Error('tmail down');
      }),
    ).rejects.toThrow('tmail down');

    expect(await client.withLock('space:1', async () => 'next')).toBe('next');
  });
});

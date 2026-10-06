import { DeadLetterError } from '@linagora/rabbitmq-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mocked } from 'vitest';
import type { ActivityPublisher } from '../../src/activity.js';
import { createDbClient, type DbClient } from '../../src/db.js';
import { createMailService } from '../../src/mail/service.js';
import { spaces } from '../../src/schema.js';
import { silentLogger } from '../helpers.js';

const received = (teamMailbox = 'product-launch@acme.com') => ({
  teamMailbox,
  domain: 'acme.com',
  direction: 'received',
  mailboxPath: 'product-launch.INBOX',
  messageId: '956ee570-c1aa-11f1-bdf6-19e2a75a28cc',
  subject: 'Quarterly numbers',
  from: [{ name: 'Plugin Test', email: 'plugin-test@example.com' }],
  date: '2026-10-06T17:22:57Z',
  timestamp: '2026-10-06T17:23:03.281571409Z',
});

let container: StartedPostgreSqlContainer;
let client: DbClient;
let activity: Mocked<ActivityPublisher>;

const service = () => createMailService({ db: client.db, activity, logger: silentLogger });

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  client = createDbClient(container.getConnectionUri());
  await client.migrate();
}, 120_000);

afterAll(async () => {
  await client?.close();
  await container?.stop();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE organizations, spaces, space_members CASCADE`);
  await client.db.insert(spaces).values([
    {
      spaceId: '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10',
      organizationId: 'acme',
      name: 'Product launch',
      address: 'product-launch@acme.com',
      mailboxId: 'root-id',
      provisionedAt: new Date(),
    },
    {
      spaceId: '0b8a6c2e-3d41-4f6a-8e7b-2c5d9f1a4b33',
      organizationId: 'acme',
      name: 'Waiting',
      address: 'waiting@acme.com',
    },
  ]);
  activity = {
    provisioned: vi.fn().mockResolvedValue(undefined),
    message: vi.fn().mockResolvedValue(undefined),
  };
});

describe('mail service', () => {
  it("reports a space's team mail with its root mailbox id", async () => {
    await service().messageAdded(received());
    await service().messageAdded({
      ...received('Product-Launch@ACME.com'),
      direction: 'sent',
      subject: 'hello',
    });

    expect(activity.message.mock.calls).toEqual([
      [
        {
          organizationId: 'acme',
          mailboxId: 'root-id',
          direction: 'received',
          messageId: '956ee570-c1aa-11f1-bdf6-19e2a75a28cc',
          subject: 'Quarterly numbers',
          time: '2026-10-06T17:23:03.281571409Z',
        },
      ],
      [expect.objectContaining({ mailboxId: 'root-id', direction: 'sent', subject: 'hello' })],
    ]);
  });

  it('ignores the mail of a team mailbox no space owns', async () => {
    await service().messageAdded(received('other@acme.com'));

    expect(activity.message).not.toHaveBeenCalled();
  });

  it('ignores the mail of a deleted space', async () => {
    await client.db.update(spaces).set({ deletedAt: new Date() });

    await service().messageAdded(received());

    expect(activity.message).not.toHaveBeenCalled();
  });

  it('retries the mail of a space still being provisioned', async () => {
    await expect(service().messageAdded(received('waiting@acme.com'))).rejects.toThrow(
      'waiting@acme.com',
    );
    expect(activity.message).not.toHaveBeenCalled();
  });

  it('reports a mail without subject', async () => {
    await service().messageAdded({ ...received(), subject: null });

    expect(activity.message).toHaveBeenCalledWith(expect.objectContaining({ subject: '' }));
  });

  it('dead-letters a malformed event', async () => {
    await expect(service().messageAdded({ teamMailbox: 'x@acme.com' })).rejects.toBeInstanceOf(
      DeadLetterError,
    );
    await expect(
      service().messageAdded({ ...received(), timestamp: '1759771383281' }),
    ).rejects.toBeInstanceOf(DeadLetterError);
  });
});

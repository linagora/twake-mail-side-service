import type { RabbitMQClient } from '@linagora/rabbitmq-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createActivity } from '../../events/activity.js';
import { createOutboxRelay } from '../../events/outbox.js';
import { MalformedEventError, NotYetKnownError } from '../../events/errors.js';
import { createDbClient, type DbClient } from '../../infra/db.js';
import { broker, silentLogger } from '../../testing/helpers.js';
import { spaces } from '../spaces/schema.js';
import { createMailService } from './service.js';

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
let publish: Mock<RabbitMQClient['publish']>;

const service = () =>
  createMailService({ db: client.db, activity: createActivity('activity'), logger: silentLogger });

const published = async () => {
  await createOutboxRelay({ db: client.db, client: broker(publish), logger: silentLogger }).relay();
  return publish.mock.calls.map(([, routingKey, event]) => ({ routingKey, event }));
};

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
  await client.db.execute(sql`TRUNCATE organizations, spaces, space_members, outbox CASCADE`);
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
  publish = vi.fn().mockResolvedValue(undefined);
});

describe('mail service', () => {
  it("reports a space's team mail with its root mailbox id", async () => {
    await service().messageAdded(received());
    await service().messageAdded({
      ...received('Product-Launch@ACME.com'),
      direction: 'sent',
      subject: 'hello',
    });

    expect(await published()).toEqual([
      {
        routingKey: 'com.twake.mail.message.received.v1',
        event: expect.objectContaining({
          id: 'root-id:956ee570-c1aa-11f1-bdf6-19e2a75a28cc:received',
          twakeorg: 'acme',
          time: '2026-10-06T17:23:03.281571409Z',
          data: {
            object: {
              type: 'message',
              id: '956ee570-c1aa-11f1-bdf6-19e2a75a28cc',
              title: 'Quarterly numbers',
              container: { kind: 'mailbox', id: 'root-id' },
            },
          },
        }),
      },
      {
        routingKey: 'com.twake.mail.message.sent.v1',
        event: expect.objectContaining({
          data: { object: expect.objectContaining({ title: 'hello' }) },
        }),
      },
    ]);
  });

  it('ignores the mail of a team mailbox no space owns', async () => {
    await service().messageAdded(received('other@acme.com'));

    expect(await published()).toEqual([]);
  });

  it('ignores the mail of a deleted space', async () => {
    await client.db.update(spaces).set({ deletedAt: new Date() });

    await service().messageAdded(received());

    expect(await published()).toEqual([]);
  });

  it('parks the mail of a space still being provisioned', async () => {
    await expect(service().messageAdded(received('waiting@acme.com'))).rejects.toBeInstanceOf(
      NotYetKnownError,
    );
    expect(await published()).toEqual([]);
  });

  it('reports a mail without subject', async () => {
    await service().messageAdded({ ...received(), subject: null });

    expect(await published()).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          data: { object: expect.objectContaining({ title: '(no subject)' }) },
        }),
      }),
    ]);
  });

  it('refuses a malformed event', async () => {
    await expect(service().messageAdded({ teamMailbox: 'x@acme.com' })).rejects.toBeInstanceOf(
      MalformedEventError,
    );
    await expect(
      service().messageAdded({ ...received(), timestamp: '1759771383281' }),
    ).rejects.toBeInstanceOf(MalformedEventError);
  });
});

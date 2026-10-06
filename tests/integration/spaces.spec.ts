import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mocked } from 'vitest';
import type { ActivityPublisher } from '../../src/activity.js';
import { AddressTakenError, type TmailClient } from '../../src/clients/tmail.js';
import { createDbClient, type DbClient } from '../../src/db.js';
import { spaces } from '../../src/schema.js';
import { createSpaceService } from '../../src/spaces/service.js';
import { silentLogger } from '../helpers.js';

const SPACE = '6f1c1f3e-1b7a-4f0e-9a51-0c9f2b7d1a10';
const OTHER_SPACE = '0b8a6c2e-3d41-4f6a-8e7b-2c5d9f1a4b33';
const JANE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const VIC = '33333333-3333-4333-8333-333333333333';

const member = (uuid: string, email: string, role: string) => ({
  uuid,
  username: email.split('@')[0],
  email,
  firstName: 'F',
  lastName: 'L',
  role,
});

const created = (id = SPACE, name = 'Sales EU') => ({
  organizationId: 'acme',
  id,
  name,
  members: [
    member(JANE, 'jane@acme.com', 'admin'),
    member(BOB, 'bob@acme.com', 'editor'),
    member(VIC, 'vic@acme.com', 'viewer'),
  ],
  groups: [],
  timestamp: '2026-10-06T10:00:00Z',
});

const validated = (mail = true) => ({
  organizationId: 'acme',
  domain: 'acme.com',
  dnsOwnershipValidated: true,
  mailDnsConfigurationValidated: mail,
  chatDnsConfigurationValidated: false,
});

const memberEvent = (uuid: string, email: string, role: string) => ({
  organizationId: 'acme',
  id: SPACE,
  members: [member(uuid, email, role)],
});

let container: StartedPostgreSqlContainer;
let client: DbClient;
let tmail: Mocked<TmailClient>;
let activity: Mocked<ActivityPublisher>;

const service = () => createSpaceService({ db: client.db, tmail, activity, logger: silentLogger });

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
  tmail = {
    listTeamMailboxes: vi.fn().mockResolvedValue([]),
    createTeamMailbox: vi.fn().mockResolvedValue(undefined),
    rootMailboxId: vi.fn(async (_domain: string, name: string) => `id-${name}`),
    addMember: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
  };
  activity = {
    provisioned: vi.fn().mockResolvedValue(undefined),
    message: vi.fn().mockResolvedValue(undefined),
  };
});

describe('space service', () => {
  it('provisions a space of an organization whose mail domain is validated', async () => {
    await service().dnsValidated(validated());
    await service().spaceCreated(created());

    expect(tmail.createTeamMailbox).toHaveBeenCalledWith('acme.com', 'sales-eu');
    expect(tmail.addMember.mock.calls).toEqual(
      expect.arrayContaining([
        ['acme.com', 'sales-eu', 'jane@acme.com', 'manager'],
        ['acme.com', 'sales-eu', 'bob@acme.com', 'member'],
      ]),
    );
    expect(tmail.addMember).toHaveBeenCalledTimes(2);
    expect(activity.provisioned).toHaveBeenCalledWith({
      organizationId: 'acme',
      spaceId: SPACE,
      mailboxId: 'id-sales-eu',
    });
    const [stored] = await client.db.select().from(spaces).where(eq(spaces.spaceId, SPACE));
    expect(stored).toMatchObject({ address: 'sales-eu@acme.com', mailboxId: 'id-sales-eu' });
  });

  it('keeps a space waiting until its mail domain is validated', async () => {
    await service().spaceCreated(created());
    expect(tmail.createTeamMailbox).not.toHaveBeenCalled();

    await service().memberAdded(
      memberEvent('44444444-4444-4444-8444-444444444444', 'al@acme.com', 'editor'),
    );
    await service().dnsValidated(validated(false));
    expect(tmail.createTeamMailbox).not.toHaveBeenCalled();

    await service().dnsValidated(validated());
    expect(tmail.createTeamMailbox).toHaveBeenCalledWith('acme.com', 'sales-eu');
    expect(tmail.addMember).toHaveBeenCalledWith('acme.com', 'sales-eu', 'al@acme.com', 'member');
    expect(activity.provisioned).toHaveBeenCalledOnce();
  });

  it('provisions a space once, whatever the number of dns.validated events', async () => {
    await service().dnsValidated(validated());
    await service().spaceCreated(created());
    await service().dnsValidated(validated());

    expect(tmail.createTeamMailbox).toHaveBeenCalledOnce();
    expect(activity.provisioned).toHaveBeenCalledOnce();
  });

  it('adds a number when the address is taken in TMail or by another space', async () => {
    await service().dnsValidated(validated());
    await service().spaceCreated(created(OTHER_SPACE));
    tmail.listTeamMailboxes.mockResolvedValue(['sales-eu', 'sales-eu-2']);
    tmail.createTeamMailbox.mockImplementation(async (_d: string, name: string) => {
      if (name === 'sales-eu-3') throw new AddressTakenError(409, 'held by a user');
    });

    await service().spaceCreated(created());

    expect(activity.provisioned).toHaveBeenLastCalledWith(
      expect.objectContaining({ spaceId: SPACE, mailboxId: 'id-sales-eu-4' }),
    );
  });

  it('resumes with the same address after a failure', async () => {
    await service().dnsValidated(validated());
    tmail.addMember.mockRejectedValueOnce(new Error('tmail down'));

    await expect(service().spaceCreated(created())).rejects.toThrow('tmail down');
    await service().spaceCreated(created());

    expect(tmail.createTeamMailbox.mock.calls).toEqual([
      ['acme.com', 'sales-eu'],
      ['acme.com', 'sales-eu'],
    ]);
    expect(activity.provisioned).toHaveBeenCalledOnce();
  });

  it('picks another address when the stored one was taken in TMail meanwhile', async () => {
    await service().dnsValidated(validated());
    tmail.addMember.mockRejectedValueOnce(new Error('tmail down'));
    await expect(service().spaceCreated(created())).rejects.toThrow('tmail down');

    tmail.createTeamMailbox.mockImplementation(async (_d: string, name: string) => {
      if (name === 'sales-eu') throw new AddressTakenError(409, 'held by a user');
    });
    await service().spaceCreated(created());

    expect(activity.provisioned).toHaveBeenCalledWith(
      expect.objectContaining({ mailboxId: 'id-sales-eu-2' }),
    );
  });

  it('provisions the other waiting spaces when one fails', async () => {
    await service().spaceCreated(created());
    await service().spaceCreated(created(OTHER_SPACE, 'Support'));
    tmail.createTeamMailbox.mockImplementation(async (_d: string, name: string) => {
      if (name === 'sales-eu') throw new Error('tmail down');
    });

    await expect(service().dnsValidated(validated())).rejects.toThrow('tmail down');

    expect(activity.provisioned).toHaveBeenCalledOnce();
    expect(activity.provisioned).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: OTHER_SPACE, mailboxId: 'id-support' }),
    );
  });

  it('follows member changes once provisioned', async () => {
    await service().dnsValidated(validated());
    await service().spaceCreated(created());
    tmail.addMember.mockClear();

    await service().memberRoleChanged(memberEvent(BOB, 'bob@acme.com', 'admin'));
    await service().memberRoleChanged(memberEvent(JANE, 'jane@acme.com', 'viewer'));
    await service().memberRoleChanged(memberEvent(VIC, 'vic@acme.com', 'editor'));
    await service().memberRemoved(memberEvent(BOB, 'bob@acme.com', 'admin'));

    expect(tmail.addMember.mock.calls).toEqual([
      ['acme.com', 'sales-eu', 'bob@acme.com', 'manager'],
      ['acme.com', 'sales-eu', 'vic@acme.com', 'member'],
    ]);
    expect(tmail.removeMember.mock.calls).toEqual([
      ['acme.com', 'sales-eu', 'jane@acme.com'],
      ['acme.com', 'sales-eu', 'bob@acme.com'],
    ]);
  });

  it('removes a deleted user from every team mailbox', async () => {
    await service().dnsValidated(validated());
    await service().spaceCreated(created());
    await service().spaceCreated(created(OTHER_SPACE, 'Support'));

    await service().userDeleted({
      uuid: BOB,
      internalEmail: 'bob@acme.com',
      organizationId: 'acme',
    });

    expect(tmail.removeMember.mock.calls).toEqual(
      expect.arrayContaining([
        ['acme.com', 'sales-eu', 'bob@acme.com'],
        ['acme.com', 'support', 'bob@acme.com'],
      ]),
    );
    await service().memberAdded(memberEvent(BOB, 'bob@acme.com', 'editor'));
    expect(tmail.addMember).toHaveBeenLastCalledWith(
      'acme.com',
      'sales-eu',
      'bob@acme.com',
      'member',
    );
  });

  it('retries a user deletion that TMail failed', async () => {
    await service().dnsValidated(validated());
    await service().spaceCreated(created());
    tmail.removeMember.mockRejectedValueOnce(new Error('tmail down'));
    const deleted = { uuid: BOB, internalEmail: 'bob@acme.com', organizationId: 'acme' };

    await expect(service().userDeleted(deleted)).rejects.toThrow('tmail down');
    await service().userDeleted(deleted);

    expect(tmail.removeMember).toHaveBeenCalledTimes(2);
  });

  it('ignores member events of a space it does not know', async () => {
    await expect(
      service().memberAdded(memberEvent(BOB, 'bob@acme.com', 'editor')),
    ).resolves.toBeUndefined();
    expect(tmail.addMember).not.toHaveBeenCalled();
  });
});

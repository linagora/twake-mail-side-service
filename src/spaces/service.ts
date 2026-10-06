import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { ActivityPublisher } from '../activity.js';
import { AddressTakenError, type TeamMailboxRole, type TmailClient } from '../clients/tmail.js';
import type { Db } from '../db.js';
import type { Logger } from '../logger.js';
import { candidateNames, mailboxName } from '../mailbox/address.js';
import { organizations, spaceMembers, spaces } from '../schema.js';
import {
  dnsValidated,
  memberChanged,
  parseEvent,
  spaceCreated,
  spaceDeleted,
  spaceRenamed,
  userDeleted,
  type SpaceRole,
} from './events.js';

export interface SpaceService {
  spaceCreated(body: unknown): Promise<void>;
  spaceRenamed(body: unknown): Promise<void>;
  spaceDeleted(body: unknown): Promise<void>;
  purgeDeleted(now?: Date): Promise<void>;
  memberAdded(body: unknown): Promise<void>;
  memberRoleChanged(body: unknown): Promise<void>;
  memberRemoved(body: unknown): Promise<void>;
  dnsValidated(body: unknown): Promise<void>;
  userDeleted(body: unknown): Promise<void>;
}

interface SpaceServiceDeps {
  db: Db;
  tmail: TmailClient;
  activity: ActivityPublisher;
  logger: Logger;
}

// TMail team mailboxes have no read-only access, so viewers get none.
const TMAIL_ROLES: Record<SpaceRole, TeamMailboxRole | undefined> = {
  admin: 'manager',
  editor: 'member',
  viewer: undefined,
};

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (err: unknown): boolean => {
  for (let e = err; e instanceof Error; e = e.cause) {
    if ('code' in e && e.code === UNIQUE_VIOLATION) return true;
  }
  return false;
};

const splitAddress = (address: string) => {
  const at = address.lastIndexOf('@');
  return { name: address.slice(0, at), domain: address.slice(at + 1) };
};

export const createSpaceService = ({
  db,
  tmail,
  activity,
  logger,
}: SpaceServiceDeps): SpaceService => {
  const findSpace = async (spaceId: string) => {
    const [space] = await db.select().from(spaces).where(eq(spaces.spaceId, spaceId));
    return space;
  };

  const pickAddress = async (spaceId: string, name: string, domain: string): Promise<string> => {
    const inTmail = new Set(await tmail.listTeamMailboxes(domain));
    for (const candidate of candidateNames(name)) {
      if (inTmail.has(candidate)) continue;
      const address = `${candidate}@${domain}`;
      try {
        // Stored before TMail is called, so a retry resumes with the same address.
        await db.update(spaces).set({ address }).where(eq(spaces.spaceId, spaceId));
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
      try {
        await tmail.createTeamMailbox(domain, candidate);
        return address;
      } catch (err) {
        if (!(err instanceof AddressTakenError)) throw err;
        logger.info({ spaceId, address }, 'address held by a user or alias, trying the next one');
      }
    }
    throw new Error(`no free team mailbox address for ${name}@${domain}`);
  };

  const provision = async (spaceId: string): Promise<void> => {
    const space = await findSpace(spaceId);
    if (!space || space.provisionedAt || space.deletedAt) return;
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.organizationId, space.organizationId));
    if (!organization?.mailValidated) {
      logger.info({ spaceId }, 'mail domain not validated yet, the space waits');
      return;
    }

    let address = space.address;
    if (address) {
      const { name, domain } = splitAddress(address);
      try {
        await tmail.createTeamMailbox(domain, name);
      } catch (err) {
        if (!(err instanceof AddressTakenError)) throw err;
        address = null;
      }
    }
    address ??= await pickAddress(spaceId, mailboxName(space.name), organization.domain);

    const { name, domain } = splitAddress(address);
    const members = await db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId));
    for (const member of members) {
      const role = TMAIL_ROLES[member.role];
      if (role) await tmail.addMember(domain, name, member.email, role);
    }

    const mailboxId = await tmail.rootMailboxId(domain, name);
    await activity.provisioned({ organizationId: space.organizationId, spaceId, mailboxId });
    await db
      .update(spaces)
      .set({ mailboxId, provisionedAt: sql`now()` })
      .where(eq(spaces.spaceId, spaceId));
    logger.info({ spaceId, address, mailboxId }, 'team mailbox provisioned');
  };

  const syncMember = async (address: string | null, email: string, role: SpaceRole | undefined) => {
    if (!address) return;
    const { name, domain } = splitAddress(address);
    const tmailRole = role && TMAIL_ROLES[role];
    if (tmailRole) await tmail.addMember(domain, name, email, tmailRole);
    else await tmail.removeMember(domain, name, email);
  };

  const onMember = (removed: boolean) => async (body: unknown) => {
    const event = parseEvent(memberChanged, body);
    const space = await findSpace(event.id);
    if (!space || space.deletedAt) {
      logger.warn({ spaceId: event.id }, 'member event for an unknown or deleted space, ignored');
      return;
    }
    for (const member of event.members) {
      if (removed) {
        await db
          .delete(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, event.id), eq(spaceMembers.userId, member.uuid)));
      } else {
        await db
          .insert(spaceMembers)
          .values({
            spaceId: event.id,
            userId: member.uuid,
            email: member.email,
            role: member.role,
          })
          .onConflictDoUpdate({
            target: [spaceMembers.spaceId, spaceMembers.userId],
            set: { email: member.email, role: member.role },
          });
      }
      if (space.provisionedAt) {
        await syncMember(space.address, member.email, removed ? undefined : member.role);
      }
    }
  };

  return {
    async spaceCreated(body) {
      const event = parseEvent(spaceCreated, body);
      await db.transaction(async (tx) => {
        await tx
          .insert(spaces)
          .values({ spaceId: event.id, organizationId: event.organizationId, name: event.name })
          .onConflictDoNothing();
        if (event.members.length) {
          await tx
            .insert(spaceMembers)
            .values(
              event.members.map((m) => ({
                spaceId: event.id,
                userId: m.uuid,
                email: m.email,
                role: m.role,
              })),
            )
            .onConflictDoNothing();
        }
      });
      await provision(event.id);
    },

    // The address is picked at provisioning, so a rename only matters to a space still waiting.
    async spaceRenamed(body) {
      const event = parseEvent(spaceRenamed, body);
      await db.update(spaces).set({ name: event.name }).where(eq(spaces.spaceId, event.id));
    },

    async spaceDeleted(body) {
      const event = parseEvent(spaceDeleted, body);
      const space = await findSpace(event.id);
      if (!space || space.deletedAt) return;
      if (!space.address) {
        await db.delete(spaces).where(eq(spaces.spaceId, event.id));
        return;
      }
      const { name, domain } = splitAddress(space.address);
      // TMail first: a failed call retries the event with the space still live.
      for (const user of await tmail.listMembers(domain, name)) {
        await tmail.removeMember(domain, name, user);
      }
      // The row stays until the purge, so the address is not given to another space meanwhile.
      await db.transaction(async (tx) => {
        await tx.delete(spaceMembers).where(eq(spaceMembers.spaceId, event.id));
        await tx
          .update(spaces)
          .set({ deletedAt: sql`now()` })
          .where(eq(spaces.spaceId, event.id));
      });
      logger.info({ spaceId: event.id, address: space.address }, 'team mailbox closed');
    },

    async purgeDeleted(now = new Date()) {
      const due = await db
        .select({ spaceId: spaces.spaceId, address: spaces.address })
        .from(spaces)
        .where(lt(spaces.deletedAt, new Date(now.getTime() - RETENTION_MS)));
      for (const { spaceId, address } of due) {
        try {
          if (address) {
            const { name, domain } = splitAddress(address);
            await tmail.deleteTeamMailbox(domain, name);
          }
          await db.delete(spaces).where(eq(spaces.spaceId, spaceId));
          logger.info({ spaceId, address }, 'team mailbox deleted');
        } catch (err) {
          logger.error({ err, spaceId }, 'team mailbox deletion failed, retried at the next purge');
        }
      }
    },

    memberAdded: onMember(false),
    memberRoleChanged: onMember(false),
    memberRemoved: onMember(true),

    async dnsValidated(body) {
      const event = parseEvent(dnsValidated, body);
      const values = {
        domain: event.domain.toLowerCase(),
        mailValidated: event.mailDnsConfigurationValidated,
      };
      await db
        .insert(organizations)
        .values({ organizationId: event.organizationId, ...values })
        .onConflictDoUpdate({
          target: organizations.organizationId,
          set: { ...values, updatedAt: sql`now()` },
        });
      if (!values.mailValidated) return;

      const waiting = await db
        .select({ spaceId: spaces.spaceId })
        .from(spaces)
        .where(and(eq(spaces.organizationId, event.organizationId), isNull(spaces.provisionedAt)));
      // One failing space must not hold back the others; the retry only redoes the failed ones.
      const failures: unknown[] = [];
      for (const { spaceId } of waiting) {
        try {
          await provision(spaceId);
        } catch (err) {
          logger.error({ err, spaceId }, 'provisioning failed');
          failures.push(err);
        }
      }
      if (failures.length) throw failures[0];
    },

    async userDeleted(body) {
      const event = parseEvent(userDeleted, body);
      const mailboxes = await db
        .select({ address: spaces.address, email: spaceMembers.email })
        .from(spaceMembers)
        .innerJoin(spaces, eq(spaces.spaceId, spaceMembers.spaceId))
        .where(and(eq(spaceMembers.userId, event.uuid), isNotNull(spaces.provisionedAt)));
      // TMail first: a failed call retries the event with the memberships still stored.
      for (const { address, email } of mailboxes) await syncMember(address, email, undefined);
      await db.delete(spaceMembers).where(eq(spaceMembers.userId, event.uuid));
    },
  };
};

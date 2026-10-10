import { DeadLetterError } from '@linagora/rabbitmq-client';
import { and, eq, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Activity } from '../../events/activity.js';
import { enqueue } from '../../events/outbox.js';
import type { Db } from '../../infra/db.js';
import type { Logger } from '../../infra/logger.js';
import { AddressTakenError, type TeamMailboxRole, type TmailClient } from '../../product/api.js';
import { organizations, spaceMembers, spaces } from '../../schema.js';
import { candidateNames, mailboxName } from './address.js';
import {
  dnsValidated,
  memberChanged,
  parseEvent,
  spaceCreated,
  spaceDeleted,
  spaceRenamed,
  syncCompleted,
  userDeleted,
  type SpaceRole,
} from './events.js';

export interface SpaceService {
  hasSpaces(): Promise<boolean>;
  spaceCreated(body: unknown): Promise<void>;
  spaceSynced(body: unknown): Promise<void>;
  syncCompleted(body: unknown): Promise<void>;
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
  activity: Activity;
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

// A late or redelivered event must not undo a newer one; equal timestamps apply in arrival order.
const isStale = (space: { lastEventAt: Date | null } | undefined, timestamp: string) =>
  Boolean(space?.lastEventAt && new Date(timestamp) < space.lastEventAt);

type Member = { email: string; role: SpaceRole };

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
    const candidates = candidateNames(name);
    const toAddress = (candidate: string) => `${candidate}@${domain}`;
    // Spaces before TMail: the purge deletes the mailbox before the row, so a purged
    // mailbox is never seen in TMail without its space.
    const held = await db
      .select({ address: spaces.address })
      .from(spaces)
      .where(and(inArray(spaces.address, candidates.map(toAddress)), ne(spaces.spaceId, spaceId)));
    const heldBySpace = new Set(held.map((s) => s.address));
    const inTmail = new Set(await tmail.listTeamMailboxes(domain));
    for (const candidate of candidates) {
      const address = toAddress(candidate);
      if (inTmail.has(candidate)) {
        if (heldBySpace.has(address)) continue;
        // It may be this space's mailbox from a lost row: only a person can tell.
        throw new DeadLetterError(
          `${address} is a team mailbox no space holds, store it as space ${spaceId}'s address to use it`,
        );
      }
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
    // The mailbox may predate the space's row, linked by hand, with members it no longer has.
    await matchMembers(
      address,
      await db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId)),
    );

    const mailboxId = await tmail.rootMailboxId(domain, name);
    await db.transaction(async (tx) => {
      // A provisioning that overlaps this one (a consumer failover) found the space waiting too.
      const updated = await tx
        .update(spaces)
        .set({ mailboxId, provisionedAt: sql`now()` })
        .where(and(eq(spaces.spaceId, spaceId), isNull(spaces.provisionedAt)))
        .returning({ spaceId: spaces.spaceId });
      if (!updated.length) return;
      await enqueue(
        tx,
        activity.provisioned({ organizationId: space.organizationId, spaceId, mailboxId }),
      );
    });
    logger.info({ spaceId, address, mailboxId }, 'team mailbox provisioned');
  };

  const syncMember = async (address: string | null, email: string, role: SpaceRole | undefined) => {
    if (!address) return;
    const { name, domain } = splitAddress(address);
    const tmailRole = role && TMAIL_ROLES[role];
    if (tmailRole) await tmail.addMember(domain, name, email, tmailRole);
    else await tmail.removeMember(domain, name, email);
  };

  const applied = (spaceId: string, timestamp: string) =>
    db
      .update(spaces)
      .set({ lastEventAt: sql`greatest(${spaces.lastEventAt}, ${timestamp}::timestamptz)` })
      .where(eq(spaces.spaceId, spaceId));

  // TMail is read rather than the stored members, so a member added there by hand is removed too.
  const matchMembers = async (address: string, members: Member[]) => {
    const { name, domain } = splitAddress(address);
    const wanted = new Map<string, { email: string; role: TeamMailboxRole }>();
    for (const m of members) {
      const role = TMAIL_ROLES[m.role];
      if (role) wanted.set(m.email.toLowerCase(), { email: m.email, role });
    }
    for (const { username, role } of await tmail.listMembers(domain, name)) {
      const want = wanted.get(username.toLowerCase());
      if (!want) await tmail.removeMember(domain, name, username);
      else if (want.role === role) wanted.delete(username.toLowerCase());
    }
    for (const { email, role } of wanted.values()) await tmail.addMember(domain, name, email, role);
  };

  const closeSpace = async (spaceId: string) => {
    const space = await findSpace(spaceId);
    if (!space || space.deletedAt) return;
    if (!space.address) {
      await db.delete(spaces).where(eq(spaces.spaceId, space.spaceId));
      return;
    }
    // TMail first: a failed call retries the event with the space still live.
    await matchMembers(space.address, []);
    // The row stays until the purge, so the address is not given to another space meanwhile.
    await db.transaction(async (tx) => {
      await tx.delete(spaceMembers).where(eq(spaceMembers.spaceId, space.spaceId));
      await tx
        .update(spaces)
        .set({ deletedAt: sql`now()` })
        .where(eq(spaces.spaceId, space.spaceId));
    });
    logger.info({ spaceId: space.spaceId, address: space.address }, 'team mailbox closed');
  };

  // One failing space must not hold back the others; the retry only redoes the failed ones.
  // A retryable failure wins over a dead letter, or the event would be dropped with it.
  const eachSpace = async (spaceIds: string[], apply: (spaceId: string) => Promise<void>) => {
    const failures: unknown[] = [];
    for (const spaceId of spaceIds) {
      try {
        await apply(spaceId);
      } catch (err) {
        logger.error({ err, spaceId }, 'space update failed');
        failures.push(err);
      }
    }
    if (failures.length) {
      throw failures.find((err) => !(err instanceof DeadLetterError)) ?? failures[0];
    }
  };

  const onMember = (removed: boolean) => async (body: unknown) => {
    const event = parseEvent(memberChanged, body);
    const space = await findSpace(event.id);
    if (!space || space.deletedAt) {
      logger.warn({ spaceId: event.id }, 'member event for an unknown or deleted space, ignored');
      return;
    }
    if (isStale(space, event.timestamp)) return;
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
    await applied(event.id, event.timestamp);
  };

  return {
    async hasSpaces() {
      const [space] = await db.select({ spaceId: spaces.spaceId }).from(spaces).limit(1);
      return Boolean(space);
    },

    async spaceCreated(body) {
      const event = parseEvent(spaceCreated, body);
      if (isStale(await findSpace(event.id), event.timestamp)) return;
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
      await applied(event.id, event.timestamp);
    },

    async spaceSynced(body) {
      const event = parseEvent(spaceCreated, body);
      const space = await findSpace(event.id);
      if (space?.deletedAt || isStale(space, event.timestamp)) return;
      await db.transaction(async (tx) => {
        await tx
          .insert(spaces)
          .values({ spaceId: event.id, organizationId: event.organizationId, name: event.name })
          .onConflictDoUpdate({ target: spaces.spaceId, set: { name: event.name } });
        await tx.delete(spaceMembers).where(eq(spaceMembers.spaceId, event.id));
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
      if (space?.provisionedAt && space.address) await matchMembers(space.address, event.members);
      else await provision(event.id);
      await applied(event.id, event.timestamp);
    },

    async syncCompleted(body) {
      const event = parseEvent(syncCompleted, body);
      const gone = await db
        .select({ spaceId: spaces.spaceId })
        .from(spaces)
        .where(
          and(
            eq(spaces.organizationId, event.organizationId),
            isNull(spaces.deletedAt),
            event.spaceIds.length ? notInArray(spaces.spaceId, event.spaceIds) : undefined,
            // A space created after the snapshot is not listed yet, and stays.
            or(isNull(spaces.lastEventAt), lte(spaces.lastEventAt, new Date(event.timestamp))),
          ),
        );
      await eachSpace(
        gone.map((s) => s.spaceId),
        closeSpace,
      );
    },

    // The address is picked at provisioning, so a rename only matters to a space still waiting.
    async spaceRenamed(body) {
      const event = parseEvent(spaceRenamed, body);
      if (isStale(await findSpace(event.id), event.timestamp)) return;
      await db.update(spaces).set({ name: event.name }).where(eq(spaces.spaceId, event.id));
      await applied(event.id, event.timestamp);
    },

    async spaceDeleted(body) {
      await closeSpace(parseEvent(spaceDeleted, body).id);
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
      await eachSpace(
        waiting.map((s) => s.spaceId),
        provision,
      );
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

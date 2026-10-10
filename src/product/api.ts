import { NotYetKnownError } from '../events/errors.js';
import {
  AddressTakenError,
  type TeamMailboxRole,
  type TmailClient,
  TmailError,
  TmailRejectedError,
} from './port.js';

export interface TmailOptions {
  baseUrl: string;
  password?: string;
  // Called on a 401 or 403, so an operator is alerted: the retries wait for fixed credentials.
  onRefused?: () => void;
}

// One attempt per call: the broker client retries the handler, then dead-letters.
const TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY = 500;

const isNotFound = (err: unknown) => err instanceof NotYetKnownError;

// 401 and 403 mean the service's own credentials are wrong, never the event.
const RETRIED = new Set([401, 403, 408, 429]);

// TMail answers 404 for a domain or a team mailbox it does not have, which a later event may bring.
const failure = (status: number, body: string) => {
  if (status === 404) return new NotYetKnownError(`TMail webadmin answered 404: ${body}`);
  return status >= 400 && status < 500 && !RETRIED.has(status)
    ? new TmailRejectedError(status, body)
    : new TmailError(status, body);
};

export const createTmailClient = ({
  baseUrl,
  password,
  onRefused = () => {},
}: TmailOptions): TmailClient => {
  const root = baseUrl.replace(/\/+$/, '');

  const call = async (method: 'GET' | 'PUT' | 'DELETE', path: string): Promise<Response> => {
    const res = await fetch(root + path, {
      method,
      headers: password ? { password } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) onRefused();
    if (!res.ok) throw failure(res.status, (await res.text()).slice(0, MAX_ERROR_BODY));
    return res;
  };

  const teamMailbox = (domain: string, name: string) =>
    `/domains/${encodeURIComponent(domain)}/team-mailboxes/${encodeURIComponent(name)}`;
  const member = (domain: string, name: string, user: string) =>
    `${teamMailbox(domain, name)}/members/${encodeURIComponent(user)}`;

  return {
    async listTeamMailboxes(domain) {
      const res = await call('GET', `/domains/${encodeURIComponent(domain)}/team-mailboxes`);
      return ((await res.json()) as { name: string }[]).map((m) => m.name);
    },
    async createTeamMailbox(domain, name) {
      try {
        await call('PUT', teamMailbox(domain, name));
      } catch (err) {
        if (err instanceof TmailRejectedError && err.status === 409) {
          throw new AddressTakenError(err.status, err.body);
        }
        throw err;
      }
    },
    // 404 means the domain is gone, and its team mailboxes with it.
    async deleteTeamMailbox(domain, name) {
      try {
        await call('DELETE', teamMailbox(domain, name));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
    // The root is listed under the team name itself, its folders (INBOX, Sent...) under theirs.
    async rootMailboxId(domain, name) {
      const res = await call('GET', `${teamMailbox(domain, name)}/mailboxes`);
      const folders = (await res.json()) as { mailboxName?: unknown; mailboxId?: unknown }[];
      const root = folders.find((f) => f.mailboxName === name);
      if (typeof root?.mailboxId !== 'string' || !root.mailboxId) {
        throw new Error(`no root mailbox listed for ${name}@${domain}`);
      }
      return root.mailboxId;
    },
    async listMembers(domain, name) {
      try {
        const res = await call('GET', `${teamMailbox(domain, name)}/members`);
        return (await res.json()) as { username: string; role: TeamMailboxRole }[];
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
    },
    async addMember(domain, name, user, role) {
      await call('PUT', `${member(domain, name, user)}?role=${role}`);
    },
    // A missing team mailbox has no members to remove.
    async removeMember(domain, name, user) {
      try {
        await call('DELETE', member(domain, name, user));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
};

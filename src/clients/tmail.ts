export type TeamMailboxRole = 'manager' | 'member';

export interface TmailClient {
  listTeamMailboxes(domain: string): Promise<string[]>;
  createTeamMailbox(domain: string, name: string): Promise<void>;
  rootMailboxId(domain: string, name: string): Promise<string>;
  addMember(domain: string, name: string, user: string, role: TeamMailboxRole): Promise<void>;
  removeMember(domain: string, name: string, user: string): Promise<void>;
}

export interface TmailOptions {
  baseUrl: string;
  password?: string;
}

// One attempt per call: the broker client retries the handler, then dead-letters.
const TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY = 500;

export class TmailError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`TMail webadmin answered ${status}: ${body}`);
  }
}

export class AddressTakenError extends TmailError {}

export const createTmailClient = ({ baseUrl, password }: TmailOptions): TmailClient => {
  const root = baseUrl.replace(/\/+$/, '');

  const call = async (method: 'GET' | 'PUT' | 'DELETE', path: string): Promise<Response> => {
    const res = await fetch(root + path, {
      method,
      headers: password ? { password } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new TmailError(res.status, (await res.text()).slice(0, MAX_ERROR_BODY));
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
        if (err instanceof TmailError && err.status === 409) {
          throw new AddressTakenError(err.status, err.body);
        }
        throw err;
      }
    },
    // The root is listed under the team name itself, its folders (INBOX, Sent...) under theirs.
    async rootMailboxId(domain, name) {
      const res = await call('GET', `${teamMailbox(domain, name)}/mailboxes`);
      const folders = (await res.json()) as { mailboxName: string; mailboxId: string }[];
      const root = folders.find((f) => f.mailboxName === name);
      if (!root) throw new Error(`no root mailbox listed for ${name}@${domain}`);
      return root.mailboxId;
    },
    async addMember(domain, name, user, role) {
      await call('PUT', `${member(domain, name, user)}?role=${role}`);
    },
    async removeMember(domain, name, user) {
      await call('DELETE', member(domain, name, user));
    },
  };
};

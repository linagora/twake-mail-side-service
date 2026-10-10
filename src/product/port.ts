export type TeamMailboxRole = 'manager' | 'member';

export interface TmailClient {
  listTeamMailboxes(domain: string): Promise<string[]>;
  createTeamMailbox(domain: string, name: string): Promise<void>;
  deleteTeamMailbox(domain: string, name: string): Promise<void>;
  rootMailboxId(domain: string, name: string): Promise<string>;
  listMembers(domain: string, name: string): Promise<{ username: string; role: TeamMailboxRole }[]>;
  addMember(domain: string, name: string, user: string, role: TeamMailboxRole): Promise<void>;
  removeMember(domain: string, name: string, user: string): Promise<void>;
}

export class TmailError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`TMail webadmin answered ${status}: ${body}`);
  }
}

export class AddressTakenError extends TmailError {}

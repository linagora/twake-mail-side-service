import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AddressTakenError, createTmailClient, TmailError } from '../../../src/clients/tmail.js';

interface Recorded {
  method?: string;
  url?: string;
  password?: string | string[];
}

let server: http.Server;
let baseUrl: string;
let requests: Recorded[];
let reply: { status: number; body?: string };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, password: req.headers.password });
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests = [];
  reply = { status: 204 };
});

const client = () => createTmailClient({ baseUrl, password: 'secret' });

describe('createTmailClient', () => {
  it('creates a team mailbox with the webadmin password', async () => {
    await client().createTeamMailbox('acme.com', 'sales');

    expect(requests).toEqual([
      { method: 'PUT', url: '/domains/acme.com/team-mailboxes/sales', password: 'secret' },
    ]);
  });

  it('reports an address already held by a user or alias', async () => {
    reply = { status: 409, body: '{"message":"taken"}' };

    await expect(client().createTeamMailbox('acme.com', 'sales')).rejects.toBeInstanceOf(
      AddressTakenError,
    );
  });

  it("lists a domain's team mailbox names", async () => {
    reply = {
      status: 200,
      body: '[{"name":"sales","emailAddress":"sales@acme.com"},{"name":"hr","emailAddress":"hr@acme.com"}]',
    };

    await expect(client().listTeamMailboxes('acme.com')).resolves.toEqual(['sales', 'hr']);
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/domains/acme.com/team-mailboxes' });
  });

  it("finds the id of a team mailbox's root, not of its folders", async () => {
    reply = {
      status: 200,
      body: '[{"mailboxName":"INBOX","mailboxId":"inbox-id"},{"mailboxName":"sales","mailboxId":"root-id"},{"mailboxName":"sales-eu","mailboxId":"other-id"}]',
    };

    await expect(client().rootMailboxId('acme.com', 'sales')).resolves.toBe('root-id');
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/domains/acme.com/team-mailboxes/sales/mailboxes',
    });
  });

  it('fails when the root is not listed', async () => {
    reply = { status: 200, body: '[{"mailboxName":"INBOX","mailboxId":"inbox-id"}]' };

    await expect(client().rootMailboxId('acme.com', 'sales')).rejects.toThrow('sales@acme.com');
  });

  it('fails when the root is listed without an id', async () => {
    reply = { status: 200, body: '[{"mailboxName":"sales"}]' };

    await expect(client().rootMailboxId('acme.com', 'sales')).rejects.toThrow('sales@acme.com');
  });

  it('adds a member with a role', async () => {
    await client().addMember('acme.com', 'sales', 'jane@acme.com', 'manager');

    expect(requests[0]).toMatchObject({
      method: 'PUT',
      url: '/domains/acme.com/team-mailboxes/sales/members/jane%40acme.com?role=manager',
    });
  });

  it('removes a member', async () => {
    await client().removeMember('acme.com', 'sales', 'jane@acme.com');

    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      url: '/domains/acme.com/team-mailboxes/sales/members/jane%40acme.com',
    });
  });

  it("lists a team mailbox's members", async () => {
    reply = {
      status: 200,
      body: '[{"username":"jane@acme.com","role":"manager"},{"username":"bob@acme.com","role":"member"}]',
    };

    await expect(client().listMembers('acme.com', 'sales')).resolves.toEqual([
      'jane@acme.com',
      'bob@acme.com',
    ]);
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/domains/acme.com/team-mailboxes/sales/members',
    });
  });

  it('lists no members for a team mailbox TMail does not have', async () => {
    reply = { status: 404, body: '{"message":"not found"}' };

    await expect(client().listMembers('acme.com', 'sales')).resolves.toEqual([]);
  });

  it('deletes a team mailbox, already gone with its domain or not', async () => {
    await client().deleteTeamMailbox('acme.com', 'sales');
    reply = { status: 404, body: '{"message":"domain not found"}' };
    await client().deleteTeamMailbox('acme.com', 'sales');

    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      url: '/domains/acme.com/team-mailboxes/sales',
    });
  });

  it('throws with the status and body on any other failure', async () => {
    reply = { status: 500, body: 'boom' };

    await expect(
      client().addMember('acme.com', 'sales', 'jane@acme.com', 'member'),
    ).rejects.toMatchObject({ status: 500, body: 'boom' } satisfies Partial<TmailError>);
  });
});

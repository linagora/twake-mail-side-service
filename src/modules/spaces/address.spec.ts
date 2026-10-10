import { describe, expect, it } from 'vitest';
import { candidateNames, mailboxName } from '../../../src/mailbox/address.js';

describe('mailboxName', () => {
  it.each([
    ['Marketing', 'marketing'],
    ['Équipe Été', 'equipe-ete'],
    ['R&D / Paris', 'r-d-paris'],
    ['  --Sales__EU--  ', 'sales__eu'],
    ['Q3 2026 launch!', 'q3-2026-launch'],
    ['🚀', 'space'],
    ['', 'space'],
  ])('turns %j into %j', (name, expected) => {
    expect(mailboxName(name)).toBe(expected);
  });

  it('caps the name at 64 characters without a trailing dash', () => {
    const name = mailboxName(`${'a'.repeat(63)} b`);
    expect(name).toBe('a'.repeat(63));
  });
});

describe('candidateNames', () => {
  it('starts with the name, then adds a number', () => {
    expect(candidateNames('sales').slice(0, 3)).toEqual(['sales', 'sales-2', 'sales-3']);
  });

  it('keeps a numbered name within 64 characters', () => {
    const [, second] = candidateNames('a'.repeat(64));
    expect(second).toBe(`${'a'.repeat(62)}-2`);
  });
});

import { describe, expect, it } from 'vitest';
import { AddressTakenError, TmailRejectedError } from '../product/port.js';
import { MalformedEventError, RejectedEventError } from './errors.js';

describe('dead letter errors', () => {
  it.each([
    new MalformedEventError('bad'),
    new RejectedEventError('refused'),
    new TmailRejectedError(400, 'invalid'),
    new AddressTakenError(409, 'taken'),
  ])('%s is dead lettered by the broker client', (err) => {
    expect(err.name).toBe('DeadLetterError');
  });
});

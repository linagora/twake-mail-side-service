import { DeadLetterError } from '@linagora/rabbitmq-client';

// These two keep the name DeadLetterError: the broker client dead letters by name, not by class.

export class MalformedEventError extends DeadLetterError {}

// A well-formed event the product or the copy refuses for good.
export class RejectedEventError extends DeadLetterError {}

// The event needs an object a later event may still bring.
export class NotYetKnownError extends Error {
  override name = 'NotYetKnownError';
}

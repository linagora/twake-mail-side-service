import { DeadLetterError } from '@linagora/rabbitmq-client';
import { z } from 'zod';

// A malformed event stays malformed: retrying it only delays the dead letter queue.
export const parseEvent = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => {
  const result = schema.safeParse(body);
  if (!result.success) throw new DeadLetterError(z.prettifyError(result.error));
  return result.data;
};

export const spaceRole = z.enum(['viewer', 'editor', 'admin']);
export type SpaceRole = z.infer<typeof spaceRole>;

const member = z.looseObject({
  uuid: z.uuid(),
  email: z.string().min(1),
  role: spaceRole,
});

export const spaceCreated = z.looseObject({
  organizationId: z.string().min(1),
  id: z.uuid(),
  name: z.string(),
  members: z.array(member).default([]),
});

export const memberChanged = z.looseObject({
  organizationId: z.string().min(1),
  id: z.uuid(),
  members: z.array(member),
});

export const dnsValidated = z.looseObject({
  organizationId: z.string().min(1),
  domain: z.string().min(1),
  mailDnsConfigurationValidated: z.boolean().default(false),
});

export const userDeleted = z.looseObject({
  uuid: z.uuid(),
});

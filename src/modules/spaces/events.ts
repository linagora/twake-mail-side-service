import { z } from 'zod';
import { MalformedEventError } from '../../events/errors.js';

export const parseEvent = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => {
  const result = schema.safeParse(body);
  if (!result.success) throw new MalformedEventError(z.prettifyError(result.error));
  return result.data;
};

export const spaceRole = z.enum(['viewer', 'editor', 'admin']);
export type SpaceRole = z.infer<typeof spaceRole>;

const member = z.looseObject({
  uuid: z.uuid(),
  email: z.string().min(1),
  role: spaceRole,
});

const timestamp = z.iso.datetime({ offset: true });

// twake.space.synced has the same shape, with every member and their role through linked groups.
export const spaceCreated = z.looseObject({
  organizationId: z.string().min(1),
  id: z.uuid(),
  name: z.string(),
  members: z.array(member).default([]),
  timestamp,
});

export const spaceRenamed = z.looseObject({
  id: z.uuid(),
  name: z.string(),
  timestamp,
});

export const spaceDeleted = z.looseObject({
  id: z.uuid(),
});

export const memberChanged = z.looseObject({
  organizationId: z.string().min(1),
  id: z.uuid(),
  members: z.array(member),
  timestamp,
});

export const syncCompleted = z.looseObject({
  organizationId: z.string().min(1),
  spaceIds: z.array(z.uuid()),
  timestamp,
});

export const dnsValidated = z.looseObject({
  organizationId: z.string().min(1),
  domain: z.string().min(1),
  mailDnsConfigurationValidated: z.boolean().default(false),
});

export const userDeleted = z.looseObject({
  uuid: z.uuid(),
});

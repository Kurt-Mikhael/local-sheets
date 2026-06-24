import { z } from 'zod'

export const emailSchema = z.string().trim().toLowerCase().email().max(320)
export const passwordSchema = z.string().min(10).max(128)

export const authSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).strict()

const snapshotSchema = z.record(z.string(), z.unknown())

export const syncChangeSchema = z.object({
  operationId: z.uuid(),
  workbookId: z.uuid(),
  baseVersion: z.number().int().min(0).max(2_147_483_647),
  title: z.string().trim().min(1).max(120),
  snapshot: snapshotSchema,
  deleted: z.boolean(),
  clientUpdatedAt: z.iso.datetime(),
}).strict()

export const syncRequestSchema = z.object({
  clientId: z.uuid(),
  cursor: z.string().max(1024).optional(),
  changes: z.array(syncChangeSchema).max(25),
}).strict()

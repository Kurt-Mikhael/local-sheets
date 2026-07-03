import { z } from 'zod';
export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const passwordSchema = z.string().min(8).max(128);
export const authSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
}).strict();
const SAFE_KEY = /^(?:[a-zA-Z0-9][a-zA-Z0-9_\-.]{0,127}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const FORBIDDEN_KEY_RE = /^(__proto__|constructor|prototype)$/i;
const safeKey = z.string()
    .regex(SAFE_KEY, 'Key tidak valid')
    .refine((k) => !FORBIDDEN_KEY_RE.test(k), { message: 'Key terlarang.' });
const safeJsonValue = z.lazy(() => z.union([
    z.string().max(1_000_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(safeJsonValue).max(10_000),
    z.record(safeKey, safeJsonValue),
]));
export const snapshotSchema = safeJsonValue.refine((v) => JSON.stringify(v).length < 1_000_000, { message: 'Snapshot terlalu besar (maks 1MB).' });
const titleSchema = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[\P{Cc}]+$/u, 'Karakter kontrol tidak diizinkan.');
export const syncChangeSchema = z.object({
    operationId: z.uuid(),
    workbookId: z.uuid(),
    baseVersion: z.number().int().min(0).max(2_147_483_647),
    title: titleSchema,
    snapshot: snapshotSchema,
    deleted: z.boolean(),
    clientUpdatedAt: z.iso.datetime(),
}).strict();
export const syncRequestSchema = z.object({
    clientId: z.uuid(),
    cursor: z.string().max(1024).optional(),
    changes: z.array(syncChangeSchema).max(25),
}).strict();
//# sourceMappingURL=schemas.js.map
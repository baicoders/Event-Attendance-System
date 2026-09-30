import { z } from "zod";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const LARGE_IMPORT_ROWS = 2000;
export const CSV_HEADERS = [
  "id", "lastName", "firstName", "middleName", "schoolLevel", "yearLevel",
  "section", "house", "program", "department", "strand",
] as const;

export const IMPORT_GROUP_FIELDS = {
  section: "SECTION", house: "HOUSE", program: "PROGRAM",
  department: "DEPARTMENT", strand: "STRAND",
} as const;
export type ImportGroupField = keyof typeof IMPORT_GROUP_FIELDS;
export type ImportField = (typeof CSV_HEADERS)[number];

const canonicalRowSchema = z.object({
  id: z.string(), lastName: z.string(), firstName: z.string(), middleName: z.string(),
  schoolLevel: z.string(), yearLevel: z.string(), section: z.string(), house: z.string(),
  program: z.string(), department: z.string(), strand: z.string(),
}).strict();
export type CanonicalRow = z.infer<typeof canonicalRowSchema>;
export type ParsedImportRow = { csvRow: number; student: CanonicalRow };
export type ImportCsvError = { csvRow?: number; code: string; message: string };
export type ParsedStudentImport = { rows: ParsedImportRow[]; errors: ImportCsvError[] };

export const importRequestSchema = z.object({
  v: z.literal(1),
  fileName: z.string().min(1).max(200)
    .refine((name) => name.trim().length > 0 && !/[\\/\u0000-\u001f\u007f]/.test(name) && name.trim() !== "." && name.trim() !== "..", "Use a display basename without paths or control characters"),
  sourceHash: z.string().regex(/^[a-fA-F0-9]{64}$/, "Expected SHA-256 hex digest"),
  csv: z.string().max(MAX_IMPORT_BYTES).refine((csv) => new TextEncoder().encode(csv).byteLength <= MAX_IMPORT_BYTES, "CSV exceeds the 10 MiB technical byte limit"),
}).strict();
export const commitRequestSchema = importRequestSchema.extend({
  previewToken: z.string().min(1).max(4096),
}).strict();
export type ImportRequest = z.infer<typeof importRequestSchema>;
export type ImportCommitRequest = z.infer<typeof commitRequestSchema>;

export type ImportGroup = { id: string; slug: string; name: string; category: string };
export type ExistingImportStudent = {
  id: string; firstName: string; lastName: string; middleName: string | null;
  schoolLevel: string; yearLevel: string; createdAt: Date | string; updatedAt: Date | string;
  groups: ImportGroup[];
};

export const importCountsSchema = z.object({
  total: z.number().int().nonnegative(), create: z.number().int().nonnegative(),
  update: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
}).strict();
export type ImportCounts = z.infer<typeof importCountsSchema>;
const reasonSchema = z.object({
  code: z.string(), field: z.enum(CSV_HEADERS).optional(), message: z.string(),
}).strict();
export type ImportReason = z.infer<typeof reasonSchema>;
const changeSchema = z.object({
  field: z.enum(CSV_HEADERS), before: z.string().nullable(), after: z.string().nullable(),
}).strict();
export type ImportChange = z.infer<typeof changeSchema>;
const reviewRowSchema = z.object({
  csvRow: z.number().int().positive(), student: canonicalRowSchema,
  status: z.enum(["CREATE", "UPDATE", "UNCHANGED", "BLOCKED"]),
  changes: z.array(changeSchema), reasons: z.array(reasonSchema), groupIds: z.array(z.string()),
}).strict();
export type ImportReviewRow = z.infer<typeof reviewRowSchema>;
const unknownGroupSchema = z.object({
  slug: z.string(), category: z.enum(["SECTION", "HOUSE", "PROGRAM", "DEPARTMENT", "STRAND"]),
  referenceCount: z.number().int().positive(),
}).strict();
export type UnknownImportGroup = z.infer<typeof unknownGroupSchema>;
export type ImportReview = { rows: ImportReviewRow[]; counts: ImportCounts; unknownGroups: UnknownImportGroup[] };
export const importPreviewSchema = z.object({
  v: z.literal(1), rows: z.array(reviewRowSchema), counts: importCountsSchema,
  unknownGroups: z.array(unknownGroupSchema), previewToken: z.string().max(4096).nullable(),
  preparedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).strict();
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export const importCommitResultSchema = z.object({
  v: z.literal(1), counts: importCountsSchema, committedAt: z.iso.datetime(),
}).strict();
export type ImportCommitResult = z.infer<typeof importCommitResultSchema>;

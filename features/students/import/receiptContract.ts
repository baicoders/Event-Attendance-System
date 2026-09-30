import { z } from "zod";
import { studentSchema } from "@/globals/schemas/studentSchema";
import { normalizeStudentImportRow } from "./classify";
import {
  CSV_HEADERS, MAX_IMPORT_BYTES, importCountsSchema, importPreviewSchema,
  importRequestSchema, type CanonicalRow, type ImportCounts, type ImportField,
  type ImportReview,
} from "./contract";

const studentId = z.string().length(11).refine((value) => value === value.trim(), "Student ID must already be normalized");
const receiptStudentSchema = importPreviewSchema.shape.rows.element.shape.student.superRefine((student, ctx) => {
  const validation = studentSchema.safeParse(student);
  if (!validation.success) {
    for (const issue of validation.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
  const normalized = normalizeStudentImportRow(student);
  for (const field of CSV_HEADERS) {
    if (student[field] !== normalized[field]) ctx.addIssue({ code: "custom", path: [field], message: "Receipt student projection must already be normalized" });
  }
});

const changeFields = CSV_HEADERS.filter((field) => field !== "id") as Exclude<ImportField, "id">[];
const changeSchema = z.object({
  field: z.enum(changeFields), before: z.string().nullable(), after: z.string().nullable(),
}).strict().refine((change) => change.before !== change.after, "Receipt changes must be material");
const changesSchema = z.array(changeSchema).min(1).superRefine((changes, ctx) => {
  const fields = new Set<string>();
  for (const [index, change] of changes.entries()) {
    if (fields.has(change.field)) ctx.addIssue({ code: "custom", path: [index, "field"], message: "A receipt may only record one change per field" });
    fields.add(change.field);
  }
});
const rowIdentity = { csvRow: z.number().int().min(2), studentId };
const receiptRowSchema = z.discriminatedUnion("status", [
  z.object({ ...rowIdentity, status: z.literal("CREATE"), student: receiptStudentSchema }).strict(),
  z.object({ ...rowIdentity, status: z.literal("UPDATE"), studentLabel: z.string().min(1).max(302).refine((value) => value === value.trim()), changes: changesSchema }).strict(),
  z.object({ ...rowIdentity, status: z.literal("UNCHANGED") }).strict(),
]);
export type ReceiptRow = z.infer<typeof receiptRowSchema>;

function addByteLimitIssue(value: unknown, ctx: z.RefinementCtx) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_IMPORT_BYTES) {
    ctx.addIssue({ code: "custom", message: "Serialized receipt exceeds the 10 MiB technical byte limit" });
  }
}

export const receiptResultSchema = z.object({
  v: z.literal(1), rows: z.array(receiptRowSchema).min(1),
}).strict().superRefine((result, ctx) => {
  const ids = new Set<string>();
  const physicalRows = new Set<number>();
  for (const [index, row] of result.rows.entries()) {
    if (ids.has(row.studentId)) ctx.addIssue({ code: "custom", path: ["rows", index, "studentId"], message: "Duplicate receipt student ID" });
    if (physicalRows.has(row.csvRow)) ctx.addIssue({ code: "custom", path: ["rows", index, "csvRow"], message: "Duplicate physical CSV row" });
    ids.add(row.studentId); physicalRows.add(row.csvRow);
    if (row.status === "CREATE" && row.student.id !== row.studentId) ctx.addIssue({ code: "custom", path: ["rows", index, "studentId"], message: "Created projection must match its receipt identity" });
  }
  addByteLimitIssue(result, ctx);
});
export type ReceiptResult = z.infer<typeof receiptResultSchema>;

const receiptCountsSchema = importCountsSchema.superRefine((counts, ctx) => {
  if (counts.blocked !== 0 || counts.total === 0 || counts.total !== counts.create + counts.update + counts.unchanged) {
    ctx.addIssue({ code: "custom", message: "A committed receipt must contain consistent nonblocked counts" });
  }
});
export const receiptMetadataSchema = z.object({
  v: z.literal(1), id: z.string().min(1).max(128),
  commandId: z.uuid().transform((value) => value.toLowerCase()),
  actorId: z.string().min(1).max(128),
  actorNameSnapshot: z.string().min(1).refine((value) => value.trim().length > 0),
  fileName: importRequestSchema.shape.fileName,
  sourceFileHash: z.string().regex(/^[a-f0-9]{64}$/),
  normalizedInputHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  counts: receiptCountsSchema,
  createdAt: z.iso.datetime(), committedAt: z.iso.datetime(),
}).strict().refine((metadata) => Date.parse(metadata.createdAt) <= Date.parse(metadata.committedAt), "Receipt commit cannot precede its creation observation");
export type ReceiptMetadata = z.infer<typeof receiptMetadataSchema>;

function resultCounts(rows: ReceiptRow[]): ImportCounts {
  const counts: ImportCounts = { total: rows.length, create: 0, update: 0, unchanged: 0, blocked: 0 };
  for (const row of rows) {
    if (row.status === "CREATE") counts.create++;
    else if (row.status === "UPDATE") counts.update++;
    else counts.unchanged++;
  }
  return counts;
}
function matchingCounts(expected: ImportCounts, actual: ImportCounts): boolean {
  return expected.total === actual.total && expected.create === actual.create && expected.update === actual.update && expected.unchanged === actual.unchanged && expected.blocked === actual.blocked;
}

export const receiptSchema = receiptMetadataSchema.safeExtend({ result: receiptResultSchema }).superRefine((receipt, ctx) => {
  if (!matchingCounts(receipt.counts, resultCounts(receipt.result.rows))) ctx.addIssue({ code: "custom", path: ["counts"], message: "Receipt metadata counts disagree with retained row statuses" });
  addByteLimitIssue(receipt, ctx);
});
export type Receipt = z.infer<typeof receiptSchema>;
export const receiptCommitResponseSchema = z.object({ receipt: receiptSchema, replayed: z.boolean() }).strict();
export type ReceiptCommitResponse = z.infer<typeof receiptCommitResponseSchema>;
export const receiptHistorySchema = z.object({ items: z.array(receiptMetadataSchema).max(20), nextCursor: z.string().min(1).max(4096).nullable() }).strict();
export type ReceiptHistory = z.infer<typeof receiptHistorySchema>;

const reviewSchema = importPreviewSchema.pick({ rows: true, counts: true, unknownGroups: true });
const optionalFields = new Set<ImportField>(["middleName", "program", "department", "strand"]);
const changeValue = (student: CanonicalRow, field: ImportField) => optionalFields.has(field) && student[field] === "" ? null : student[field];

/** Build historical evidence from the already classified review; never classify again. */
export function buildImportReceiptResult(review: ImportReview): ReceiptResult {
  const validated = reviewSchema.parse(review);
  if (validated.unknownGroups.length || validated.counts.blocked || validated.rows.some((row) => row.status === "BLOCKED" || row.reasons.length)) {
    throw new Error("Cannot retain a receipt for a blocked import review");
  }
  const rows: ReceiptRow[] = validated.rows.map((row) => {
    const student = receiptStudentSchema.parse(row.student);
    const identity = { csvRow: row.csvRow, studentId: student.id };
    if (row.status === "CREATE") {
      if (row.changes.length) throw new Error("Created review rows cannot contain update changes");
      return { ...identity, status: "CREATE", student };
    }
    if (row.status === "UNCHANGED") {
      if (row.changes.length) throw new Error("Unchanged review rows cannot contain update changes");
      return { ...identity, status: "UNCHANGED" };
    }
    const changes = changesSchema.parse(row.changes);
    for (const change of changes) {
      if (change.after !== changeValue(student, change.field)) throw new Error("Receipt changes disagree with the normalized reviewed projection");
    }
    return { ...identity, status: "UPDATE", studentLabel: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "), changes };
  });
  if (!matchingCounts(validated.counts, resultCounts(rows))) throw new Error("Import review counts disagree with row statuses");
  return receiptResultSchema.parse({ v: 1, rows });
}

/** Validate retained JSON and metadata together before insertion or API projection. */
export function validateImportReceipt(receipt: unknown): Receipt {
  return receiptSchema.parse(receipt);
}

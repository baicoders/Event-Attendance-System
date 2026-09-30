import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalRow, ImportReview } from "./contract";

const contracts = import("./receiptContract").catch(() => null);
const student: CanonicalRow = { id: "00000000001", lastName: "Doe", firstName: "Jane", middleName: "", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: "bsit-1a", house: "red", program: "bsit", department: "cs", strand: "" };
const changes = [{ field: "firstName" as const, before: "John", after: "Jane" }];
const counts = { total: 3, create: 1, update: 1, unchanged: 1, blocked: 0 };
const review = (): ImportReview => ({ counts: { ...counts }, unknownGroups: [], rows: [
  { csvRow: 2, student: { ...student }, status: "CREATE", changes: [], reasons: [], groupIds: ["section", "house", "program", "department"] },
  { csvRow: 4, student: { ...student, id: "00000000002" }, status: "UPDATE", changes: changes.map((change) => ({ ...change })), reasons: [], groupIds: ["section", "house", "program", "department"] },
  { csvRow: 5, student: { ...student, id: "00000000003" }, status: "UNCHANGED", changes: [], reasons: [], groupIds: ["section", "house", "program", "department"] },
] });
const result = () => ({ v: 1, rows: [
  { csvRow: 2, studentId: "00000000001", status: "CREATE", student: { ...student } },
  { csvRow: 4, studentId: "00000000002", status: "UPDATE", studentLabel: "Jane Doe", changes: changes.map((change) => ({ ...change })) },
  { csvRow: 5, studentId: "00000000003", status: "UNCHANGED" },
] });
const metadata = () => ({ v: 1, id: "receipt-1", commandId: "6321ef49-c004-4540-bc8d-331b87e00c4b", actorId: "admin-1", actorNameSnapshot: "Admin Name", fileName: "students.csv", sourceFileHash: "a".repeat(64), normalizedInputHash: "b".repeat(64), requestHash: "c".repeat(64), counts: { ...counts }, createdAt: "2026-09-30T10:00:00.000Z", committedAt: "2026-09-30T10:00:01.000Z" });
const receipt = () => ({ ...metadata(), result: result() });

test("receipt builder retains creation projection and exact update changes but compacts no-ops", async () => {
  const api = await contracts; assert.ok(api, "receipt contracts and builder must exist");
  const source = review();
  const built = api.buildImportReceiptResult(source);
  assert.deepEqual(built, result());
  source.rows[0].student.firstName = "Changed later";
  source.rows[1].changes[0].after = "Changed later";
  assert.deepEqual(built, result());
  assert.equal(JSON.stringify(built).includes("groupIds"), false);
});

test("receipt builder rejects blocked, inconsistent or unnormalized reviews", async () => {
  const api = await contracts; assert.ok(api);
  const invalid: ImportReview[] = [];
  const blocked = review(); blocked.rows[0].status = "BLOCKED"; blocked.counts.create = 0; blocked.counts.blocked = 1; invalid.push(blocked);
  const reason = review(); reason.rows[0].reasons = [{ code: "UNKNOWN_GROUP", message: "Missing group" }]; invalid.push(reason);
  const unknown = review(); unknown.unknownGroups = [{ slug: "missing", category: "SECTION", referenceCount: 1 }]; invalid.push(unknown);
  const inconsistent = review(); inconsistent.counts.update = 0; inconsistent.counts.unchanged = 2; invalid.push(inconsistent);
  const wrongProjection = review(); wrongProjection.rows[0].student.firstName = " Jane "; invalid.push(wrongProjection);
  const invalidDomain = review(); invalidDomain.rows[0].student.department = ""; invalid.push(invalidDomain);
  const wrongChange = review(); wrongChange.rows[1].changes[0].after = "Other name"; invalid.push(wrongChange);
  const noChange = review(); noChange.rows[1].changes = []; invalid.push(noChange);
  const fabricatedNoopChange = review(); fabricatedNoopChange.rows[2].changes = changes; invalid.push(fabricatedNoopChange);
  for (const source of invalid) assert.throws(() => api.buildImportReceiptResult(source));
});

test("receipt metadata and result status counts must agree", async () => {
  const api = await contracts; assert.ok(api);
  assert.deepEqual(api.validateImportReceipt(receipt()), receipt());
  assert.equal(api.receiptMetadataSchema.safeParse(metadata()).success, true);
  for (const invalid of [
    { ...receipt(), counts: { ...counts, total: 4 } },
    { ...receipt(), counts: { ...counts, create: 0, update: 2 } },
    { ...receipt(), counts: { ...counts, blocked: 1 } },
    { ...receipt(), counts: { ...counts, unchanged: -1 } },
    { ...receipt(), counts: { ...counts, create: 1.5 } },
    { ...receipt(), counts: { total: 0, create: 0, update: 0, unchanged: 0, blocked: 0 } },
  ]) assert.throws(() => api.validateImportReceipt(invalid));
});

test("result rejects duplicate identities and physical source rows", async () => {
  const api = await contracts; assert.ok(api);
  const identities = result(); identities.rows[2].studentId = "00000000002";
  const physicalRows = result(); physicalRows.rows[2].csvRow = 4;
  const headerRow = result(); headerRow.rows[0].csvRow = 1;
  const mismatchedCreation = result(); mismatchedCreation.rows[0].studentId = "00000000004";
  for (const invalid of [identities, physicalRows, headerRow, mismatchedCreation, { v: 2, rows: [] }, { v: 1, rows: [] }]) {
    assert.equal(api.receiptResultSchema.safeParse(invalid).success, false);
  }
});

test("receipt projections reject raw payload retention and malformed changes", async () => {
  const api = await contracts; assert.ok(api);
  for (const invalidRow of [
    { csvRow: 2, studentId: student.id, status: "BLOCKED" },
    { csvRow: 2, studentId: student.id, status: "UNCHANGED", csv: "secret source" },
    { csvRow: 2, studentId: student.id, status: "UNCHANGED", student },
    { csvRow: 2, studentId: student.id, status: "UPDATE", studentLabel: "Jane Doe", changes: [] },
    { csvRow: 2, studentId: student.id, status: "UPDATE", studentLabel: "Jane Doe", changes: [{ field: "id", before: student.id, after: "00000000002" }] },
    { csvRow: 2, studentId: student.id, status: "UPDATE", studentLabel: "Jane Doe", changes: [{ field: "firstName", before: "Jane", after: "Jane" }] },
    { csvRow: 2, studentId: student.id, status: "UPDATE", studentLabel: "Jane Doe", changes: [...changes, ...changes] },
    { csvRow: 2, studentId: student.id, status: "CREATE", student: { ...student, parserMetadata: {} } },
    { csvRow: 2, studentId: student.id, status: "CREATE", student: { ...student, section: " BSIT-1A " } },
    { csvRow: 2, studentId: student.id, status: "CREATE", student: { ...student, schoolLevel: "SHS" } },
  ]) assert.equal(api.receiptResultSchema.safeParse({ v: 1, rows: [invalidRow] }).success, false);
});

test("metadata rejects paths, malformed hashes, identity and observation timestamps", async () => {
  const api = await contracts; assert.ok(api);
  for (const invalid of [
    { ...metadata(), fileName: "../students.csv" }, { ...metadata(), fileName: "a".repeat(201) },
    { ...metadata(), actorNameSnapshot: " " }, { ...metadata(), commandId: "not-a-uuid" },
    { ...metadata(), sourceFileHash: "z".repeat(64) }, { ...metadata(), requestHash: "a".repeat(65) },
    { ...metadata(), createdAt: "invalid" }, { ...metadata(), committedAt: "2026-09-29T10:00:00.000Z" },
    { ...metadata(), rawCsv: "source" }, { ...metadata(), v: 2 },
  ]) assert.equal(api.receiptMetadataSchema.safeParse(invalid).success, false);
});

test("historical actor attribution preserves existing names without a new account-name limit", async () => {
  const api = await contracts; assert.ok(api);
  const source = { ...receipt(), actorNameSnapshot: "Existing admin name ".repeat(100) };
  assert.equal(api.validateImportReceipt(source).actorNameSnapshot, source.actorNameSnapshot);
});

test("large compact receipts are accepted without a row cap", async () => {
  const api = await contracts; assert.ok(api);
  const rows = Array.from({ length: 5005 }, (_, index) => ({ csvRow: index + 2, studentId: String(index).padStart(11, "0"), status: "UNCHANGED" as const }));
  const source = { ...metadata(), counts: { total: 5005, create: 0, update: 0, unchanged: 5005, blocked: 0 }, result: { v: 1, rows } };
  assert.equal(api.receiptSchema.safeParse(source).success, true);
  const sourceReview: ImportReview = { counts: source.counts, unknownGroups: [], rows: rows.map((row) => ({ csvRow: row.csvRow, student: { ...student, id: row.studentId }, status: "UNCHANGED", changes: [], reasons: [], groupIds: ["section", "house", "program", "department"] })) };
  assert.equal(api.buildImportReceiptResult(sourceReview).rows.length, 5005);
});

test("serialized UTF-8 bytes bound large results even when character count is smaller", async () => {
  const api = await contracts; assert.ok(api);
  const rows = Array.from({ length: 15000 }, (_, index) => {
    const id = String(index).padStart(11, "0");
    return { csvRow: index + 2, studentId: id, status: "CREATE" as const, student: { ...student, id, firstName: "é".repeat(100), lastName: "é".repeat(100), middleName: "é".repeat(100) } };
  });
  const source = { v: 1, rows };
  assert.ok(JSON.stringify(source).length < 10 * 1024 * 1024);
  assert.ok(new TextEncoder().encode(JSON.stringify(source)).byteLength > 10 * 1024 * 1024);
  assert.equal(api.receiptResultSchema.safeParse(source).success, false);
  const sourceReview: ImportReview = { counts: { total: rows.length, create: rows.length, update: 0, unchanged: 0, blocked: 0 }, unknownGroups: [], rows: rows.map((row) => ({ csvRow: row.csvRow, student: row.student, status: "CREATE", changes: [], reasons: [], groupIds: ["section", "house", "program", "department"] })) };
  assert.throws(() => api.buildImportReceiptResult(sourceReview));
});

test("byte limit accepts exact result boundary while protecting complete receipt metadata overhead", async () => {
  const api = await contracts; assert.ok(api);
  const source = { v: 1, rows: [{ csvRow: 2, studentId: student.id, status: "UPDATE", studentLabel: "Jane Doe", changes: [{ field: "section", before: "", after: "bsit-1a" }] }] };
  const overhead = new TextEncoder().encode(JSON.stringify(source)).byteLength;
  source.rows[0].changes[0].before = "x".repeat(10 * 1024 * 1024 - overhead);
  assert.equal(new TextEncoder().encode(JSON.stringify(source)).byteLength, 10 * 1024 * 1024);
  assert.equal(api.receiptResultSchema.safeParse(source).success, true);
  assert.equal(api.receiptSchema.safeParse({ ...metadata(), counts: { total: 1, create: 0, update: 1, unchanged: 0, blocked: 0 }, result: source }).success, false);
  source.rows[0].changes[0].before += "x";
  assert.equal(api.receiptResultSchema.safeParse(source).success, false);
});

test("commit and history expose validated receipt data with strict response envelopes", async () => {
  const api = await contracts; assert.ok(api);
  assert.equal(api.receiptCommitResponseSchema.safeParse({ receipt: receipt(), replayed: false }).success, true);
  assert.equal(api.receiptCommitResponseSchema.safeParse({ receipt: receipt(), replayed: true }).success, true);
  assert.equal(api.receiptCommitResponseSchema.safeParse({ receipt: receipt(), replayed: "true" }).success, false);
  assert.equal(api.receiptHistorySchema.safeParse({ items: [metadata()], nextCursor: "cursor" }).success, true);
  assert.equal(api.receiptHistorySchema.safeParse({ items: [], nextCursor: null }).success, true);
  assert.equal(api.receiptHistorySchema.safeParse({ items: [receipt()], nextCursor: null }).success, false);
  assert.equal(api.receiptHistorySchema.safeParse({ items: Array.from({ length: 20 }, (_, index) => ({ ...metadata(), id: `receipt-${index}` })), nextCursor: null }).success, true);
  assert.equal(api.receiptHistorySchema.safeParse({ items: Array.from({ length: 21 }, (_, index) => ({ ...metadata(), id: `receipt-${index}` })), nextCursor: null }).success, false);
});

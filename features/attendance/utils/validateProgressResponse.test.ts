import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/globals/utils/api";
import { validateProgressResponse } from "./validateProgressResponse";

const counts = { eligible: 1, checkedIn: 0, notYet: 1, rate: 0 };
const valid = {
  event: { id: "event", title: "Event", status: "APPROVED", isTimeout: false },
  evaluatedAt: "2026-09-25T00:00:00.000Z", audienceSignature: "[]", populationBasis: "CURRENT_ROSTER",
  groupBy: "SECTION", totals: counts, diagnostics: { recordsWithoutTimeIn: 0 },
  breakdown: [{ bucketKey: "none", label: "No section", ...counts }],
  detail: { bucketKey: "all", bucketLabel: "All eligible students", status: "NOT_YET", query: "",
    bucketTotals: counts, matchedCount: 1, page: 1, pageSize: 50,
    rows: [{ studentId: "S1", fullName: "Student, One", schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
      sectionLabel: "No section", checkedIn: false, timein: null, timeout: null, recordNeedsReview: false }],
  },
};

test("accepts a complete progress response", () => {
  assert.deepEqual(validateProgressResponse(valid).detail?.rows[0].studentId, "S1");
});

test("rejects malformed success payloads as recoverable server errors", () => {
  for (const payload of [null, {}, { ...valid, totals: null }, { ...valid, detail: { ...valid.detail, rows: null } }]) {
    assert.throws(() => validateProgressResponse(payload),
      (error: unknown) => error instanceof ApiError && error.status === 502 && error.code === "INVALID_PROGRESS_RESPONSE");
  }
});

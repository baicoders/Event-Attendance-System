import assert from "node:assert/strict";
import test from "node:test";

import { formatReportClock, formatReportDateTime, formatReportEventDate } from "./reportTime";

test("report timestamps use Asia/Manila regardless of host locale", () => {
  assert.equal(formatReportDateTime("2026-09-25T08:10:24.000Z"), "2026-09-25 16:10:24");
  assert.equal(formatReportClock("2026-09-25T08:10:24.000Z"), "16:10");
  assert.equal(formatReportDateTime(null), "");
  assert.equal(formatReportEventDate("2026-09-25T00:00:00.000Z", true), "2026-09-25");
});

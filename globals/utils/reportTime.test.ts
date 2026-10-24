import assert from "node:assert/strict";
import test from "node:test";

import { formatReportClock, formatReportDateTime, formatReportEventDate, formatReportEventSchedule } from "./reportTime";

test("report timestamps use Asia/Manila regardless of host locale", () => {
  assert.equal(formatReportDateTime("2026-09-25T08:10:24.000Z"), "2026-09-25 16:10:24");
  assert.equal(formatReportClock("2026-09-25T08:10:24.000Z"), "16:10");
  assert.equal(formatReportDateTime(null), "");
  assert.equal(formatReportEventDate("2026-09-25T00:00:00.000Z", true), "2026-09-25");
});


test("printed schedules combine same-day times and retain both dates across Manila midnight", () => {
  assert.equal(formatReportEventSchedule("2026-10-23T01:00:00Z", "2026-10-23T09:30:00Z", false), "Oct 23, 2026 · 9:00 AM – 5:30 PM");
  assert.equal(formatReportEventSchedule("2026-10-23T15:46:12Z", "2026-10-23T16:46:12Z", false), "Oct 23, 2026, 11:46 PM – Oct 24, 2026, 12:46 AM");
});

test("all-day print schedules use UTC calendar dates and support dates across years", () => {
  assert.equal(formatReportEventSchedule("2026-10-23T00:00:00Z", "2026-10-23T00:00:00Z", true), "Oct 23, 2026 · All day");
  assert.equal(formatReportEventSchedule("2026-10-23T00:00:00Z", "2026-10-24T00:00:00Z", true), "Oct 23 – 24, 2026 · All day");
  assert.equal(formatReportEventSchedule("2026-12-31T00:00:00Z", "2027-01-01T00:00:00Z", true), "Dec 31, 2026 – Jan 1, 2027 · All day");
});

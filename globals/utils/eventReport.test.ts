import assert from "node:assert/strict";
import test from "node:test";

import { buildEventReport, type EventReportSnapshot } from "./eventReport";

const group = { id: "custom-1", name: "Student Council", slug: "student-council", category: "CUSTOM" as const };
const section = { id: "section-1", name: "CS 1-A", slug: "cs-1-a", category: "SECTION" };
const snapshot = {
  evaluatedAt: "2026-10-23T08:00:00.000Z",
  event: { id: "event-1", title: "Assembly", category: "CUSTOM", includedGroups: [group], start: new Date("2026-10-23T06:00:00Z"), end: new Date("2026-10-23T10:00:00Z"), allDay: false, lateAfterMinutes: null, requiresTimeout: false },
  students: [
    { id: "internal-1", usn: "00000123456", lrn: null, firstName: "Alex", middleName: null, lastName: "Rivera", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", groups: [section], customMemberships: [{ studentId: "internal-1", groupId: group.id, position: "President", group }] },
    { id: "internal-2", usn: null, lrn: "000000123456", firstName: "Sam", middleName: null, lastName: "Rivera", schoolLevel: null, yearLevel: null, groups: [], customMemberships: [{ studentId: "internal-2", groupId: group.id, position: null, group }] },
  ],
  records: [{ id: "record-1", studentId: "internal-1", eventId: "event-1", timein: new Date("2026-10-23T06:00:00Z"), timeout: null, method: "SCANNED" }],
} as unknown as EventReportSnapshot;

test("report rows carry external identifiers and membership positions while academic sections and totals stay intact", () => {
  const report = buildEventReport(snapshot);
  assert.equal(report.rows[0].usn, "00000123456");
  assert.equal(report.rows[0].customGroup, "Student Council");
  assert.equal(report.rows[0].position, "President");
  assert.equal(report.rows[0].section, "CS 1-A");
  assert.equal(report.rows[1].lrn, "000000123456");
  assert.equal(report.rows[1].position, null);
  assert.equal(report.rows[1].section, null);
  assert.equal(report.totals.eligible, 2);
  assert.equal(report.totals.attended, 1);
  assert.equal(report.totals.absent, 1);
});

test("custom event rows never attribute a position from an unrelated membership", () => {
  const report = buildEventReport({ ...snapshot, students: [{ ...snapshot.students[0], customMemberships: [{ studentId: "internal-1", groupId: "other", position: "Treasurer", group: { ...group, id: "other" } }] }] });
  assert.equal(report.rows[0].customGroup, null);
  assert.equal(report.rows[0].position, null);
});

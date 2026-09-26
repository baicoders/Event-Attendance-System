import assert from "node:assert/strict";
import test from "node:test";
import { projectStudentHistory } from "./studentHistoryProjection";

const at = (day: string, hour = "08:00") => new Date(`${day}T${hour}:00+08:00`);
const event = (id: string, day: string, group = "a", endDay = day) => ({
  id, title: id, category: "SECTION" as const, start: at(day), end: at(endDay, "12:00"),
  allDay: false, includedGroups: [{ slug: group }],
});
const student = { id: "0001", firstName: "Ana", lastName: "Lee", middleName: null,
  schoolLevel: "COLLEGE" as const, groups: [{ slug: "a", name: "A", category: "SECTION" as const }] };

test("recorded rows survive a current audience mismatch without changing the denominator", () => {
  const events = [event("on-time", "2026-09-20"), event("late", "2026-09-21"),
    event("missing", "2026-09-22"), event("incomplete", "2026-09-23"),
    event("outside", "2026-09-24", "b")];
  const records = [
    { id: "r1", eventId: "on-time", timein: at("2026-09-20"), timeout: null, method: "SCANNED" as const },
    { id: "r2", eventId: "late", timein: at("2026-09-21", "08:30"), timeout: null, method: "SCANNED" as const },
    { id: "r3", eventId: "incomplete", timein: null, timeout: null, method: "MANUAL" as const },
    { id: "r4", eventId: "outside", timein: at("2026-09-24"), timeout: null, method: "SCANNED" as const },
  ];
  const input = { student, events, records, todayStart: at("2026-09-26", "00:00"), view: "recorded" as const, outcome: "all" as const, search: "", page: 1, pageSize: 10 };
  const recorded = projectStudentHistory(input);
  assert.equal(recorded.summary.recordedTimeIns, 3);
  assert.equal(recorded.summary.recordedTimeInsOutsideCurrentScope, 1);
  assert.equal(recorded.summary.comparisonEvents, 4);
  assert.equal(recorded.summary.comparisonAttended, 2);
  assert.equal(recorded.summary.comparisonAbsent, 2);
  assert.equal(recorded.summary.comparisonRatePercent, 50);
  assert.equal(recorded.rowCount, 4);
  assert.equal(recorded.rows.find(row => row.eventId === "incomplete")?.displayState, "INCOMPLETE_RECORD");
  const comparison = projectStudentHistory({ ...input, view: "current-roster", outcome: "missing" });
  assert.equal(comparison.rowCount, 2);
  assert.equal(comparison.summary.comparisonRatePercent, 50);
  const changedGroups = projectStudentHistory({ ...input, student: { ...student,
    groups: [{ slug: "b", name: "B", category: "SECTION" }] } });
  assert.equal(changedGroups.summary.recordedTimeIns, 3);
  assert.equal(changedGroups.summary.comparisonEvents, 1);
  assert.equal(changedGroups.summary.comparisonAttended, 1);
});

test("today and invalid schedules cannot become finalized absence", () => {
  const input = { student, events: [event("yesterday", "2026-09-25"),
    event("today", "2026-09-26"), event("tomorrow", "2026-09-27"),
    { ...event("invalid", "2026-09-24"), end: at("2026-09-23") }], records: [],
    todayStart: at("2026-09-26", "00:00"), view: "current-roster" as const,
    outcome: "all" as const, search: "", page: 1, pageSize: 10 };
  const result = projectStudentHistory(input);
  assert.equal(result.summary.comparisonEvents, 1);
  assert.equal(result.summary.comparisonRatePercent, 0);
  assert.equal(result.rows.find(row => row.eventId === "today")?.displayState, "NOT_YET_CHECKED_IN");
  assert.equal(result.rows.find(row => row.eventId === "tomorrow")?.displayState, "NOT_STARTED");
  assert.equal(result.rows.find(row => row.eventId === "invalid")?.displayState, "REVIEW_REQUIRED");
});

test("midnight cutoff, time-in-only attendance, and page clamping stay stable", () => {
  const events = [
    { ...event("ends-at-midnight", "2026-09-25"), end: at("2026-09-26", "00:00") },
    { ...event("past", "2026-09-24"), includedGroups: [{ slug: "a" }, { slug: "a" }] },
  ];
  const result = projectStudentHistory({ student, events, records: [
    { id: "r", eventId: "past", timein: at("2026-09-24"), timeout: null, method: "SCANNED" },
  ], todayStart: at("2026-09-26", "00:00"), evaluatedAt: at("2026-09-26", "16:00"),
  view: "current-roster", outcome: "all", search: "", page: 99, pageSize: 1 });
  assert.equal(result.summary.comparisonEvents, 1);
  assert.equal(result.summary.comparisonAttended, 1);
  assert.equal(result.summary.comparisonRatePercent, 100);
  assert.equal(result.page, 2);
  assert.equal(result.rows[0].eventId, "past");
});

test("current audience uses school-level and raw group membership, including YEAR", () => {
  const categories = ["ALL", "COLLEGE", "SHS", "DEPARTMENT", "HOUSE", "STRAND", "PROGRAM", "SECTION", "YEAR"] as const;
  const groups = categories.slice(3).map((category, index) => ({ slug: `g${index}`, name: category, category }));
  const expandedStudent = { ...student, groups };
  const events = categories.map((category, index) => ({ ...event(category, "2026-09-24"), category,
    includedGroups: category === "ALL" || category === "COLLEGE" || category === "SHS" ? [] : [{ slug: `g${index - 3}` }] }));
  const result = projectStudentHistory({ student: expandedStudent, events, records: [],
    todayStart: at("2026-09-26", "00:00"), view: "current-roster", outcome: "all", search: "", page: 1, pageSize: 25 });
  assert.equal(result.summary.comparisonEvents, 8);
  assert.equal(result.rows.some(row => row.eventId === "SHS"), false);
  const noGroups = projectStudentHistory({ student: { ...student, groups: [] }, events,
    records: [], todayStart: at("2026-09-26", "00:00"), view: "current-roster",
    outcome: "all", search: "", page: 1, pageSize: 25 });
  assert.equal(noGroups.summary.comparisonEvents, 2);
});

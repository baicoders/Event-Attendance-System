import assert from "node:assert/strict";
import test from "node:test";

import type { EventReport } from "../../../globals/types/reports";
import { eventExportSchema, prepareEventExport } from "./eventExport";

const report = {
  event: { id: "event-1", title: "Event", status: "APPROVED" },
  evaluatedAt: "2026-09-25T08:10:24.000Z",
  timeZone: "Asia/Manila",
  populationBasis: "CURRENT_ROSTER",
  expectsTimeout: false,
  totals: { eligible: 4, present: 1, late: 1, absent: 2, attended: 2, noTimeout: 0, scanned: 1, manual: 2 },
  rate: 50,
  byGroup: { SECTION: [] },
  rows: [
    { studentId: "00000000001", fullName: "One", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: null, sectionKey: "none", outcome: "PRESENT", recordId: "r1", timein: "2026-09-25T08:00:00.000Z", timeout: null, method: "SCANNED", noTimeout: false, reviewFlags: [] },
    { studentId: "00000000002", fullName: "Two", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: null, sectionKey: "none", outcome: "LATE", recordId: "r2", timein: "2026-09-25T08:30:00.000Z", timeout: null, method: "MANUAL", noTimeout: false, reviewFlags: [] },
    { studentId: "00000000003", fullName: "Three", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: null, sectionKey: "none", outcome: "ABSENT", recordId: null, timein: null, timeout: null, method: null, noTimeout: false, reviewFlags: [] },
    { studentId: "00000000004", fullName: "Four", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: null, sectionKey: "none", outcome: "ABSENT", recordId: "r4", timein: null, timeout: null, method: "MANUAL", noTimeout: false, reviewFlags: ["MISSING_TIME_IN"] },
  ],
} as unknown as EventReport;

test("presets select from one complete report and keep exact row counts", () => {
  assert.equal(prepareEventExport(report, "full").rowCount, 4);
  assert.equal(prepareEventExport(report, "absent").rowCount, 2);
  assert.equal(prepareEventExport(report, "late").rowCount, 1);
  assert.equal(prepareEventExport(report, "times").rowCount, 3);
  assert.equal(prepareEventExport(report, "late").rows[0]["Student ID"], "00000000002");
});

test("export wire schema rejects the older live-record array and nested cells", () => {
  assert.equal(eventExportSchema.safeParse([{ section: { name: "A" }, status: "present" }]).success, false);
  const prepared = prepareEventExport(report, "full");
  assert.equal(eventExportSchema.safeParse(prepared).success, true);
  assert.equal(eventExportSchema.safeParse({ ...prepared, rows: [{ ...prepared.rows[0], Section: { name: "A" } }] }).success, false);
  assert.equal(eventExportSchema.safeParse({ ...prepared, columns: [{ key: "Fake", label: "Fake" }], rows: [{ Fake: "plausible" }], rowCount: 1 }).success, false);
});

test("unapproved event CSV carries an explicit provisional marker", () => {
  const draft = { ...report, event: { ...report.event, status: "DRAFT" } } as EventReport;
  assert.match(String(prepareEventExport(draft, "full").rows[0]["Event status"]), /PROVISIONAL — EVENT NOT APPROVED/);
});

test("empty subset retains ordered headers and safe filename", () => {
  const empty = { ...report, event: { ...report.event, title: "../Bad\\Title" }, rows: report.rows.filter((row) => row.outcome !== "LATE") } as EventReport;
  const prepared = prepareEventExport(empty, "late");
  assert.equal(prepared.rowCount, 0);
  assert.equal(prepared.columns[0].label, "Event ID");
  assert.equal(prepared.columns[6].label, "Student ID");
  assert.equal(prepared.filenameBase.includes("/"), false);
  assert.equal(prepared.filenameBase.includes("\\"), false);
});

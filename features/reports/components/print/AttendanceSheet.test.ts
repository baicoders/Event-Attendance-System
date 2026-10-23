import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { EventReport } from "../../../../globals/types/reports";
import AttendanceSheet from "./AttendanceSheet";
import { resolvePrintColumns } from "../../utils/printColumns";

const report = {
  evaluatedAt: "2026-10-23T08:00:00.000Z", expectsTimeout: false,
  event: { title: "Assembly", category: "CUSTOM", status: "APPROVED", includedGroups: [], start: new Date("2026-10-23T06:00:00Z"), end: new Date("2026-10-23T10:00:00Z"), allDay: false, createdBy: null },
  totals: { eligible: 2, present: 1, late: 0, absent: 1, attended: 1, noTimeout: 0 },
  bySection: [{ key: "g:section", name: "Section A" }, { key: "none", name: "Ungrouped (no section)" }],
  rows: [
    { studentId: "internal-1", usn: "00000123456", lrn: null, fullName: "Alex Rivera", customGroup: "Student Council", position: "President", yearLevel: "YEAR_1", sectionKey: "g:section", outcome: "PRESENT", timein: "2026-10-23T06:00:00Z", timeout: null, method: "SCANNED" },
    { studentId: "internal-2", usn: null, lrn: "000000123456", fullName: "Sam Rivera", customGroup: "Student Council", position: null, yearLevel: null, sectionKey: "none", outcome: "ABSENT", timein: null, timeout: null, method: null },
  ],
} as unknown as EventReport;

const cells = (html: string, tag: "td" | "th") => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`, "gs"))].map((match) => match[1].replace(/<[^>]*>/g, ""));

test("selected columns render matching headings and cells, real external identifiers and a missing-position placeholder", () => {
  const html = renderToStaticMarkup(createElement(AttendanceSheet, { report, options: { includeAbsentees: true, groupBySection: false, columns: ["name", "identifier", "group", "position"] } }));
  assert.deepEqual(cells(html, "th"), ["No.", "Name", "USN/LRN", "Group", "Position"]);
  assert.deepEqual(cells(html, "td"), ["1", "Alex Rivera", "00000123456", "Student Council", "President", "2", "Sam Rivera", "000000123456", "Student Council", "—"]);
  assert.equal(html.includes("internal-1"), false);
});

test("hiding columns and absentees keeps whole-event totals and section filtering intact", () => {
  const html = renderToStaticMarkup(createElement(AttendanceSheet, { report, options: { includeAbsentees: false, groupBySection: true, columns: ["name", "timein", "timeout", "method", "signature"] } }));
  assert.deepEqual(cells(html, "th"), ["No.", "Name", "Check-in Time", "Check-out Time", "Method", "Signature"]);
  assert.deepEqual(cells(html, "td"), ["1", "Alex Rivera", "14:00", "—", "Scanned", ""]);
  assert.match(html, /<strong>Eligible:<\/strong> 2/);
  assert.match(html, /<strong>Absent:<\/strong> 1/);
  assert.match(html, /1 absent student is omitted/);
  assert.equal(html.includes("Sam Rivera"), false);
  assert.match(html, /Section A subtotal: 1 of 1 attended/);
});

test("a full URL selection keeps every printed header aligned with its cell in fixed order", () => {
  const full = { ...report, rows: [{ ...report.rows[0], lrn: "000000654321" }, { ...report.rows[1], usn: null, lrn: null, customGroup: null }] };
  const html = renderToStaticMarkup(createElement(AttendanceSheet, { report: full, options: { includeAbsentees: true, groupBySection: false, columns: resolvePrintColumns("signature,method,timeout,year,timein,status,position,group,identifier,name") } }));
  assert.deepEqual(cells(html, "th"), ["No.", "Name", "USN/LRN", "Group", "Position", "Attendance Status", "Check-in Time", "Year", "Check-out Time", "Method", "Signature"]);
  assert.deepEqual(cells(html, "td"), [
    "1", "Alex Rivera", "00000123456 / 000000654321", "Student Council", "President", "Present", "14:00", "1st Year", "—", "Scanned", "",
    "2", "Sam Rivera", "—", "—", "—", "Absent", "—", "Not provided", "—", "—", "",
  ]);
});

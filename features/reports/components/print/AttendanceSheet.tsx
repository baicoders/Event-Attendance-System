import * as React from "react";

import { labelForGroup } from "@/globals/constants/groups";
import type { EventReport, ReportRow } from "@/globals/types/reports";
import {
  ATTENDANCE_OUTCOME_LABEL,
  formatAttendanceRate,
} from "@/globals/utils/attendance";
import { formatReportClock, formatReportDateTime, formatReportEventSchedule } from "@/globals/utils/reportTime";
import { capitalizeLabel } from "@/globals/utils/text";
import { PRINT_COLUMNS, type PrintColumnKey } from "@/features/reports/utils/printColumns";

import { DEFAULT_NOTED_BY } from "@/features/reports/utils/printSignatories";
import type { SheetGrouping } from "@/features/reports/utils/printGrouping";

export type SheetOptions = {
  includeAbsentees: boolean;
  showLateCounter?: boolean;
  notedBy?: string;
  groupBy: SheetGrouping;
  columns: readonly PrintColumnKey[];
};

type AttendanceSheetProps = {
  report: EventReport;
  options: SheetOptions;
};

const cell = "border border-gray-400 px-2 py-1 align-top break-words";

function columnValue(row: ReportRow, key: PrintColumnKey): string {
  switch (key) {
    case "name": return row.fullName;
    case "identifier": return [row.usn, row.lrn].filter(Boolean).join(" / ") || "—";
    case "group": return row.customGroup || "—";
    case "position": return row.position || "—";
    case "status": return ATTENDANCE_OUTCOME_LABEL[row.outcome];
    case "timein": return formatReportClock(row.timein);
    case "year": return labelForGroup("YEAR", row.yearLevel);
    case "timeout": return formatReportClock(row.timeout);
    case "method": return row.method ? row.method === "SCANNED" ? "Scanned" : "Manual" : "—";
    case "signature": return "";
  }
}

/**
 * One section's table: shared column widths, its own repeating header, its rows,
 * and its subtotal.
 *
 * The header is repeated per section rather than once for the whole roster
 * because each section is its own table — which also means a section long enough
 * to overflow still repeats its header on the next page, via
 * `.print-table thead { display: table-header-group }`.
 */
const RosterTable = ({
  rows,
  startIndex,
  columns: selected,
}: {
  rows: ReportRow[];
  startIndex: number;
  columns: readonly PrintColumnKey[];
}) => {
  const columns = PRINT_COLUMNS.filter((column) => selected.includes(column.key));
  // The same weights are shared by every section so table widths stay aligned.
  const totalWidth = 5 + columns.reduce((sum, column) => sum + column.width, 0);

  return (
    <table className="print-table w-full table-fixed border-collapse text-xs">
      <colgroup>
        <col style={{ width: `${5 / totalWidth * 100}%` }} />
        {columns.map((column) => (
          <col key={column.key} style={{ width: `${column.width / totalWidth * 100}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr className="bg-gray-200">
          <th className={`${cell} text-right`}>No.</th>
          {columns.map((column) => <th key={column.key} className={`${cell} text-left`}>{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.studentId} className="print-break-inside-avoid">
            {/* Continuous across sections — a per-section restart made the sheet
                useless for "how many attended in total". */}
            <td className={`${cell} text-right`}>{startIndex + index + 1}</td>
            {columns.map((column) => <td key={column.key} className={`${cell}${column.key === "identifier" ? " font-mono" : ""}`}>{columnValue(row, column.key)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * The official, printable attendance sheet.
 *
 * A school office needs a document it can file and sign, which the previous plain
 * table was not: it had no signature column, no signatory block,
 * no per-section subtotals, and restarted its row numbering in every section.
 *
 * A server component — none of this needs to ship to the browser, and rendering
 * it server-side keeps the print bundle empty apart from the options bar.
 *
 * **Page numbers are deliberately absent.** Chrome does not support `@page`
 * counters for HTML content, so any "Page 1 of 4" rendered here would be a lie on
 * every sheet after the first. The browser's own print header/footer supplies
 * real ones.
 */
export default function AttendanceSheet({
  report,
  options,
}: AttendanceSheetProps): React.JSX.Element {
  // The rate is re-derived from the same totals via the shared helper, which is
  // the identical computation `report.rate` already holds — so the sheet and the
  // screen can never print different percentages.
  const { event, totals } = report;

  const rows = options.includeAbsentees
    ? report.rows
    : report.rows.filter((row) => row.outcome !== "ABSENT");
  const sectionLabelCounts = new Map<string, number>();
  for (const section of report.bySection) sectionLabelCounts.set(section.name, (sectionLabelCounts.get(section.name) ?? 0) + 1);

  // Preserve the report's ordering inside each section rather than re-sorting.
  const customGroups = new Map<string, { title: string; key: string; rows: ReportRow[] }>();
  if (options.groupBy === "CUSTOM") {
    for (const row of rows) {
      const key = row.customGroupId ? `group:${row.customGroupId}` : row.customGroup ? `name:${row.customGroup}` : "none";
      const group = customGroups.get(key) ?? { key, title: row.customGroup ?? "No custom group", rows: [] };
      group.rows.push(row);
      customGroups.set(key, group);
    }
  }
  const grouped = options.groupBy !== "NONE";
  const groups = options.groupBy === "CUSTOM"
    ? [...customGroups.values()].sort((a, b) => Number(a.key === "none") - Number(b.key === "none") || a.title.localeCompare(b.title) || a.key.localeCompare(b.key))
    : options.groupBy === "SECTION"
    ? report.bySection
        .map((section) => ({
          title: (sectionLabelCounts.get(section.name) ?? 0) > 1 ? `${section.name} (${section.key})` : section.name,
          key: section.key,
          rows: rows.filter(
            (row) => row.sectionKey === section.key,
          ),
        }))
        .filter((group) => group.rows.length > 0)
    : [{ title: "", key: "all", rows }];

  let runningIndex = 0;

  return (
    <div className="mx-auto w-full max-w-4xl bg-white p-8 text-black print:max-w-none print:p-0">
      <header className="print-break-inside-avoid mb-6 border-b-2 border-black pb-4 text-center">
        <h1 className="text-xl font-bold uppercase tracking-[0.15em]">Event Attendance Sheet</h1>
      </header>

      {/* ================= Event details ================= */}
      <section className="print-break-inside-avoid mb-4 text-sm">
        <h2 className="mb-2 text-lg font-bold">{event.title}</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1">
          <div className="col-span-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="shrink-0 font-semibold">Date &amp; time:</dt>
            <dd className="min-w-0 flex-1">
              <span>{formatReportEventSchedule(event.start, event.end, event.allDay)}</span>
              {!event.allDay && <span className="mt-0.5 block text-xs text-gray-600">Philippine time (UTC+08:00)</span>}
            </dd>
          </div>
          {event.location ? (
            <div className="flex gap-2">
              <dt className="font-semibold">Location:</dt>
              <dd>{event.location}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="font-semibold">Scope:</dt>
            <dd>{capitalizeLabel(event.category)} event</dd>
          </div>
          {event.createdBy ? (
            <div className="flex gap-2">
              <dt className="font-semibold">Organizer:</dt>
              <dd>{event.createdBy.name}</dd>
            </div>
          ) : null}
          {event.category !== "ALL" && event.includedGroups.length > 0 ? (
            <div className="col-span-2 flex gap-2">
              <dt className="font-semibold">Groups:</dt>
              <dd>{event.includedGroups.map((g) => g.name).join(", ")}</dd>
            </div>
          ) : null}
        </dl>
        {event.status !== "APPROVED" ? <p className="mt-2 font-bold">PROVISIONAL — EVENT NOT APPROVED</p> : null}
      </section>

      {/* ================= Summary ================= */}
      <section className="print-break-inside-avoid mb-4 border border-gray-400 bg-gray-50 px-3 py-2 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <strong>Eligible:</strong> {totals.eligible}
          </span>
          <span>
            <strong>Present:</strong> {options.showLateCounter === false ? totals.present + totals.late : totals.present}
          </span>
          {options.showLateCounter !== false ? <span>
            <strong>Late:</strong> {totals.late}
          </span> : null}
          <span>
            <strong>Absent:</strong> {totals.absent}
          </span>
          {report.expectsTimeout ? (
            <span>
              <strong>No time-out:</strong> {totals.noTimeout}
            </span>
          ) : null}
          <span className="ml-auto">
            <strong>Attendance rate:</strong>{" "}
            {formatAttendanceRate(totals.attended, totals.eligible)}
          </span>
        </div>
        {!options.includeAbsentees && totals.absent > 0 ? (
          <p className="mt-1 text-xs italic">
            This sheet lists attendees only; {totals.absent} absent{" "}
            {totals.absent === 1 ? "student is" : "students are"} omitted.
          </p>
        ) : null}
      </section>

      {/* ================= Roster =================
          Grouped: one block per selected group, each starting on a fresh sheet so a
          section heading is always at the top of a page. Ungrouped: a single
          continuous table. */}
      {rows.length === 0 ? (
        <p className="border border-gray-400 px-2 py-6 text-center text-xs">
          No students to list.
        </p>
      ) : (
        groups.map((group, groupIndex) => {
          const startIndex = runningIndex;
          runningIndex += group.rows.length;
          const attended = group.rows.filter(
            (row) => row.outcome !== "ABSENT",
          ).length;

          return (
            <section
              key={group.key}
              // The first group continues from the summary on page 1; every
              // later one starts its own sheet, whatever blank space that leaves
              // behind.
              className={
                grouped && groupIndex > 0
                  ? "print-page-break-before"
                  : undefined
              }
            >
              {grouped ? (
                <h3 className="print-break-inside-avoid mb-1 mt-4 text-sm font-bold print:mt-0">
                  {group.title}
                </h3>
              ) : null}

              <RosterTable
                rows={group.rows}
                startIndex={startIndex}
                columns={options.columns}
              />

              {grouped ? (
                <p className="print-break-inside-avoid border border-t-0 border-gray-400 bg-gray-50 px-2 py-1 text-right text-xs font-semibold">
                  {group.title} subtotal: {attended} of {group.rows.length}{" "}
                  attended
                </p>
              ) : null}
            </section>
          );
        })
      )}

      {/* ================= Signatories ================= */}
      <section className="print-break-inside-avoid mt-10 grid grid-cols-2 gap-12 text-sm">
        <div>
          <p className="mb-8">Prepared by:</p>
          <p className="border-t border-black pt-1 text-center font-semibold">
            {event.createdBy?.name ?? ""}
          </p>
          <p className="text-center text-xs">Event Organizer</p>
        </div>
        <div>
          <p className="mb-8">Noted by:</p>
          <p className="border-t border-black pt-1 text-center font-semibold">
            &nbsp;
          </p>
          <p className="text-center text-xs">{options.notedBy ?? DEFAULT_NOTED_BY}</p>
        </div>
      </section>

      {/* ================= Footer ================= */}
      <footer className="mt-8 border-t border-gray-400 pt-2 text-[10px] text-gray-600">
        <p>Made by Programmers Guild • Prepared at {formatReportDateTime(report.evaluatedAt)} Asia/Manila (UTC+08:00).</p>
      </footer>
    </div>
  );
}

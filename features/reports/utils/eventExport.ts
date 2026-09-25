import { z } from "zod";

import type { EventReport, ReportRow } from "@/globals/types/reports";
import { ATTENDANCE_OUTCOME_LABEL } from "@/globals/utils/attendance";
import { formatReportDateTime, REPORT_TIME_ZONE } from "@/globals/utils/reportTime";
import { GROUP_DIMENSIONS, type GroupDimension } from "@/globals/utils/reportGroups";

export const EXPORT_PRESETS = ["full", "absent", "late", "times", "groups"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];
export const exportRequestSchema = z.strictObject({
  preset: z.enum(EXPORT_PRESETS),
  groupBy: z.enum(GROUP_DIMENSIONS).optional(),
}).superRefine((value, ctx) => {
  if (value.groupBy && value.preset !== "groups") ctx.addIssue({ code: "custom", message: "groupBy only applies to groups" });
});

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const eventExportSchema = z.object({
  schemaVersion: z.literal(1),
  event: z.object({ id: z.string(), title: z.string(), status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED"]) }),
  preset: z.enum(EXPORT_PRESETS),
  groupBy: z.enum(GROUP_DIMENSIONS).nullable(),
  evaluatedAt: z.iso.datetime(),
  timeZone: z.literal(REPORT_TIME_ZONE),
  populationBasis: z.literal("CURRENT_ROSTER"),
  provisional: z.boolean(),
  totals: z.object({ eligible: z.number(), present: z.number(), late: z.number(), absent: z.number(), attended: z.number(), noTimeout: z.number(), rate: z.number().nullable() }),
  expectsTimeout: z.boolean(),
  diagnostics: z.object({ recordsWithoutTimeIn: z.number(), invalidTimeOrder: z.number() }),
  columns: z.array(z.object({ key: z.string(), label: z.string() })).min(1),
  rows: z.array(z.record(z.string(), cellSchema)),
  rowCount: z.number().int().nonnegative(),
  filenameBase: z.string().regex(/^[\p{L}\p{N}._-]+$/u),
}).superRefine((value, ctx) => {
  if (value.rowCount !== value.rows.length) ctx.addIssue({ code: "custom", message: "Row count mismatch" });
  const keys = value.columns.map((column) => column.key);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Duplicate columns" });
  const expected = [...common, ...(value.preset === "groups" ? groups : value.preset === "times" ? times : student)];
  if (keys.length !== expected.length || expected.some((key, index) => value.columns[index]?.key !== key || value.columns[index]?.label !== key)) {
    ctx.addIssue({ code: "custom", message: "Unexpected export columns" });
  }
  if ((value.preset === "groups") !== (value.groupBy !== null)) ctx.addIssue({ code: "custom", message: "Invalid grouping" });
  value.rows.forEach((row, index) => {
    if (Object.keys(row).length !== keys.length || keys.some((key) => !(key in row))) {
      ctx.addIssue({ code: "custom", message: `Invalid row ${index}` });
    }
  });
});
export type EventExport = z.infer<typeof eventExportSchema>;

const common = ["Event ID", "Event title", "Event status", "Prepared at (UTC)", "Reporting time zone", "Population basis"];
const student = ["Student ID", "Name", "School level", "Year / grade", "Section key", "Section", "Outcome", "Time in (UTC)", "Time in (Asia/Manila)", "Time out (UTC)", "Time out (Asia/Manila)", "Record creation method", "No time-out recorded", "Review flags"];
const times = ["Record ID", "Student ID", "Name", "School level", "Year / grade", "Section key", "Section", "Time in (UTC)", "Time in (Asia/Manila)", "Time out (UTC)", "Time out (Asia/Manila)", "Record creation method", "Outcome", "No time-out recorded", "Review flags"];
const groups = ["Row type", "Grouping dimension", "Bucket key", "Group ID", "Group slug", "Group label", "Eligible", "On time", "Late", "Absent as of preparation", "Attended (including late)", "Attendance rate (%)"];

function studentCells(row: ReportRow, expectsTimeout: boolean): Record<string, string> {
  return {
    "Student ID": row.studentId,
    Name: row.fullName,
    "School level": row.schoolLevel,
    "Year / grade": row.yearLevel.replace("_", " "),
    "Section key": row.sectionKey,
    Section: row.section ?? "",
    Outcome: ATTENDANCE_OUTCOME_LABEL[row.outcome],
    "Time in (UTC)": row.timein ?? "",
    "Time in (Asia/Manila)": formatReportDateTime(row.timein),
    "Time out (UTC)": row.timeout ?? "",
    "Time out (Asia/Manila)": formatReportDateTime(row.timeout),
    "Record creation method": row.method ?? "",
    "No time-out recorded": expectsTimeout && row.timein ? row.noTimeout ? "Yes" : "No" : "",
    "Review flags": row.reviewFlags.join(";"),
  };
}

function safeComponent(value: string, max: number): string {
  return value.normalize("NFKD").replace(/[\x00-\x1f\x7f/\\]/g, "-").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, max) || "event";
}

export function prepareEventExport(report: EventReport, preset: ExportPreset, groupBy: GroupDimension = "SECTION"): EventExport {
  const columns = [...common, ...(preset === "groups" ? groups : preset === "times" ? times : student)].map((key) => ({ key, label: key }));
  const metadata = {
    "Event ID": report.event.id,
    "Event title": report.event.title,
    "Event status": report.event.status === "APPROVED" ? "APPROVED" : `${report.event.status} — PROVISIONAL — EVENT NOT APPROVED`,
    "Prepared at (UTC)": report.evaluatedAt,
    "Reporting time zone": report.timeZone,
    "Population basis": report.populationBasis,
  };
  let rows: Record<string, string | number | null>[];
  if (preset === "groups") {
    const summary = report.byGroup[groupBy];
    rows = [...summary.map((bucket) => ({
      ...metadata, "Row type": "GROUP", "Grouping dimension": groupBy, "Bucket key": bucket.key,
      "Group ID": bucket.id ?? "", "Group slug": bucket.slug ?? "", "Group label": bucket.label,
      Eligible: bucket.eligible, "On time": bucket.present, Late: bucket.late,
      "Absent as of preparation": bucket.absent, "Attended (including late)": bucket.attended,
      "Attendance rate (%)": bucket.rate === null ? null : Number(bucket.rate.toFixed(4)),
    })), {
      ...metadata, "Row type": "TOTAL", "Grouping dimension": groupBy, "Bucket key": "total",
      "Group ID": "", "Group slug": "", "Group label": "TOTAL", Eligible: report.totals.eligible,
      "On time": report.totals.present, Late: report.totals.late,
      "Absent as of preparation": report.totals.absent, "Attended (including late)": report.totals.attended,
      "Attendance rate (%)": report.rate === null ? null : Number(report.rate.toFixed(4)),
    }];
  } else {
    const chosen = report.rows.filter((row) => preset === "full" || preset === "times" && !!row.recordId || preset === "absent" && row.outcome === "ABSENT" || preset === "late" && row.outcome === "LATE");
    rows = chosen.map((row) => {
      const cells = studentCells(row, report.expectsTimeout);
      if (preset === "times") return { ...metadata, "Record ID": row.recordId ?? "", ...cells };
      return { ...metadata, ...cells };
    });
  }
  const stamp = report.evaluatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const filenameBase = `event-${safeComponent(report.event.id, 60)}-${safeComponent(report.event.title, 80)}-${preset}${preset === "groups" ? `-${groupBy.toLowerCase()}` : ""}-${stamp}`;
  return {
    schemaVersion: 1,
    event: { id: report.event.id, title: report.event.title, status: report.event.status },
    preset, groupBy: preset === "groups" ? groupBy : null,
    evaluatedAt: report.evaluatedAt,
    timeZone: REPORT_TIME_ZONE,
    populationBasis: "CURRENT_ROSTER",
    provisional: report.event.status !== "APPROVED",
    totals: {
      eligible: report.totals.eligible,
      present: report.totals.present,
      late: report.totals.late,
      absent: report.totals.absent,
      attended: report.totals.attended,
      noTimeout: report.totals.noTimeout,
      rate: report.rate,
    },
    expectsTimeout: report.expectsTimeout,
    diagnostics: { recordsWithoutTimeIn: report.rows.filter((row) => row.recordId && !row.timein).length, invalidTimeOrder: report.rows.filter((row) => row.reviewFlags.includes("INVALID_TIME_ORDER")).length },
    columns,
    rows,
    rowCount: rows.length,
    filenameBase,
  };
}

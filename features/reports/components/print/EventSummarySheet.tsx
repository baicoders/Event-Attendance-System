import Image from "next/image";

import type { EventReport } from "@/globals/types/reports";
import { formatAttendanceRate } from "@/globals/utils/attendance";
import { formatReportDateTime, formatReportEventDate } from "@/globals/utils/reportTime";
import type { GroupDimension } from "@/globals/utils/reportGroups";

const cell = "border border-gray-400 px-2 py-1 text-left align-top break-words";

export default function EventSummarySheet({ report, groupBy }: { report: EventReport; groupBy: GroupDimension }) {
  const { event, totals } = report;
  const buckets = report.byGroup[groupBy];
  const labelCounts = new Map<string, number>();
  for (const bucket of buckets) labelCounts.set(bucket.label, (labelCounts.get(bucket.label) ?? 0) + 1);
  return (
    <main className="mx-auto w-full max-w-4xl bg-white p-8 text-black print:max-w-none print:p-0">
      <header className="print-break-inside-avoid mb-6 border-b-2 border-black pb-4 text-center">
        <div className="flex items-center justify-center gap-4">
          <Image src="/logos/school/aclc.png" alt="" width={64} height={64} priority className="h-16 w-16 object-contain" />
          <div><p className="text-lg font-bold uppercase tracking-wide">ACLC College of Ormoc City</p><p className="text-sm">Office of Student Affairs</p></div>
        </div>
        <h1 className="mt-3 text-xl font-bold uppercase tracking-[0.15em]">Event Attendance Summary</h1>
      </header>
      <section className="print-break-inside-avoid mb-4 text-sm">
        <h2 className="text-lg font-bold">{event.title}</h2>
        <p>{formatReportEventDate(event.start, event.allDay)} to {formatReportEventDate(event.end, event.allDay)}{event.allDay ? " · All day" : ` ${report.timeZone}`}</p>
        <p>Status: {event.status} · Audience: {event.category} {event.location ? `· ${event.location}` : ""}</p>
        <p>Prepared at {formatReportDateTime(report.evaluatedAt)} {report.timeZone} (UTC+08:00)</p>
        {event.status !== "APPROVED" ? <p className="mt-2 font-bold">PROVISIONAL — EVENT NOT APPROVED</p> : null}
      </section>
      <section className="print-break-inside-avoid mb-5 border border-gray-400 bg-gray-50 p-3 text-sm">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>Eligible: <strong>{totals.eligible}</strong></span>
          <span>Attended: <strong>{totals.attended}</strong></span>
          <span>On time: <strong>{totals.present}</strong></span>
          <span>Late: <strong>{totals.late}</strong></span>
          <span>Absent as of preparation: <strong>{totals.absent}</strong></span>
          <span>Attendance rate: <strong>{formatAttendanceRate(totals.attended, totals.eligible)}</strong></span>
          {report.expectsTimeout ? <span>No time-out recorded: <strong>{totals.noTimeout}</strong></span> : null}
        </div>
      </section>
      <h3 className="print-break-inside-avoid mb-2 text-sm font-bold">By {groupBy.toLowerCase()}</h3>
      <table className="print-table w-full table-fixed border-collapse text-xs">
        <colgroup><col style={{ width: "28%" }} />{Array.from({ length: 6 }, (_, index) => <col key={index} style={{ width: "12%" }} />)}</colgroup>
        <thead><tr className="bg-gray-200">
          {["Group", "Eligible", "On time", "Late", "Absent", "Attended", "Rate"].map((heading) => <th key={heading} className={cell}>{heading}</th>)}
        </tr></thead>
        <tbody>
          {buckets.map((bucket) => <tr key={bucket.key} className="print-break-inside-avoid">
            <td className={cell}>{bucket.label}{(labelCounts.get(bucket.label) ?? 0) > 1 ? ` (${bucket.slug ?? bucket.key})` : ""}</td><td className={cell}>{bucket.eligible}</td><td className={cell}>{bucket.present}</td><td className={cell}>{bucket.late}</td><td className={cell}>{bucket.absent}</td><td className={cell}>{bucket.attended}</td><td className={cell}>{formatAttendanceRate(bucket.attended, bucket.eligible)}</td>
          </tr>)}
          <tr className="print-break-inside-avoid bg-gray-100 font-bold"><td className={cell}>TOTAL</td><td className={cell}>{totals.eligible}</td><td className={cell}>{totals.present}</td><td className={cell}>{totals.late}</td><td className={cell}>{totals.absent}</td><td className={cell}>{totals.attended}</td><td className={cell}>{formatAttendanceRate(totals.attended, totals.eligible)}</td></tr>
        </tbody>
      </table>
      <section className="print-break-inside-avoid mt-10 grid grid-cols-2 gap-12 text-sm">
        <div><p className="mb-8">Prepared by:</p><p className="border-t border-black pt-1 text-center font-semibold">{event.createdBy?.name ?? ""}</p><p className="text-center text-xs">Event Organizer</p></div>
        <div><p className="mb-8">Noted by:</p><p className="border-t border-black pt-1 text-center font-semibold">&nbsp;</p><p className="text-center text-xs">Office of Student Affairs</p></div>
      </section>
      <footer className="mt-8 border-t border-gray-400 pt-2 text-[10px] text-gray-600">
        <p>Current-roster report prepared at {formatReportDateTime(report.evaluatedAt)} {report.timeZone}. Roster and attendance changes may alter later preparations. This report is not a final or frozen enrollment record.</p>
      </footer>
    </main>
  );
}

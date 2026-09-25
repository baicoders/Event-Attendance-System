import { notFound, redirect } from "next/navigation";

import { AuthError, getFreshAuthSession } from "@/globals/utils/auth";
import {
  buildEventReport,
  loadAuthorizedEventReportSnapshot,
} from "@/globals/utils/eventReport";
import { GROUP_DIMENSIONS, type GroupDimension } from "@/globals/utils/reportGroups";
import AttendanceSheet, {
  type SheetOptions,
} from "@/features/reports/components/print/AttendanceSheet";
import PrintOptionsBar from "@/features/reports/components/print/PrintOptionsBar";
import EventSummarySheet from "@/features/reports/components/print/EventSummarySheet";

type PrintPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Options default to on; only an explicit "0" turns one off. */
const isEnabled = (value: string | string[] | undefined): boolean =>
  value !== "0";

export default async function PrintPage({
  params,
  searchParams,
}: PrintPageProps) {
  const { id: eventId } = await params;
  const query = await searchParams;
  if (query.view !== undefined && query.view !== "sheet" && query.view !== "summary") notFound();
  const view = query.view === "summary" ? "summary" : "sheet";
  if (view === "summary" && query.groupBy !== undefined && (typeof query.groupBy !== "string" || !GROUP_DIMENSIONS.includes(query.groupBy as GroupDimension))) notFound();
  const groupBy: GroupDimension = view === "summary" && typeof query.groupBy === "string" ? query.groupBy as GroupDimension : "SECTION";

  // This report exposes student PII (names, student numbers, attendance times).
  // The client `(main)` layout never protected a direct request to a server
  // route, and this page no longer sits under it at all — so authenticate and
  // enforce event visibility here.
  const user = await getFreshAuthSession();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }

  let snapshot;
  try {
    snapshot = await loadAuthorizedEventReportSnapshot(eventId, user);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    return <div className="p-8 text-center text-gray-600">You do not have access to this report.</div>;
  }
  if (!snapshot) {
    return (
      <div className="p-8 text-center text-gray-600">Event not found.</div>
    );
  }

  const report = buildEventReport(snapshot);

  const options: SheetOptions = {
    includeAbsentees: isEnabled(query.absentees),
    groupBySection: isEnabled(query.grouped),
    includeSignature: isEnabled(query.signature),
  };

  return (
    <>
      <PrintOptionsBar />
      {view === "summary" ? <EventSummarySheet report={report} groupBy={groupBy} /> : <AttendanceSheet report={report} options={options} />}
    </>
  );
}

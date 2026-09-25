"use client";

import { ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/globals/components/shad-cn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/globals/components/shad-cn/select";
import DataTable from "@/globals/components/shared/dataTable/DataTable";
import {
  DataTableEmptyState,
  DataTableErrorState,
  DataTableFilteredEmptyState,
} from "@/globals/components/shared/dataTable/DataTableStates";
import PageHeader from "@/globals/components/shared/PageHeader";
import { page, pill } from "@/globals/constants/designTokens";
import { readableDate } from "@/globals/utils/formatting";
import { capitalizeLabel } from "@/globals/utils/text";
import DataQualityStrip from "@/features/reports/components/event/DataQualityStrip";
import ReportMetrics from "@/features/reports/components/event/ReportMetrics";
import EventExportPicker from "@/features/reports/components/event/EventExportPicker";
import EventMetadataCard from "@/features/reports/components/EventMetadataCard";
import { reportColumns } from "@/features/reports/constants/reportTable";
import { useEventReport } from "@/features/reports/hooks/useEventReport";

const StatusDonut = dynamic(
  () => import("@/features/reports/components/event/StatusDonut"),
  { ssr: false },
);
const ArrivalTimelineChart = dynamic(
  () => import("@/features/reports/components/event/ArrivalTimelineChart"),
  { ssr: false },
);

/** Radix Select rejects an empty-string value, so "no filter" needs a sentinel. */
const ANY = "__ANY__";

const EventReportPage = () => {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const eventId = String(id);

  const { data: report, isLoading, isError } = useEventReport(eventId);

  const [outcome, setOutcome] = useState<string>(ANY);
  const [section, setSection] = useState<string>(ANY);

  const rows = useMemo(() => report?.rows ?? [], [report]);

  // Filtering here rather than through TanStack's column filters, because the
  // shared DataTable's toolbar slot has no access to the table instance.
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (outcome === ANY || row.outcome === outcome) &&
          (section === ANY || row.sectionKey === section),
      ),
    [rows, outcome, section],
  );

  const sections = report?.bySection ?? [];
  const sectionLabelCounts = new Map<string, number>();
  for (const item of sections) sectionLabelCounts.set(item.name, (sectionLabelCounts.get(item.name) ?? 0) + 1);

  const isFiltered = outcome !== ANY || section !== ANY;
  const clearFilters = useCallback(() => {
    setOutcome(ANY);
    setSection(ANY);
  }, []);

  if (isError || (!isLoading && !report)) {
    return (
      <section className={`${page.surface} min-h-svh`}>
        <div className={page.containerWide}>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
            Couldn&apos;t load this event report. It may have been removed, or you
            may not have access.
          </div>
          <Link href="/reports" className={`${pill.back} w-fit`}>
            <ChevronLeft className="h-4 w-4" />
            Back to reports
          </Link>
        </div>
      </section>
    );
  }

  const event = report?.event;

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <Link href="/reports" className={`${pill.back} w-fit`}>
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          Back to reports
        </Link>

        <PageHeader
          eyebrow="Event report"
          title={event?.title ?? "Loading…"}
          description={
            event
              ? `${readableDate(event.start)} · ${capitalizeLabel(event.category)} event`
              : undefined
          }
          actions={
            <>
              <Button asChild><Link href={`/reports/events/${eventId}/print`} target="_blank" rel="noopener noreferrer">Print attendance sheet</Link></Button>
              {report ? <EventExportPicker eventId={eventId} initialOpen={searchParams.get("export") === "1"} /> : null}
            </>
          }
        />

        <ReportMetrics
          totals={report?.totals}
          rate={report?.rate}
          expectsTimeout={report?.expectsTimeout}
          isLoading={isLoading}
        />

        {report ? (
          <>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <StatusDonut totals={report.totals} />
              <ArrivalTimelineChart
                arrivals={report.arrivals}
                start={report.event.start}
                allDay={report.event.allDay}
              />
            </div>

            <DataQualityStrip totals={report.totals} />
            <EventMetadataCard event={report.event} />
          </>
        ) : null}

        <DataTable
          columns={reportColumns}
          data={filteredRows}
          isLoading={isLoading}
          isError={isError}
          title="Attendance records"
          getRowId={(row) => row.studentId}
          resetKey={`${eventId}:${outcome}:${section}`}
          toolbarTrailing={
            <div className="flex flex-wrap gap-2">
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger
                  aria-label="Filter by status"
                  className="h-9 w-full border-slate-300 bg-white sm:w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All statuses</SelectItem>
                  <SelectItem value="PRESENT">Present</SelectItem>
                  <SelectItem value="LATE">Late</SelectItem>
                  <SelectItem value="ABSENT">Absent</SelectItem>
                </SelectContent>
              </Select>

              {sections.length > 0 ? (
                <Select value={section} onValueChange={setSection}>
                  <SelectTrigger
                    aria-label="Filter by section"
                    className="h-9 w-full border-slate-300 bg-white sm:w-44"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>All sections</SelectItem>
                    {sections.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.name}{(sectionLabelCounts.get(item.name) ?? 0) > 1 ? ` (${item.key})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          }
          errorState={
            <DataTableErrorState
              title="Couldn't load attendance records"
              description="Please retry."
            />
          }
          // Rows are filtered before they reach the table, so the table can't tell
          // "no matches" from "no data" itself — decide it here.
          emptyState={
            isFiltered ? (
              <DataTableFilteredEmptyState onClear={clearFilters} />
            ) : (
              <DataTableEmptyState
                title="No eligible students"
                description="Nobody matches this event's scope."
              />
            )
          }
        />

        <p className="text-xs text-slate-500">
          Figures reflect the <strong>current</strong> roster. Editing a
          student&apos;s groups after an event will change this report.
        </p>
      </div>
    </section>
  );
};

export default EventReportPage;

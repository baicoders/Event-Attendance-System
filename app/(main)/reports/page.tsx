"use client";

import type { EventCategory } from "@prisma/client";
import dynamic from "next/dynamic";
import { useState } from "react";

import DataTable from "@/globals/components/shared/dataTable/DataTable";
import {
  DataTableEmptyState,
  DataTableErrorState,
} from "@/globals/components/shared/dataTable/DataTableStates";
import PageHeader from "@/globals/components/shared/PageHeader";
import { type DateRange, toDateInput } from "@/globals/components/shared/DateRangePicker";
import { page } from "@/globals/constants/designTokens";
import DateRangeControls from "@/features/reports/components/overview/DateRangeControls";
import OverviewMetrics from "@/features/reports/components/overview/OverviewMetrics";
import { overviewColumns } from "@/features/reports/constants/overviewTable";
import { useReportsOverview } from "@/features/reports/hooks/useReportsOverview";

// Charts are client-only and pull in Recharts; keeping them out of the initial
// bundle follows the same reasoning as the lazily-loaded QR scanner.
const TrendChart = dynamic(
  () => import("@/features/reports/components/overview/TrendChart"),
  { ssr: false },
);
const CategoryChart = dynamic(
  () => import("@/features/reports/components/overview/CategoryChart"),
  { ssr: false },
);

/** Last 30 days — long enough to hold a full event cycle, short enough to load fast. */
const defaultRange = (): DateRange => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: toDateInput(from), to: toDateInput(to) };
};

const ReportsPage = () => {
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [category, setCategory] = useState<EventCategory | undefined>();

  const { data, isLoading, isError } = useReportsOverview({
    from: range.from,
    to: range.to,
    category,
  });

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <PageHeader
          variant="hero"
          eyebrow="Reports"
          title="Attendance Reports"
          description="Turnout across every approved event in the selected range. Pick an event to open its full report and printable attendance sheet."
        />

        <DateRangeControls
          range={range}
          onRangeChange={setRange}
          category={category}
          onCategoryChange={setCategory}
        />

        <OverviewMetrics overview={data} isLoading={isLoading} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TrendChart events={data?.events ?? []} />
          <CategoryChart byCategory={data?.byCategory ?? []} />
        </div>

        <DataTable
          columns={overviewColumns}
          data={data?.events ?? []}
          isLoading={isLoading}
          isError={isError}
          title="Events"
          getRowId={(row) => row.id}
          // The API already returns newest-first, and an empty sorting state
          // preserves that order — reports are about what just happened.
          resetKey={`${range.from}:${range.to}:${category ?? "all"}`}
          errorState={
            <DataTableErrorState
              title="Couldn't load reports"
              description="Please retry."
            />
          }
          emptyState={
            <DataTableEmptyState
              title="No approved events in this range"
              description="Widen the date range, or clear the category filter."
            />
          }
        />

        {/*
          Eligibility is recomputed from the current roster on every read, so a
          later roster correction rewrites a past event's numbers. Saying so is
          the agreed alternative to snapshotting (audit DATA-06 / #45).
        */}
        <p className="text-xs text-slate-500">
          Figures reflect the <strong>current</strong> roster. Editing a
          student&apos;s groups after an event will change that event&apos;s
          report.
        </p>
      </div>
    </section>
  );
};

export default ReportsPage;

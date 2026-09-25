"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { EventCategory } from "@prisma/client";
import { Button } from "@/globals/components/shad-cn/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/globals/components/shad-cn/sheet";
import FormInput from "@/globals/components/shared/FormInput";
import DataTable from "@/globals/components/shared/dataTable/DataTable";
import { DataTableEmptyState, DataTableErrorState } from "@/globals/components/shared/dataTable/DataTableStates";
import { surface } from "@/globals/constants/designTokens";
import type { AudienceRosterStudent } from "@/globals/types/audiencePreview";
import { ApiError } from "@/globals/utils/api";
import { useAudiencePreview } from "../hooks/useAudiencePreview";

const columns: ColumnDef<AudienceRosterStudent>[] = [
  { accessorKey: "id", header: "Student ID", enableSorting: false },
  { id: "name", header: "Name", enableSorting: false,
    cell: ({ row }) => `${row.original.lastName}, ${row.original.firstName}` },
  { id: "level", header: "Level / Year", enableSorting: false,
    cell: ({ row }) => `${row.original.schoolLevel === "SHS" ? "SHS" : "College"} / ${row.original.yearLevel.replace("YEAR_", "").replace("GRADE_", "")}` },
  { accessorKey: "section", header: "Section", enableSorting: false,
    cell: ({ row }) => row.original.section ?? "—" },
];

export default function EventAudiencePreview({ category, includedGroups, eventId, enabled }: {
  category: EventCategory;
  includedGroups: string[];
  eventId?: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);
  const audience = useAudiencePreview({ category, includedGroups, eventId }, enabled, open);
  const { count, roster, valid, current, searchCurrent, search, setSearch, page, setPage, pageSize, setPageSize } = audience;
  const countReady = current && !count.isFetching && !count.isError && !!count.data;
  const rosterReady = current && searchCurrent && !roster.isFetching && !roster.isError && !!roster.data;
  const label = category.toLowerCase();
  const countAccessError = count.error instanceof ApiError && [401, 403].includes(count.error.status);
  const rosterAccessError = roster.error instanceof ApiError && [401, 403].includes(roster.error.status);

  return (
    <div className={`${surface.card} p-4 sm:col-span-2`} aria-live="polite">
      <p className="text-sm font-semibold text-slate-900">Current audience</p>
      {!valid ? (
        <p className="mt-1 text-sm text-slate-600">Select at least one {label} group to see the audience.</p>
      ) : count.isError && current ? (
        <div className="mt-1 text-sm text-red-700">
          {countAccessError ? "You no longer have access to preview this audience." : "Couldn’t check the audience."}
          {!countAccessError && <Button variant="link" onClick={() => count.refetch()}>Retry</Button>}
        </div>
      ) : countReady ? (
        <>
          <p className="mt-1 text-lg font-semibold text-slate-900">{count.data.totalEligible.toLocaleString()} students currently match</p>
          <p className="text-xs text-slate-500">Current roster · Checked {new Date(count.data.evaluatedAt).toLocaleTimeString()}</p>
          {count.data.limitation && <p className="mt-2 text-sm text-amber-700">{count.data.limitation}</p>}
          <Button className="mt-3" variant="outline" onClick={() => setOpen(true)}>Preview roster</Button>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-600">Checking audience…</p>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto bg-white p-0 sm:max-w-3xl" aria-describedby="audience-preview-description">
          <SheetHeader className="border-b border-slate-200 p-5 pr-12">
            <SheetTitle>Preview audience</SheetTitle>
            <SheetDescription id="audience-preview-description">Current roster for this event scope. The count may change before the event is saved.</SheetDescription>
          </SheetHeader>
          <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
            <FormInput label="Search name or student ID" value={search} maxLength={100}
              onChange={(event) => setSearch(event.target.value)} placeholder="Name or student ID" />
            {rosterReady ? (
              <p className="text-sm text-slate-600">
                {roster.data.totalEligible.toLocaleString()} eligible · {roster.data.searchMatches.toLocaleString()} match this search
              </p>
            ) : <p className="text-sm text-slate-600">{!current || !searchCurrent || roster.isFetching ? "Updating roster…" : rosterAccessError ? "You no longer have access to this roster." : roster.isError ? "Roster request failed." : "Loading roster…"}</p>}
            {rosterReady && roster.data.limitation && <p className="text-sm text-amber-700">{roster.data.limitation}</p>}
            <DataTable
              columns={columns}
              data={rosterReady ? roster.data.students : []}
              isLoading={!rosterReady && !roster.isError}
              isError={current && searchCurrent && roster.isError}
              showToolbar={false}
              getRowId={(student) => student.id}
              emptyState={<DataTableEmptyState title="No eligible students" description="No students currently match this audience." />}
              filteredEmptyState={<DataTableEmptyState title="No search matches" description="Try another name or student ID." />}
              errorState={<DataTableErrorState title="Couldn’t load the roster" description="Close and reopen the preview to retry." />}
              manual={{
                pageIndex: page - 1,
                pageSize,
                rowCount: rosterReady ? roster.data.searchMatches : 0,
                onPageChange: (index) => setPage(index + 1),
                onPageSizeChange: setPageSize,
                sorting: [],
                onSortingChange: () => {},
                isPending: !rosterReady,
                isFiltered: search.trim().length > 0,
              }}
            />
            <Button variant="outline" onClick={() => setOpen(false)}>Close preview</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

import { Table as TableType } from "@tanstack/react-table";
import { ArrowUpDown, Filter, Plus, QrCode, Upload } from "lucide-react";
import Link from "next/link";
import StudentSearchInput from "@/features/students/components/StudentsDataTable/StudentSearchInput";
import { useCallback, useState } from "react";
import StudentSortPopover from "../StudentSortPopover";
import StudentFilterPopover from "../StudentFilterPopover";
import { Option } from "@/globals/types/primitives";

type Props<TData> = {
  // DATA
  table: TableType<TData>;
  filterOptions: Record<string, Option[]>;

  // UI
  categoryHeader: string;
  categorySubheader: string;
  groupSlug: string; // sub category perhaps

  // CALLBACKS
  onAddStudent: () => void;
  onOpenQRCenter: () => void;
  selectedCount: number;
};

const DataTableHeader = <TData,>({
  table,
  filterOptions,
  categoryHeader,
  categorySubheader,
  groupSlug,
  onAddStudent,
  onOpenQRCenter,
  selectedCount,
}: Props<TData>) => {
  const [activePopover, setActivePopover] = useState<"filter" | "sort" | null>(
    null,
  );

  const togglePopover = useCallback((type: typeof activePopover) => {
    setActivePopover((prev) => (prev === type ? null : type));
  }, []);

  const totalRows = table.getCoreRowModel().rows.length;
  const filteredRowsCount = table.getFilteredRowModel().rows.length;
  const activeFilterCount = table.getState().columnFilters.length;
  const isSearching = !!table.getState().globalFilter;

  return (
    <div className="p-6 gap-5 overflow-hidden flex flex-col relative rounded-3xl border border-slate-200 bg-white/95 shadow-[0_20px_45px_rgba(15,23,42,0.08)] backdrop-blur">
      {/* Gradient Thingy */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.14),transparent_58%)]" />

      {/* The Actual Content */}
      <div className="relative flex flex-col gap-5">
        {/* Top Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          {/* Left Header Part */}
          <div className="text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">
              {categorySubheader}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
              {categoryHeader}
            </h1>
            {groupSlug && (
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                {groupSlug}
              </p>
            )}
          </div>

          {/* Right Header Badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              Total: {totalRows}
            </span>
            <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              Matching: {filteredRowsCount}
            </span>
            {activeFilterCount > 0 ? (
              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                Filters: {activeFilterCount}
              </span>
            ) : null}
            {isSearching ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Search Active
              </span>
            ) : null}
          </div>
        </div>
        {/* End Top Header */}

        {/* Start Bottom Header */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onAddStudent}
              className="inline-flex items-center gap-2 rounded-full border border-indigo-600 bg-indigo-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-sm transition hover:bg-indigo-500"
            >
              <Plus className="size-4" strokeWidth={1.6} />
              Add
            </button>

            <Link
              href={"/students/import"}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-800"
            >
              <Upload className="size-4" strokeWidth={1.6} />
              Import
            </Link>

            <button type="button" onClick={onOpenQRCenter} className="inline-flex items-center gap-2 rounded-full border border-indigo-300 bg-indigo-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 shadow-sm transition hover:bg-indigo-100">
              <QrCode className="size-4" strokeWidth={1.6} />
              {selectedCount ? `Print QR Codes (${selectedCount})` : "QR Codes"}
            </button>

            <div className="flex items-center gap-2">
              <StudentSortPopover table={table}>
                <button
                  type="button"
                  onClick={() => togglePopover("sort")}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-800"
                  aria-expanded={activePopover === "sort"}
                  aria-controls="student-sort-popover"
                >
                  <ArrowUpDown className="size-4" strokeWidth={1.6} />
                  Sort
                </button>
              </StudentSortPopover>

              <StudentFilterPopover table={table} options={filterOptions}>
                <button
                  type="button"
                  onClick={() => togglePopover("filter")}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-800"
                  aria-expanded={activePopover === "filter"}
                  aria-controls="student-filter-popover"
                >
                  <Filter className="size-4" strokeWidth={1.6} />
                  Filter
                </button>
              </StudentFilterPopover>
            </div>
          </div>

          <StudentSearchInput
            value={table.getState().globalFilter ?? ""}
            onChange={(value) => table.setGlobalFilter(value)}
          />
        </div>
      </div>
    </div>
  );
};

export default DataTableHeader;

"use client";

import {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ReactNode, useEffect, useState } from "react";
import DataTablePagination from "./DataTablePagination";
import DataTableToolbar from "./DataTableToolbar";
import DataTableViewport from "./DataTableViewPort";
import { PAGE_SIZE_OPTIONS } from "./config";

/**
 * Controlled/server ("manual") table configuration.
 *
 * When provided, the DataTable stops managing pagination and sorting itself.
 * It instead reflects the supplied state and forwards every change to the
 * parent, which is expected to re-query the server. `data` is then the
 * already-paginated, already-sorted, already-filtered page for the current
 * view - the table never slices or reorders it.
 */
export type DataTableManualConfig = {
  /** Zero-based index of the current page. */
  pageIndex: number;
  fixedPageSize?: boolean;
  /** Rows per page currently applied on the server. */
  pageSize: number;
  /** Total rows matching the active query, across every page. */
  rowCount: number;
  /** Requests a different page (zero-based). */
  onPageChange: (pageIndex: number) => void;
  /** Requests a different page size; the parent resets to page 1. */
  onPageSizeChange: (pageSize: number) => void;
  /** Current server sort expressed as TanStack sorting state. */
  sorting: SortingState;
  /** Forwards a header sort toggle to the server sort state. */
  onSortingChange: (sorting: SortingState) => void;
  /**
   * Whether a server navigation is in flight. Dims the table and disables
   * pagination so the user can't queue conflicting requests.
   */
  isPending?: boolean;
  /**
   * Whether the current query is refined (search/filter active). Drives which
   * empty state shows, since manual mode can't infer it from client filters.
   */
  isFiltered?: boolean;
};

/**
 * Props for the application's standard DataTable component.
 *
 * This table is the default solution for rendering tabular data across the app.
 * By default it manages sorting, filtering, pagination, and a search toolbar on
 * the client. Supply `manual` to drive pagination and sorting from the server
 * instead, while keeping the identical table shell, states, and pagination UI.
 */
type DataTableProps<TData, TValue> = {
  /** Column definitions compatible with TanStack Table */
  columns: ColumnDef<TData, TValue>[];

  /** The rows to render (a server page in manual mode, the full set otherwise) */
  data: TData[];

  /** Whether the table is currently loading data */
  isLoading: boolean;

  /** Title displayed in the built-in toolbar. Omit to hide the title. */
  title?: string;

  /**
   * Renders the built-in toolbar (title + optional search). Defaults to true.
   * Ignored when `toolbar` is supplied.
   */
  showToolbar?: boolean;

  /** Shows the built-in client-side search box. Defaults to true. */
  showSearch?: boolean;

  /** Extra content rendered at the trailing edge of the built-in toolbar. */
  toolbarTrailing?: ReactNode;

  /**
   * A feature-specific toolbar rendered in the shared card, in place of the
   * built-in one. Lets a feature (Student List) keep its own controls while
   * living inside the same table shell, so the whole card looks unified rather
   * than a separate toolbar card floating above the table.
   */
  toolbar?: ReactNode;

  /** Custom empty state (no data, no active refinement). */
  emptyState?: ReactNode;

  /** Custom empty state shown when a search/filter yields nothing. */
  filteredEmptyState?: ReactNode;

  /** Whether the data failed to load. Shows the error state inside the card. */
  isError?: boolean;

  /** Custom error state; falls back to a shared default when omitted. */
  errorState?: ReactNode;

  /**
   * Derives a stable row id from the row data (e.g. a student number) instead
   * of the array index. Recommended whenever rows can be reordered, paginated,
   * or mutated so React and TanStack track identity correctly.
   */
  getRowId?: (row: TData, index: number) => string;

  /**
   * Present => server/manual mode. Absent => the table manages pagination,
   * sorting, and filtering entirely on the client (the historical behavior).
   */
  manual?: DataTableManualConfig;

  /**
   * Client-mode only. An identity token for the underlying data set (e.g. the
   * selected event id). When it changes, client pagination jumps back to page 1
   * so switching data sets never strands the user on a page that no longer
   * exists. Keyed on identity rather than row count, since two data sets can
   * share the same number of rows. Ignored in manual mode (the server owns the
   * page there).
   */
  resetKey?: string;
};

/**
 * DataTable
 *
 * The standard, reusable table used throughout the application. It encapsulates
 * common table behavior so features don't reimplement table markup, pagination,
 * loading, or empty states. Client-managed and server-managed modes share the
 * exact same viewport and pagination UI - only who owns the state differs.
 *
 * ## Use this for any new table
 *
 * A second, feature-local table exists at
 * `features/students/components/StudentsDataTable/`, used only by the Student
 * List's roster. The two share no code. That duplication is known and tracked -
 * **new tables use this component**, not that one.
 *
 * ## Conventions
 * - Column definitions belong in a `constants/` file next to the owning
 *   feature, as a `ColumnDef<T>[]`, not inlined in the rendering component.
 * - Reduce relation objects to primitives with `accessorFn` before rendering.
 *   Passing a relation straight through breaks sorting and has crashed this
 *   table before.
 * - Pass `getRowId` whenever rows can be paginated, reordered, or mutated, so
 *   React and TanStack track identity correctly.
 * - Pass `resetKey` (e.g. the selected event id) in client mode so switching
 *   data sets returns to page 1 instead of stranding the user on a page that
 *   no longer exists.
 *
 * @see /design-system — live example with the standard states
 * @see docs/design-system.md — table and page-pattern guidance
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading,
  title,
  showToolbar = true,
  showSearch = true,
  toolbarTrailing,
  toolbar,
  emptyState,
  filteredEmptyState,
  isError = false,
  errorState,
  getRowId,
  manual,
  resetKey,
}: DataTableProps<TData, TValue>) {
  // Client-mode state (unused in manual mode, where the server owns it).
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  // Client pagination is controlled here. TanStack only wires nextPage(),
  // setPageSize(), etc. to a state updater when onPaginationChange is supplied;
  // previously it was left undefined in client mode, which silently overrode the
  // default updater and made every pager control a no-op. Seed pageSize from the
  // shared option list so the default matches the selector it renders.
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE_OPTIONS[0],
  });

  const isManual = !!manual;

  // Jumping back to the first page keeps a refined view from stranding the user
  // on a now-empty deep page. Skip the state write when already there so we
  // don't trigger a needless render.
  const resetClientPageIndex = () =>
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    );

  const handleManualSorting: OnChangeFn<SortingState> = (updater) => {
    if (!manual) return;
    const next =
      typeof updater === "function" ? updater(manual.sorting) : updater;
    manual.onSortingChange(next);
  };

  const handleManualPagination: OnChangeFn<PaginationState> = (updater) => {
    if (!manual) return;
    const current = { pageIndex: manual.pageIndex, pageSize: manual.pageSize };
    const next = typeof updater === "function" ? updater(current) : updater;
    // A page-size change resets to the first page; the parent owns that reset.
    if (next.pageSize !== current.pageSize) {
      manual.onPageSizeChange(next.pageSize);
    } else if (next.pageIndex !== current.pageIndex) {
      manual.onPageChange(next.pageIndex);
    }
  };

  // Client mode: sorting, searching, or column-filtering from a deep page should
  // land on page 1 (the standard "new query" behavior). autoResetPageIndex is
  // disabled below to survive live polling, so these resets are re-added
  // explicitly for the cases where a reset is actually wanted.
  const handleClientSorting: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater);
    resetClientPageIndex();
  };
  const handleClientColumnFilters: OnChangeFn<ColumnFiltersState> = (
    updater
  ) => {
    setColumnFilters(updater);
    resetClientPageIndex();
  };
  const handleClientGlobalFilter: OnChangeFn<string> = (updater) => {
    setGlobalFilter(updater);
    resetClientPageIndex();
  };

  const table = useReactTable({
    data,
    columns,
    ...(getRowId ? { getRowId } : {}),
    state: manual
      ? {
          sorting: manual.sorting,
          pagination: {
            pageIndex: manual.pageIndex,
            pageSize: manual.pageSize,
          },
        }
      : {
          sorting,
          columnFilters,
          globalFilter,
          pagination,
        },
    // Manual mode: the server already sorted, filtered, and paginated the page.
    manualPagination: isManual,
    manualSorting: isManual,
    manualFiltering: isManual,
    ...(manual ? { rowCount: manual.rowCount } : {}),
    // Client mode polls (live attendance) replace the data array every few
    // seconds; leave the automatic page-index reset off so a poll can't bounce
    // the user back to page 1. The intentional resets (sort/search/filter,
    // dataset change) and page clamping are handled explicitly instead.
    ...(isManual ? {} : { autoResetPageIndex: false }),
    onSortingChange: manual ? handleManualSorting : handleClientSorting,
    onPaginationChange: manual ? handleManualPagination : setPagination,
    onColumnFiltersChange: manual ? undefined : handleClientColumnFilters,
    onGlobalFilterChange: manual ? undefined : handleClientGlobalFilter,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    // Client row models are skipped in manual mode so the server page renders
    // verbatim (no second, page-local sort/filter/slice on top of it).
    ...(isManual
      ? {}
      : {
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
        }),
  });

  // With autoResetPageIndex disabled we lose its one genuinely useful job:
  // keeping pageIndex in range when the row set shrinks. Re-add just that. If a
  // deletion or filter drops the page count below the current page, clamp to the
  // last real page instead of rendering an empty, impossible page. Growing the
  // set (a new scan) leaves the current page untouched.
  const clientPageCount = isManual ? 0 : table.getPageCount();
  useEffect(() => {
    if (isManual) return;
    // Clamp to the last valid page. When the set is emptied entirely
    // (clientPageCount === 0) the only valid index is 0, so a deep pageIndex
    // left over from a now-gone page must still be pulled back rather than
    // stranded past the (empty) end.
    const lastPageIndex = Math.max(clientPageCount - 1, 0);
    setPagination((prev) =>
      prev.pageIndex > lastPageIndex
        ? { ...prev, pageIndex: lastPageIndex }
        : prev,
    );
  }, [isManual, clientPageCount, pagination.pageIndex]);

  // A change of data-set identity (e.g. selecting a different event, which swaps
  // the rows without unmounting the table) restarts at page 1.
  useEffect(() => {
    if (isManual) return;
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    );
  }, [resetKey, isManual]);

  const isPending = manual?.isPending ?? false;

  return (
    <div
      // No overall height cap: the card grows with its content and the page
      // scrolls, so a wrapping toolbar + viewport + pagination can never exceed
      // a fixed card height and overflow on short/mobile screens. Only the
      // viewport itself scrolls (see DataTableViewport).
      className={`flex flex-col gap-4 border border-gray-300 w-full rounded-md p-4 pb-0 shadow-sm transition-opacity ${
        isPending ? "opacity-60" : "opacity-100"
      }`}
      aria-busy={isPending}
    >
      {toolbar ??
        (showToolbar ? (
          <DataTableToolbar
            title={title}
            table={table}
            showSearch={showSearch && !isManual}
            trailing={toolbarTrailing}
          />
        ) : null)}
      <DataTableViewport
        table={table}
        isLoading={isLoading}
        isError={isError}
        errorState={errorState}
        isFiltered={manual?.isFiltered}
        emptyState={emptyState}
        filteredEmptyState={filteredEmptyState}
      />
      {/* No pagination while loading or errored: "Page 1 of 1" and page-size
          controls make no sense next to a skeleton or an error message. */}
      {!isLoading && !isError && (
        <DataTablePagination table={table} disabled={isPending} showPageSizeSelector={!manual?.fixedPageSize} />
      )}
    </div>
  );
}

export default DataTable;

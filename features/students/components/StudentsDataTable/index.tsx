"use client";

import {
  ColumnDef,
  ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  RowSelectionState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { useEffect, useMemo, useRef, useState } from "react";
import DataTableBody from "./DataTableBody";
import DataTableHeader from "./DataTableHeader";
import getDynamicFilters from "../../utils/getDynamicFilters";
import { StudentListCategory } from "../../types";
import { Student } from "@/globals/types/students";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/globals/contexts/AuthContext";
import { toastInfo } from "@/globals/components/shared/toasts";
import StudentBulkActions from "../StudentBulkActions";
import StudentBulkReviewSheet, { BulkSheetMode } from "../StudentBulkReviewSheet";
import StudentBulkExportSheet from "../StudentBulkExportSheet";

/**
 * Props for the application's standard DataTable component.
 *
 * This table is intentionally opinionated and designed to be the
 * default solution for rendering tabular data across the app.
 * Sorting, filtering, pagination, and a toolbar are provided out of the box.
 */
type DataTableProps<TValue> = {
  /** Column definitions compatible with TanStack Table */
  columns: ColumnDef<Student, TValue>[];
  /** The dataset to render */
  data: Student[];
  /** Whether the table is currently loading data */
  isLoading: boolean;
  /** Whether the data fetch failed */
  isError?: boolean;
  /** Usually displays the category name */
  categoryHeader: string;
  /** Complements the category name */
  categorySubheader: string;
  /** The slug for the group currently being displayed */
  groupSlug: string;
  /** Callback for adding a student */
  onAddStudent: () => void;
  /** Student List Category being displayed */
  category: StudentListCategory;
};

/**
 * DataTable
 *
 * The standard, reusable table component used throughout the application.
 * It encapsulates common table behavior such as sorting, filtering,
 * pagination, and global search to avoid reimplementation in each feature.
 */
function StudentsDataTable<TValue>({
  columns,
  data,
  isLoading,
  isError = false,
  categoryHeader,
  categorySubheader,
  groupSlug,
  onAddStudent,
  category,
}: DataTableProps<TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const router = useRouter();
  const searchParams = useSearchParams();
  const previousData = useRef(data);
  const { user } = useAuth();
  const [bulkMode, setBulkMode] = useState<BulkSheetMode | "EXPORT" | null>(null);
  const [selectionGeneration, setSelectionGeneration] = useState(0);
  const previousSelectionKey = useRef("");
  const previousContextKey = useRef<string | null>(null);

  // Server-roster identity: authenticated user + normalized roster query.
  // Client filter/search/sort/page state is intentionally not identity.
  const contextKey = useMemo(
    () => `${user?.id ?? "anon"}:${category}:${groupSlug}`,
    [user?.id, category, groupSlug],
  );

  useEffect(() => {
    if (category === "COLLEGE") {
      setColumnVisibility((prev) => ({
        ...prev,
        strand: false,
        program: true,
        department: true,
      }));
    } else if (category === "SHS") {
      setColumnVisibility((prev) => ({
        ...prev,
        strand: true,
        program: false,
        department: false,
      }));
    }
  }, [category]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      rowSelection,
    },
    onSortingChange: (updater) => {
      setSorting(updater);
      table.resetPageIndex();
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater);
      table.resetPageIndex();
    },
    onGlobalFilterChange: (updater) => {
      setGlobalFilter(updater);
      table.resetPageIndex();
    },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getRowId: (student) => student.id,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });

  useEffect(() => {
    if (previousData.current !== data) {
      previousData.current = data;
      table.resetPageIndex();
    }
  }, [data, table]);

  const dynamicFilters = useMemo(() => getDynamicFilters(data), [data]);
  const dataIds = useMemo(() => new Set(data.map((s) => s.id)), [data]);
  // Snapshot takes only truthy selection keys still in the loaded dataset,
  // de-duplicates and sorts the ID strings.
  const selectedIds = useMemo(
    () =>
      [...new Set(data.filter((student) => rowSelection[student.id]).map((s) => s.id))].sort(),
    [data, rowSelection],
  );
  const selectedStudents = useMemo(
    () => {
      const byId = new Map(data.map((s) => [s.id, s]));
      return selectedIds.map((id) => byId.get(id)).filter((s): s is Student => !!s);
    },
    [data, selectedIds],
  );
  const selectionKey = useMemo(() => JSON.stringify(selectedIds), [selectedIds]);

  // Monotonically increasing local generation when the set changes.
  useEffect(() => {
    if (previousSelectionKey.current !== selectionKey) {
      previousSelectionKey.current = selectionKey;
      setSelectionGeneration((g) => g + 1);
    }
  }, [selectionKey]);

  // A route/server-roster-context or signed-in-user change clears selection
  // with a brief notice. Sorting and page changes preserve it.
  useEffect(() => {
    if (previousContextKey.current === null) {
      previousContextKey.current = contextKey;
      return;
    }
    if (previousContextKey.current !== contextKey) {
      previousContextKey.current = contextKey;
      setRowSelection({});
      setBulkMode(null);
      toastInfo("Selection cleared", "Roster context changed.");
    }
  }, [contextKey]);

  // A successful refetch may remove IDs no longer in the dataset; announce
  // the removal rather than quietly changing the preview population.
  useEffect(() => {
    const staleKeys = Object.keys(rowSelection).filter((id) => id && !dataIds.has(id));
    if (staleKeys.length > 0 && data.length > 0) {
      setRowSelection((prev) => {
        const next = { ...prev };
        for (const id of staleKeys) delete next[id];
        return next;
      });
      toastInfo(
        "Selection updated",
        `${staleKeys.length} selected student(s) are no longer in the roster and were removed.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataIds]);

  const openQRCenter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("category", category);
    if (globalFilter) params.set("search", globalFilter);
    columnFilters.forEach(({ id, value }) => { if (typeof value === "string" && value) params.set(`filter_${id}`, value); });
    sessionStorage.setItem("student-qr-selection", JSON.stringify({ context: `${category}:${groupSlug}`, ids: selectedIds }));
    if (selectedIds.length) params.set("scope", "selected");
    router.push(`/students/qr-codes?${params.toString()}`);
  };

  const visibleSelectedCount = table.getFilteredRowModel().rows.filter((row) => row.getIsSelected()).length;
  const hiddenCount = Math.max(selectedIds.length - visibleSelectedCount, 0);

  const handleClearSelection = () => {
    setRowSelection({});
    setBulkMode(null);
  };

  const handleExclude = (idsToRemove: string[]) => {
    const remove = new Set(idsToRemove);
    setRowSelection((prev) => {
      const next = { ...prev };
      for (const id of remove) delete next[id];
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4 w-full rounded-md">
      <DataTableHeader
        table={table}
        categoryHeader={categoryHeader}
        categorySubheader={categorySubheader}
        groupSlug={groupSlug}
        onAddStudent={onAddStudent}
        filterOptions={dynamicFilters}
        selectedCount={selectedIds.length}
        onOpenQRCenter={openQRCenter}
      />

      <StudentBulkActions
        selectedCount={selectedIds.length}
        hiddenCount={hiddenCount}
        onReview={() => setBulkMode("REVIEW")}
        onClear={handleClearSelection}
        onExport={() => setBulkMode("EXPORT")}
        onChangeSection={() => setBulkMode("SET_SECTION")}
        onChangeHouse={() => setBulkMode("SET_HOUSE")}
      />

      <DataTableBody table={table} isLoading={isLoading} isError={isError} />

      {(bulkMode === "REVIEW" || bulkMode === "SET_SECTION" || bulkMode === "SET_HOUSE") && (
        <StudentBulkReviewSheet
          open
          onOpenChange={(open) => {
            if (!open) setBulkMode(null);
          }}
          mode={bulkMode}
          selectedIds={selectedIds}
          selectedStudents={selectedStudents}
          hiddenCount={hiddenCount}
          contextKey={contextKey}
          selectionGeneration={selectionGeneration}
          onExclude={handleExclude}
        />
      )}
      {bulkMode === "EXPORT" && (
        <StudentBulkExportSheet
          open
          onOpenChange={(open) => {
            if (!open) setBulkMode(null);
          }}
          selectedIds={selectedIds}
          contextKey={contextKey}
          selectionGeneration={selectionGeneration}
        />
      )}
    </div>
  );
}

export default StudentsDataTable;

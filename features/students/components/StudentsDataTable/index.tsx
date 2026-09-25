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
  const selectedIds = data.filter((student) => rowSelection[student.id]).map((student) => student.id);

  const openQRCenter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("category", category);
    if (globalFilter) params.set("search", globalFilter);
    columnFilters.forEach(({ id, value }) => { if (typeof value === "string" && value) params.set(`filter_${id}`, value); });
    sessionStorage.setItem("student-qr-selection", JSON.stringify({ context: `${category}:${groupSlug}`, ids: selectedIds }));
    if (selectedIds.length) params.set("scope", "selected");
    router.push(`/students/qr-codes?${params.toString()}`);
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

      <DataTableBody table={table} isLoading={isLoading} isError={isError} />
    </div>
  );
}

export default StudentsDataTable;

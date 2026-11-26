"use client";

import { Table as TableType } from "@tanstack/react-table";

import { Button } from "@/globals/components/shad-cn/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/globals/components/shad-cn/select";
import { PAGE_SIZE_OPTIONS } from "./config";

type DataTablePaginationProps<TData> = {
  table: TableType<TData>;
  /**
   * Disables every control (used while a server navigation is pending) so the
   * user can't queue conflicting page requests. Client-managed tables leave
   * this false.
   */
  disabled?: boolean;
  showPageSizeSelector?: boolean;
};

/**
 * DataTablePagination
 *
 * One pagination UI for every table. It reads page/size/total off the table
 * instance, so it works identically whether pagination is client-managed or
 * server-controlled (manual mode) - the only difference is who owns the state
 * behind the instance. The row total comes from getRowCount(), which reflects
 * the server's total in manual mode and the full filtered set on the client.
 */
function DataTablePagination<TData>({
  table,
  disabled = false,
  showPageSizeSelector = true,
}: DataTablePaginationProps<TData>) {
  const total = table.getRowCount();
  const { pageIndex, pageSize } = table.getState().pagination;
  // getPageCount() is 0 for an empty table; clamp so we never show "Page 1 of 0"
  // or "Page 0 of N" - an empty table reads as "Page 1 of 1".
  const pageCount = Math.max(table.getPageCount(), 1);
  const currentPage = Math.min(pageIndex + 1, pageCount);
  const firstRow = total === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-4">
      <div className="text-muted-foreground text-sm">
        {total === 0
          ? "No rows"
          : `Showing ${firstRow}–${lastRow} of ${total}`}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 lg:gap-x-8">
        {showPageSizeSelector ? <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows per page</p>
          <Select
            value={`${pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={`${size}`}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div> : null}
        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
          Page {currentPage} of {pageCount}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={disabled || !table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={disabled || !table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={disabled || !table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={disabled || !table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default DataTablePagination;

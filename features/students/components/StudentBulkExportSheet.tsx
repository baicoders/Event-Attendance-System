"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/globals/components/shad-cn/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/globals/components/shad-cn/alert";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { DataTable } from "@/globals/components/shared/dataTable/DataTable";
import { useAuth } from "@/globals/contexts/AuthContext";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";
import type { BulkExportResponse } from "@/globals/types/studentBulk";
import { BulkApiError, useBulkExportSelected } from "../hooks/useStudentBulkActions";
import {
  bulkExportFilename,
  serializeBulkExportCsv,
} from "@/globals/utils/studentBulkCsv";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  contextKey: string;
  selectionGeneration: number;
};

const EXPORT_PREVIEW_COLUMNS = [
  { accessorKey: "studentId", header: "Student ID" },
  {
    id: "name",
    header: "Name",
    accessorFn: (row: { lastName: string; firstName: string }) => `${row.lastName}, ${row.firstName}`,
  },
  { accessorKey: "schoolLevel", header: "Level" },
  { accessorKey: "yearLevel", header: "Year" },
] as never;

export default function StudentBulkExportSheet({
  open,
  onOpenChange,
  selectedIds,
  contextKey,
  selectionGeneration,
}: Props) {
  const { user } = useAuth();
  const exportMutation = useBulkExportSelected();
  const [prepared, setPrepared] = useState<BulkExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const [preparedKey, setPreparedKey] = useState<string | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sortedIds = [...selectedIds].sort();
  const currentKey = JSON.stringify({
    ids: sortedIds,
    context: contextKey,
    gen: selectionGeneration,
    user: user?.id ?? "anon",
  });
  const isStale = preparedKey !== null && preparedKey !== currentKey;

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement;
      setPrepared(null);
      setError(null);
      setMissingIds([]);
      setPreparedKey(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let cancelled = false;
      (async () => {
        try {
          const result = await exportMutation.mutateAsync({ studentIds: sortedIds, signal: controller.signal });
          if (cancelled) return;
          // Use the same prepared, immutable-in-memory result for preview and
          // download; never refetch behind Download.
          setPrepared(result);
          setPreparedKey(currentKey);
        } catch (e) {
          if (cancelled) return;
          if (e instanceof BulkApiError) {
            setError(e.message);
            setMissingIds(e.missingIds);
            toastDanger("Export failed", e.message);
          } else if (e instanceof Error && e.name === "AbortError") {
            // Cancelled — no error UI.
          } else {
            setError("Export failed. No file was produced.");
            toastDanger("Export failed");
          }
        }
      })();
      return () => {
        cancelled = true;
        controller.abort();
      };
    } else {
      abortRef.current?.abort();
      setPrepared(null);
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDownload = async () => {
    if (!prepared || isStale) return;
    try {
      const csv = serializeBulkExportCsv(prepared.rows);
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = bulkExportFilename(prepared.preparedAt);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toastSuccess(`Downloaded ${prepared.rows.length} student(s)`);
    } catch {
      toastDanger("Download failed", "Prepared data was discarded. Prepare again.");
    }
  };

  const previewRows = prepared ? prepared.rows.slice(0, 10) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:w-[min(860px,95vw)] sm:max-w-none">
        <SheetHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
          <SheetTitle className="text-xl font-bold text-slate-800">
            Export selected — {sortedIds.length} student(s)
          </SheetTitle>
          <SheetDescription>
            This is a roster extract, not an attendance report or import template. Import
            Student ID as text in a spreadsheet to retain leading zeros.
          </SheetDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            {prepared ? (
              <>
                <StatusBadge tone="primary">
                  Prepared from current records at{" "}
                  {new Date(prepared.preparedAt).toLocaleTimeString("en-PH", {
                    timeZone: "Asia/Manila",
                  })} (Asia/Manila)
                </StatusBadge>
                <StatusBadge tone="success">All {prepared.selectionCount} IDs resolved</StatusBadge>
                <StatusBadge tone="neutral">Preview shows first 10 only</StatusBadge>
              </>
            ) : (
              <StatusBadge>Preparing…</StatusBadge>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {exportMutation.isPending ? <p className="text-sm text-slate-600">Preparing extract…</p> : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Preparation failed — no file produced</AlertTitle>
              <AlertDescription>
                {error}
                {missingIds.length > 0 ? (
                  <span className="mt-1 block">Missing: {missingIds.slice(0, 20).join(", ")}{missingIds.length > 20 ? ` …and ${missingIds.length - 20} more` : ""}</span>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {isStale && prepared ? (
            <Alert variant="destructive">
              <AlertTitle>Prepared data is stale</AlertTitle>
              <AlertDescription>
                Selection or account changed after preparation. Close and prepare again —
                the stale file will not download.
              </AlertDescription>
            </Alert>
          ) : null}
          {prepared ? (
            <div className="overflow-x-auto">
              <DataTable
                columns={EXPORT_PREVIEW_COLUMNS}
                data={previewRows}
                isLoading={false}
                showToolbar={false}
                getRowId={(row) => (row as { studentId: string }).studentId}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!prepared || isStale}
              className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {prepared ? `Download all ${prepared.rows.length} as CSV` : "Download"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/globals/components/shad-cn/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/globals/components/shad-cn/alert";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { DataTable } from "@/globals/components/shared/dataTable/DataTable";
import ComboBox from "@/globals/components/shared/ComboBox";
import { useFetchGroupsByCategory } from "@/globals/hooks/useGroups";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { CircleCheck } from "lucide-react";
import { toastDanger, toastInfo, toastSuccess, toastWarning } from "@/globals/components/shared/toasts";
import type { Student } from "@/globals/types/students";
import type { BulkAction } from "@/globals/schemas/studentBulk";
import type { BulkPreviewResponse } from "@/globals/types/studentBulk";
import {
  BulkApiError,
  useBulkCommit,
  useBulkPreview,
} from "../hooks/useStudentBulkActions";

export type BulkSheetMode = BulkAction | "REVIEW";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BulkSheetMode;
  selectedIds: string[];
  selectedStudents: Student[];
  hiddenCount: number;
  contextKey: string;
  selectionGeneration: number;
  onExclude: (idsToRemove: string[]) => void;
  onCommitted?: () => void;
};

const PREVIEW_COLUMNS = [
  { accessorKey: "id", header: "ID" },
  {
    id: "student",
    header: "Student",
    accessorFn: (row: { lastName: string; firstName: string }) =>
      `${row.lastName}, ${row.firstName}`,
  },
  {
    id: "before",
    header: "Before",
    accessorFn: (row: { before: { slug: string | null } }) => row.before.slug ?? "—",
  },
  {
    id: "after",
    header: "After",
    accessorFn: (row: { after: { slug: string } }) => row.after.slug,
  },
  { accessorKey: "status", header: "Status" },
] as never;

const REVIEW_COLUMNS = [
  { accessorKey: "id", header: "Student ID" },
  {
    id: "name",
    header: "Student",
    accessorFn: (row: Student) => `${row.lastName}, ${row.firstName}`,
  },
  {
    id: "section",
    header: "Section",
    accessorFn: (row: Student) => row.section ?? "—",
  },
  {
    id: "house",
    header: "House",
    accessorFn: (row: Student) => row.house ?? "—",
  },
] as never;

export default function StudentBulkReviewSheet({
  open,
  onOpenChange,
  mode,
  selectedIds,
  selectedStudents,
  hiddenCount,
  contextKey,
  selectionGeneration,
  onExclude,
  onCommitted,
}: Props) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const previewMutation = useBulkPreview();
  const commitMutation = useBulkCommit();
  const [targetGroupId, setTargetGroupId] = useState("");
  const [preview, setPreview] = useState<BulkPreviewResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<BulkApiError | null>(null);
  const [commitError, setCommitError] = useState<BulkApiError | Error | null>(null);
  const [commitResult, setCommitResult] = useState<{
    changedIds: string[];
    unchangedIds: string[];
    committedAt: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const isMutation = mode === "SET_SECTION" || mode === "SET_HOUSE";
  const category = mode === "SET_SECTION" ? "SECTION" : mode === "SET_HOUSE" ? "HOUSE" : null;
  const { data: groupChoices } = useFetchGroupsByCategory(
    isMutation ? (category as never) : undefined,
  );

  const sortedIds = useMemo(() => [...selectedIds].sort(), [selectedIds]);
  const currentKey = useMemo(
    () =>
      JSON.stringify({
        ids: sortedIds,
        target: targetGroupId,
        action: mode,
        context: contextKey,
        gen: selectionGeneration,
        user: user?.id ?? "anon",
      }),
    [sortedIds, targetGroupId, mode, contextKey, selectionGeneration, user?.id],
  );

  const isStale = previewKey !== null && previewKey !== currentKey;

  const assignments = useMemo(() => {
    if (!isMutation || !category) return [];
    const counts = new Map<string, number>();
    for (const s of selectedStudents) {
      const slug = category === "SECTION" ? s.section : s.house;
      counts.set(slug ?? "(none)", (counts.get(slug ?? "(none)") ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [selectedStudents, isMutation, category]);

  // Focus return + reset on open.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement;
      setPreview(null);
      setPreviewKey(null);
      setPreviewError(null);
      setCommitError(null);
      setCommitResult(null);
      setAcknowledged(false);
      setTargetGroupId("");
      abortRef.current?.abort();
    } else {
      abortRef.current?.abort();
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    }
  }, [open]);

  // Account/context/selection change discards an open preview's authority:
  // mark stale rather than silently changing its population.
  useEffect(() => {
    if (!open) return;
    if (preview && isStale) {
      toastInfo("Selection changed", "The open preview is stale. Review again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  // After a successful apply the confirmation lives at the bottom of a
  // scrollable sheet (below the preview table), so bring it into view.
  // The toast alone is transient and easy to miss on a shared laptop.
  useEffect(() => {
    if (commitResult) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [commitResult]);

  const handleReview = async () => {
    if (!isMutation || !category) return;
    if (!targetGroupId) {
      toastWarning("Choose a target", `Pick a ${category.toLowerCase()} first.`);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    setPreviewError(null);
    setCommitError(null);
    setCommitResult(null);
    try {
      const result = await previewMutation.mutateAsync({
        studentIds: sortedIds,
        action: mode as BulkAction,
        targetGroupId,
        signal: controller.signal,
      });
      if (requestIdRef.current !== requestId) return;
      setPreview(result);
      setPreviewKey(currentKey);
      if (result.blockedCount > 0) {
        toastWarning("Preview blocked", `${result.blockedCount} of ${result.selectionCount} need attention. No changes made.`);
      }
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      if (e instanceof BulkApiError) {
        setPreviewError(e);
        toastDanger("Preview failed", e.message);
      } else if (e instanceof Error && e.name === "AbortError") {
        // Cancelled by a newer request — not a failure.
      } else {
        setPreviewError(new BulkApiError("Preview failed. Try again.", 500));
        toastDanger("Preview failed");
      }
    }
  };

  const blockedRows = useMemo(
    () => preview?.rows.filter((r) => r.status === "BLOCKED") ?? [],
    [preview],
  );

  const handleExcludeBlocked = () => {
    const ids = blockedRows.map((r) => r.id);
    if (ids.length === 0) return;
    onExclude(ids);
    setPreview(null);
    setPreviewKey(null);
    toastInfo("Excluded", `${ids.length} student(s) removed from selection. Review again.`);
  };

  const handleApply = async () => {
    if (!preview?.previewToken) return;
    if (!acknowledged) {
      toastWarning("Acknowledge impact", "Confirm roster reports may change before applying.");
      return;
    }
    const targetLabel = `${preview.target.name} (${preview.target.slug})`;
    const confirmed = await confirm({
      title: `Apply ${preview.changedCount} ${category?.toLowerCase()} change(s)?`,
      description: `Move ${preview.changedCount} student(s) to ${targetLabel}. Roster changes can alter eligibility and grouping in existing reports. This does not change event configuration or freeze past report membership.`,
    });
    if (!confirmed) return;
    setCommitError(null);
    try {
      const result = await commitMutation.mutateAsync({
        previewToken: preview.previewToken,
        acknowledgeReportImpact: true,
      });
      setCommitResult({
        changedIds: result.changedIds,
        unchangedIds: result.unchangedIds,
        committedAt: result.committedAt,
      });
      toastSuccess(`Applied ${result.changedIds.length} change(s)`);
      onCommitted?.();
    } catch (e) {
      if (e instanceof BulkApiError) {
        setCommitError(e);
        if (e.status === 0 || e.message.toLowerCase().includes("fetch")) {
          toastDanger("Outcome not confirmed", "Refresh these students before deciding whether to apply again.");
        } else if (e.status === 503) {
          toastDanger("Database busy", "No changes made. Try again.");
        } else if (e.status === 401 || e.status === 403) {
          toastDanger("Not permitted", e.message);
        } else {
          toastDanger("Apply failed — no changes made", e.message);
        }
      } else if (e instanceof Error && /failed to fetch|network|load failed/i.test(e.message)) {
        setCommitError(new Error("Outcome not confirmed; refresh these students before deciding whether to apply again."));
        toastDanger("Outcome not confirmed", "Refresh these students before deciding whether to apply again.");
      } else {
        setCommitError(e instanceof Error ? e : new Error("Apply failed"));
        toastDanger("Apply failed — no changes made");
      }
    }
  };

  const title =
    mode === "REVIEW"
      ? `Review selected — ${sortedIds.length}`
      : mode === "SET_SECTION"
        ? `Change section — ${sortedIds.length} selected`
        : `Change house — ${sortedIds.length} selected`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:w-[min(860px,95vw)] sm:max-w-none">
        <SheetHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
          <SheetTitle className="text-xl font-bold text-slate-800">{title}</SheetTitle>
          <SheetDescription>
            {mode === "REVIEW"
              ? "The entire explicit selection by student ID, including rows hidden by current filters. Names alone do not disambiguate students."
              : "Only one category changes. Program, department, year/grade, house/section (the other one) and attendance stay unchanged."}
          </SheetDescription>
          <div className="mt-2 flex flex-wrap gap-2" aria-live="polite">
            <StatusBadge tone="primary">Selected: {sortedIds.length}</StatusBadge>
            {hiddenCount > 0 ? <StatusBadge tone="info">Hidden by filters: {hiddenCount}</StatusBadge> : null}
            {preview ? (
              <>
                <StatusBadge tone="success">{preview.changedCount} changes</StatusBadge>
                <StatusBadge tone="neutral">{preview.unchangedCount} already in target</StatusBadge>
                {preview.blockedCount > 0 ? <StatusBadge tone="danger">{preview.blockedCount} blocked</StatusBadge> : null}
                {commitResult ? (
                  <StatusBadge tone="success">Committed: {commitResult.changedIds.length}</StatusBadge>
                ) : null}
              </>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 p-6">
          {mode === "REVIEW" ? (
            <>
              <p className="text-sm text-slate-600">
                Hidden means selected in the loaded roster but excluded by current client
                filters. The server-bound selection is this explicit ID list.
              </p>
              <div className="overflow-x-auto">
                <DataTable
                  columns={REVIEW_COLUMNS}
                  data={selectedStudents}
                  isLoading={false}
                  showToolbar={false}
                  getRowId={(row) => (row as Student).id}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  Current assignments:{" "}
                  {assignments.length === 0
                    ? "—"
                    : assignments.map(([slug, n]) => `${slug} (${n})`).join(", ")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Section-to-program/year compatibility is not stored in this system.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="bulk-target" className="text-sm font-semibold text-slate-700">
                  New {category?.toLowerCase()} (search existing)
                </label>
                <ComboBox
                  choices={(groupChoices ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.slug})` }))}
                  placeholder={`Search existing ${category?.toLowerCase()}s`}
                  searchFallbackMsg={`No matching ${category?.toLowerCase()}`}
                  selectedValue={targetGroupId}
                  onSelect={(v) => {
                    setTargetGroupId(v);
                    setPreview(null);
                    setPreviewKey(null);
                  }}
                  className="w-full"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleReview}
                  disabled={previewMutation.isPending || !targetGroupId}
                  className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {previewMutation.isPending ? "Reviewing…" : "Review changes"}
                </button>
              </div>

              {previewError ? (
                <Alert variant="destructive">
                  <AlertTitle>Preview failed</AlertTitle>
                  <AlertDescription>{previewError.message}</AlertDescription>
                </Alert>
              ) : null}

              {preview ? (
                <div className="space-y-3">
                  {isStale ? (
                    <Alert variant="destructive">
                      <AlertTitle>Preview is stale</AlertTitle>
                      <AlertDescription>
                        Selection, target, or account changed since this preview. Review again —
                        background refresh never overwrites a stale review.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="overflow-x-auto">
                    <DataTable
                      columns={PREVIEW_COLUMNS}
                      data={preview.rows}
                      isLoading={false}
                      showToolbar={false}
                      getRowId={(row) => (row as { id: string }).id}
                    />
                  </div>
                  {blockedRows.length > 0 ? (
                    <Alert variant="destructive">
                      <AlertTitle>
                        Preview blocked: {blockedRows.length} of {preview.selectionCount} need attention. No changes made.
                      </AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-5">
                          {blockedRows.slice(0, 10).map((r) => (
                            <li key={r.id}>
                              {r.id} — {r.reason}
                            </li>
                          ))}
                        </ul>
                        {blockedRows.length > 10 ? <p>…and {blockedRows.length - 10} more.</p> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewKey(currentKey)}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold"
                          >
                            Keep selection
                          </button>
                          <button
                            type="button"
                            onClick={handleExcludeBlocked}
                            className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
                          >
                            Exclude these {blockedRows.length} and review again
                          </button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ) : preview.changedCount === 0 ? (
                    <Alert>
                      <AlertTitle>Nothing to apply</AlertTitle>
                      <AlertDescription>
                        Every selected student already has this target. No write is needed.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <Alert>
                        <AlertTitle>Roster changes affect reports</AlertTitle>
                        <AlertDescription>
                          Roster changes can alter eligibility and grouping in existing
                          reports. This does not change event configuration or freeze past
                          report membership.
                        </AlertDescription>
                      </Alert>
                      <label className="flex items-start gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                          className="mt-1"
                        />
                        I understand current-roster report membership may change.
                      </label>
                    </>
                  )}
                  {commitError ? (
                    <Alert variant="destructive">
                      <AlertTitle>
                        {commitError instanceof BulkApiError && commitError.status === 503
                          ? "Database busy — no changes made"
                          : commitError instanceof Error &&
                              /outcome not confirmed/i.test(commitError.message)
                            ? "Outcome not confirmed"
                            : "Apply failed — no changes made"}
                      </AlertTitle>
                      <AlertDescription>
                        {commitError instanceof Error ? commitError.message : "Apply failed"}
                        {/outcome not confirmed/i.test(
                          commitError instanceof Error ? commitError.message : "",
                        )
                          ? " Refresh these students before deciding whether to apply again. Do not retry automatically."
                          : ""}
                        {commitError instanceof BulkApiError && commitError.issues.length > 0 ? (
                          <ul className="mt-1 list-disc pl-5">
                            {commitError.issues.slice(0, 10).map((i) => (
                              <li key={i.id}>
                                {i.id} — {i.reason}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {commitResult ? (
                    <div ref={resultRef} role="status" aria-live="polite">
                      <Alert className="border-emerald-300 bg-emerald-50">
                        <CircleCheck className="size-4 text-emerald-600" aria-hidden />
                        <AlertTitle className="text-emerald-900">
                          {commitResult.changedIds.length} {category?.toLowerCase()} change(s) applied
                        </AlertTitle>
                        <AlertDescription className="text-emerald-900">
                          {commitResult.changedIds.length} moved to {preview.target.name} (
                          {preview.target.slug})
                          {commitResult.unchangedIds.length > 0
                            ? `, ${commitResult.unchangedIds.length} already there`
                            : ""}
                          {" "}at {new Date(commitResult.committedAt).toLocaleString()}.
                          The roster behind this sheet has refreshed. Review again to
                          verify every row now shows as already in target.
                        </AlertDescription>
                      </Alert>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        {isMutation && preview && preview.previewToken && preview.changedCount > 0 && !commitResult ? (
          <SheetFooter className="border-t border-slate-100 bg-slate-50/50 p-4 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isStale || commitMutation.isPending || !acknowledged}
              className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {commitMutation.isPending
                ? "Applying…"
                : `Apply ${preview.changedCount} ${category?.toLowerCase()} change(s)`}
            </button>
          </SheetFooter>
        ) : null}
        {isMutation && commitResult ? (
          <SheetFooter className="border-t border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={handleReview}
              disabled={previewMutation.isPending}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider"
            >
              {previewMutation.isPending ? "Reviewing…" : "Review again to verify"}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-slate-800"
            >
              Done
            </button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

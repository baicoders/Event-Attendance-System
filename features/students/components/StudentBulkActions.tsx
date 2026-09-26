"use client";

import { BULK_EXPORT_LIMIT, BULK_MUTATION_LIMIT } from "@/globals/schemas/studentBulk";

type Props = {
  selectedCount: number;
  hiddenCount: number;
  onReview: () => void;
  onClear: () => void;
  onExport: () => void;
  onChangeSection: () => void;
  onChangeHouse: () => void;
  isExporting?: boolean;
};

export default function StudentBulkActions({
  selectedCount,
  hiddenCount,
  onReview,
  onClear,
  onExport,
  onChangeSection,
  onChangeHouse,
  isExporting = false,
}: Props) {
  if (selectedCount === 0) return null;

  const tooManyForMutation = selectedCount > BULK_MUTATION_LIMIT;
  const tooManyForExport = selectedCount > BULK_EXPORT_LIMIT;

  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-indigo-900">
          {selectedCount} selected across pages
        </span>
        {hiddenCount > 0 ? (
          <span className="text-xs text-indigo-700">
            • {hiddenCount} hidden by current filters
          </span>
        ) : null}
        <span className="sr-only">{selectedCount} students selected</span>
      </div>

      {tooManyForMutation ? (
        <p role="alert" className="text-xs text-amber-800">
          Selection exceeds {BULK_MUTATION_LIMIT} students for group changes. Choose a
          smaller selection to enable Change section/house. Export remains available
          within its own limit.
        </p>
      ) : null}
      {tooManyForExport ? (
        <p role="alert" className="text-xs text-amber-800">
          Selection exceeds {BULK_EXPORT_LIMIT} students for export. Choose a smaller
          selection.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReview}
          className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-sm transition hover:border-slate-400"
        >
          Review selected
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-sm transition hover:border-slate-400"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={tooManyForExport || isExporting}
          className="inline-flex items-center rounded-full border border-emerald-600 bg-emerald-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isExporting ? "Preparing…" : "Export selected"}
        </button>
        <button
          type="button"
          onClick={onChangeSection}
          disabled={tooManyForMutation}
          className="inline-flex items-center rounded-full border border-indigo-600 bg-indigo-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Change section
        </button>
        <button
          type="button"
          onClick={onChangeHouse}
          disabled={tooManyForMutation}
          className="inline-flex items-center rounded-full border border-indigo-600 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Change house
        </button>
      </div>
    </div>
  );
}

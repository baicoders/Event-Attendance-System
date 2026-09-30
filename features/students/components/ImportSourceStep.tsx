"use client";

import { useRef } from "react";
import { Button } from "@/globals/components/shad-cn/button";
import { CSV_HEADERS, LARGE_IMPORT_ROWS, MAX_IMPORT_BYTES } from "../import/contract";

export type ImportSource = {
  fileName: string;
  size: number;
  csv: string;
  sourceHash: string;
  rowCount: number;
  errors: { csvRow?: number; code: string; message: string }[];
  structurallyValid: boolean;
};

type Props = {
  source: ImportSource | null;
  busy: boolean;
  reading: boolean;
  largeAcknowledged: boolean;
  onAcknowledge: () => void;
  onFile: (file: File) => void;
  onReset: () => void;
  onReview: () => void;
};

export default function ImportSourceStep({ source, busy, reading, largeAcknowledged, onAcknowledge, onFile, onReset, onReview }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-label="Import source" className="space-y-5">
      <div className="rounded-xl border-2 border-dashed p-6 text-center" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault();
        if (!busy && event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]);
      }}>
        <p className="font-semibold">Drop CSV here or choose a file</p>
        <p className="mt-2 text-sm text-muted-foreground">Canonical student-import CSV only. File and complete request are limited to {MAX_IMPORT_BYTES / 1024 / 1024} MiB each.</p>
        <input ref={input} type="file" accept=".csv,text/csv" aria-label="Choose CSV file" className="mt-4 max-w-full text-sm" disabled={busy} onChange={event => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }} />
      </div>
      {reading && <p role="status">Reading and validating CSV…</p>}
      {source && <div className="rounded-xl border p-4 space-y-3">
        <p className="font-semibold break-all">{source.fileName}</p>
        <p className="text-sm text-muted-foreground">{source.rowCount.toLocaleString()} rows • {(source.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB</p>
        {source.structurallyValid && <p className="text-sm">CSV parsed • Canonical columns found • Student IDs preserved as text</p>}
        {source.errors.length > 0 && <div role="alert" className="text-sm text-red-700"><p className="font-semibold">{source.errors.length} issue(s) need attention</p><ul className="list-disc pl-5 space-y-1">{source.errors.slice(0, 20).map((error, i) => <li key={i}>{error.csvRow ? `CSV row ${error.csvRow}: ` : ""}{error.message}</li>)}</ul>{source.errors.length > 20 && <p>More issues will appear in the authoritative review.</p>}</div>}
        {source.rowCount >= LARGE_IMPORT_ROWS && !largeAcknowledged && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2"><p className="font-semibold">Large import — {source.rowCount.toLocaleString()} rows</p><p className="text-sm">This is a large batch to review and recover if something is wrong. Consider splitting it into smaller files. You can still continue with this file.</p><Button variant="outline" disabled={busy} onClick={onAcknowledge}>Continue anyway</Button></div>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>Replace file</Button><Button variant="outline" disabled={busy} onClick={onReset}>Reset</Button><Button disabled={busy || reading || !source.structurallyValid || (source.rowCount >= LARGE_IMPORT_ROWS && !largeAcknowledged)} onClick={onReview}>{busy ? "Preparing review…" : "Review import"}</Button></div>
      </div>}
      <details className="text-sm"><summary className="cursor-pointer font-medium">Canonical CSV format</summary><p className="mt-2 break-words font-mono text-xs">{CSV_HEADERS.join(", ")}</p><p className="mt-2">Names, ID, school level, year level, section, and house are required. College requires department and program; SHS requires strand. Group columns use slugs. Empty optional cells are allowed.</p></details>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/globals/components/shad-cn/button";
import { CSV_HEADERS } from "../import/contract";
import type { ReceiptRow } from "../import/receiptContract";

const PAGE_SIZE = 25;
const filters = [["ALL", "All"], ["CREATE", "Created"], ["UPDATE", "Updated"], ["UNCHANGED", "Unchanged"]] as const;

function RowEvidence({ row }: { row: ReceiptRow }) {
  return <div className="space-y-2 text-sm">
    {row.status === "UPDATE" && row.changes.map(change => <div key={change.field}><p className="font-medium">{change.field}</p><p className="break-words">{change.before ?? "Empty"} → {change.after ?? "Empty"}</p></div>)}
    {row.status === "CREATE" && <details><summary className="cursor-pointer underline">View created values</summary><dl className="mt-2 space-y-1">{CSV_HEADERS.map(field => <div key={field} className="break-words"><dt className="inline font-medium">{field}: </dt><dd className="inline">{row.student[field] || "Empty"}</dd></div>)}</dl></details>}
    {row.status === "UNCHANGED" && <p>Already current when reviewed. No student write.</p>}
    <Link href={`/students/${encodeURIComponent(row.studentId)}`} className="inline-block underline">View current student</Link>
  </div>;
}

export default function StudentImportReceiptRows({ rows }: { rows: ReceiptRow[] }) {
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => rows.filter(row => {
    const label = row.status === "CREATE" ? `${row.student.firstName} ${row.student.lastName}` : row.status === "UPDATE" ? row.studentLabel : "";
    return (filter === "ALL" || row.status === filter) && `${row.studentId} ${label}`.toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, search]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const studentLabel = (row: ReceiptRow) => row.status === "CREATE" ? `${row.student.firstName} ${row.student.lastName}` : row.status === "UPDATE" ? row.studentLabel : null;
  return <section aria-label="Receipt rows" className="space-y-4">
    <div className="flex flex-wrap gap-2" aria-label="Filter receipt rows">{filters.map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{label}</Button>)}</div>
    <label className="block text-sm font-medium">Search student ID / historical name<input aria-label="Search receipt rows" className="mt-1 w-full rounded-md border bg-background p-2 font-normal" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
    <p className="text-sm text-muted-foreground">{filtered.length.toLocaleString()} matching rows. Unchanged entries retain only the student ID.</p>
    <div className="hidden md:block"><table className="w-full table-fixed text-left"><thead><tr className="border-b text-sm"><th className="w-16 p-2">CSV row</th><th className="w-1/3 p-2">Student at import</th><th className="w-28 p-2">Result</th><th className="p-2">Historical evidence</th></tr></thead><tbody>{visible.map(row => <tr key={row.csvRow} className="border-b align-top"><td className="p-2 text-sm">{row.csvRow}</td><td className="p-2 break-words">{studentLabel(row) && <p className="font-medium">{studentLabel(row)}</p>}<p className="text-sm">{row.studentId}</p></td><td className="p-2 text-xs font-semibold">{row.status === "CREATE" ? "CREATED" : row.status === "UPDATE" ? "UPDATED" : "UNCHANGED"}</td><td className="p-2"><RowEvidence row={row} /></td></tr>)}</tbody></table></div>
    <div className="space-y-3 md:hidden">{visible.map(row => <article key={row.csvRow} className="rounded-lg border p-3 space-y-2"><p className="text-xs font-semibold">CSV row {row.csvRow} • {row.status === "CREATE" ? "CREATED" : row.status === "UPDATE" ? "UPDATED" : "UNCHANGED"}</p>{studentLabel(row) && <p className="font-medium break-words">{studentLabel(row)}</p>}<p className="text-sm break-all">{row.studentId}</p><RowEvidence row={row} /></article>)}</div>
    {visible.length === 0 && <p>No matching receipt rows.</p>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</Button><p className="text-sm">Page {currentPage + 1} of {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}</p><Button variant="outline" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next page</Button></div>
  </section>;
}

"use client";

import { useMemo, useState } from "react";
import { Button } from "@/globals/components/shad-cn/button";

import { CSV_HEADERS, type ImportReviewRow } from "../import/contract";

const filters = [["ALL", "All"], ["CREATE", "Creates"], ["UPDATE", "Updates"], ["UNCHANGED", "Unchanged"], ["BLOCKED", "Blocked"]] as const;
const PAGE_SIZE = 25;

export default function ImportReviewTable({ rows }: { rows: ImportReviewRow[] }) {
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => rows.filter(row => (filter === "ALL" || row.status === filter) && `${row.student.id} ${row.student.firstName} ${row.student.lastName}`.toLowerCase().includes(search.toLowerCase())), [rows, filter, search]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const details = (row: ImportReviewRow) => <div className="space-y-2 text-sm">{row.changes.map(change => <div key={change.field}><span className="font-semibold">{change.field}</span><p className="break-words">{change.before ?? "Empty"} <span aria-label="changes to">→</span> {change.after ?? "Empty"}</p></div>)}{row.reasons.map((reason, i) => <p key={i} className="text-red-700 break-words">{reason.field ? `${reason.field} (${row.student[reason.field] || "Empty"}): ` : ""}{reason.message}</p>)}{row.status === "UNCHANGED" && <p>Already current. No database write.</p>}{row.status === "CREATE" && <p>New student record.</p>}<details><summary className="cursor-pointer text-sm underline">View CSV values</summary><dl className="mt-2 space-y-1">{CSV_HEADERS.map(field => <div key={field} className="break-words"><dt className="inline font-medium">{field}: </dt><dd className="inline">{row.student[field] || "Empty"}</dd></div>)}</dl></details></div>;
  return <section aria-label="Import review rows" className="space-y-4">
    <div className="flex flex-wrap gap-2" aria-label="Filter review rows">{filters.map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{label}</Button>)}</div>
    <label className="block text-sm font-medium">Search student ID / name<input aria-label="Search import rows" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} className="mt-1 w-full rounded-md border bg-background p-2 font-normal" /></label>
    <p className="text-sm text-muted-foreground">{filtered.length.toLocaleString()} matching rows</p>
    <div className="hidden md:block"><table className="w-full table-fixed text-left"><thead><tr className="border-b text-sm"><th className="w-16 p-2">CSV row</th><th className="w-1/3 p-2">Student</th><th className="w-28 p-2">Result</th><th className="p-2">Changes / reasons</th></tr></thead><tbody>{visible.map(row => <tr key={row.csvRow} className="border-b align-top"><td className="p-2 text-sm">{row.csvRow}</td><td className="p-2 break-words"><p className="font-medium">{row.student.firstName} {row.student.lastName}</p><p className="text-sm">{row.student.id || "Missing ID"}</p></td><td className="p-2 text-xs font-semibold">{row.status}</td><td className="p-2">{details(row)}</td></tr>)}</tbody></table></div>
    <div className="space-y-3 md:hidden">{visible.map(row => <article key={row.csvRow} className="rounded-lg border p-3 space-y-2"><p className="text-xs font-semibold">CSV row {row.csvRow} • {row.status}</p><p className="font-medium break-words">{row.student.firstName} {row.student.lastName}</p><p className="text-sm break-all">{row.student.id || "Missing ID"}</p>{details(row)}</article>)}</div>
    {visible.length === 0 && <p>No matching rows.</p>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</Button><p className="text-sm">Page {currentPage + 1} of {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}</p><Button variant="outline" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next page</Button></div>
  </section>;
}

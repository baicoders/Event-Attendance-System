"use client";

import Link from "next/link";
import { Button } from "@/globals/components/shad-cn/button";
import type { ImportCounts } from "../import/contract";

export default function ImportResult({ result, fileName, onAnother }: { result: { counts: ImportCounts; committedAt: string } | null; fileName: string; onAnother: () => void }) {
  return <section role="status" aria-label={result ? "Import complete" : "Outcome unknown"} className="rounded-xl border p-5 space-y-4">
    <h2 className="text-xl font-semibold">{result ? "Import complete" : "Outcome unknown"}</h2><p className="break-all font-medium">{fileName}</p>
    {result ? <><p>Imported {new Date(result.committedAt).toLocaleString()}.</p><dl className="grid grid-cols-2 gap-3">{[["Created", result.counts.create], ["Updated", result.counts.update], ["Unchanged", result.counts.unchanged], ["Reviewed", result.counts.total]].map(([label, count]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{Number(count).toLocaleString()}</dd></div>)}</dl><p className="text-sm">Students absent from the file were untouched.</p></> : <div className="space-y-2 text-sm"><p>The import was sent, but its outcome could not be confirmed. The server may already have committed it.</p><p>Do not blindly resubmit this import or a different version of the file. Review the current roster before deciding what to do next.</p><p>The submitted file is retained in this tab while you investigate. There is no automatic retry.</p></div>}
    <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/students/student-list?category=ALL">{result ? "View students" : "Review current roster"}</Link></Button><Button onClick={onAnother}>{result ? "Import another file" : "Replace file after checking roster"}</Button></div>
  </section>;
}

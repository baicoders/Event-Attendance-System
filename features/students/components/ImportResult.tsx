"use client";

import Link from "next/link";
import { Button } from "@/globals/components/shad-cn/button";
import type { ReceiptCommitResponse } from "../import/receiptContract";

export type ConfirmedImportResult = ReceiptCommitResponse & { checked: boolean };

type Props = {
  result: ConfirmedImportResult | null;
  fileName: string;
  commandId: string | null;
  busy: boolean;
  onCheck: () => void;
  onRetry: () => void;
  onAnother: () => void;
};

export default function ImportResult({ result, fileName, commandId, busy, onCheck, onRetry, onAnother }: Props) {
  const receipt = result?.receipt;
  const resolved = result?.replayed || result?.checked;
  const title = receipt ? (resolved ? "Import confirmed" : "Import complete") : "Outcome unknown";
  return <section role="status" aria-label={title} className="rounded-xl border p-5 space-y-4">
    <h2 className="text-xl font-semibold">{title}</h2><p className="break-all font-medium">{receipt?.fileName ?? fileName}</p>
    {receipt ? <>
      <p className="break-words">Imported {new Date(receipt.committedAt).toLocaleString()} by {receipt.actorNameSnapshot}.</p>
      {result?.replayed && <p className="text-sm">This is the original result for this import. No roster changes were applied again.</p>}
      {result?.checked && !result.replayed && <p className="text-sm">The receipt confirms this import committed. Checking the result did not change the roster.</p>}
      <dl className="grid grid-cols-2 gap-3">{[["Created", receipt.counts.create], ["Updated", receipt.counts.update], ["Unchanged", receipt.counts.unchanged], ["Reviewed", receipt.counts.total]].map(([label, count]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{Number(count).toLocaleString()}</dd></div>)}</dl>
      <p className="text-sm">Students absent from the file were untouched. This receipt records the import at that time; current student values may differ.</p>
    </> : <div className="space-y-2 text-sm">
      <p>The import was sent, but its outcome could not be confirmed. The server may already have committed it.</p>
      <p>Check the result, or explicitly retry the same reviewed command. A retry keeps the original reference, file, and review; a committed command returns its receipt without applying roster changes again.</p>
      <p>The exact submitted command stays in this tab while you investigate. There is no automatic retry. Replacing the file or leaving this page clears that local resolution context.</p>
    </div>}
    <p className="break-all text-sm">Import reference: <span className="font-mono">{receipt?.commandId ?? commandId}</span></p>
    <div className="flex flex-wrap gap-2">
      {receipt ? <Button asChild variant="outline"><Link href={`/students/import/receipts/${encodeURIComponent(receipt.id)}`}>View receipt</Link></Button> : <><Button disabled={busy || !commandId} onClick={onCheck}>Check result</Button><Button variant="outline" disabled={busy || !commandId} onClick={onRetry}>Retry same reviewed import</Button></>}
      <Button asChild variant="outline"><Link href="/students/student-list?category=ALL">{receipt ? "View students" : "Review current roster"}</Link></Button>
      <Button disabled={busy} onClick={onAnother}>{receipt ? "Import another file" : "Replace file after checking roster"}</Button>
    </div>
  </section>;
}

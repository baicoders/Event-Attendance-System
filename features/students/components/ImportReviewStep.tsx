"use client";

import Link from "next/link";
import { Button } from "@/globals/components/shad-cn/button";
import type { GroupCategory } from "@/globals/schemas/groupSchema";
import ImportReviewTable from "./ImportReviewTable";
import type { ImportPreview } from "../import/contract";


type Props = {
  preview: ImportPreview;
  busy: boolean;
  expired: boolean;
  onCreateGroup: (defaults: { slug: string; category: GroupCategory }) => void;
  onReview: () => void;
  onConfirm: () => void;
  onReplace: () => void;
};

export default function ImportReviewStep({ preview, busy, expired, onCreateGroup, onReview, onConfirm, onReplace }: Props) {
  const { counts } = preview;
  return <section aria-label="Import review" className="space-y-6">
    <div className="space-y-2"><h2 className="text-xl font-semibold">Import review</h2><p className="text-sm text-muted-foreground">Prepared {new Date(preview.preparedAt).toLocaleString()} • Review expires {new Date(preview.expiresAt).toLocaleTimeString()}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["CREATE", counts.create], ["UPDATE", counts.update], ["UNCHANGED", counts.unchanged], ["BLOCKED", counts.blocked]].map(([label, count]) => <div key={label} className="rounded-lg border p-3"><p className="text-xl font-semibold">{Number(count).toLocaleString()}</p><p className="text-xs">{label}</p></div>)}</div></div>
    {preview.unknownGroups.length > 0 && <section aria-label="Unrecognized groups" className="rounded-xl border border-amber-300 p-4 space-y-3"><h3 className="font-semibold">{preview.unknownGroups.length} unrecognized groups</h3><p className="text-sm">Create a Group deliberately, or fix the CSV and replace the file. Groups created here remain even if you abandon this import.</p>{preview.unknownGroups.map(group => <div key={`${group.category}:${group.slug}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="text-xs font-semibold">{group.category}</p><p className="break-all font-mono text-sm">{group.slug}</p><p className="text-sm">Referenced by {group.referenceCount.toLocaleString()} CSV rows</p></div><Button variant="outline" disabled={busy} aria-label={`Create group ${group.slug}`} onClick={() => onCreateGroup({ slug: group.slug, category: group.category as GroupCategory })}>Create group</Button></div>)}<Link href="/settings#groups" className="block text-sm underline">Manage all groups in Settings</Link></section>}
    <ImportReviewTable rows={preview.rows} />
    {counts.blocked > 0 ? <div className="rounded-lg bg-amber-50 p-4 text-sm"><p className="font-semibold">Resolve blocked rows before importing.</p><p>Student cells stay owned by the CSV. Fix names, IDs, levels, and assignments in the source file, then replace it.</p></div> : <div className="rounded-lg border p-4 space-y-2"><h3 className="font-semibold">Ready to import</h3><p className="text-sm">{counts.total.toLocaleString()} rows reviewed: {counts.create.toLocaleString()} will be created, {counts.update.toLocaleString()} updated, and {counts.unchanged.toLocaleString()} are already current.</p><p className="text-sm">Students not present in this CSV will NOT be changed. Changing group membership may affect event eligibility and reports derived from the current roster.</p></div>}
    {expired && <p role="alert" className="text-sm text-amber-800">This review has expired. Refresh the review before confirming.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={onReplace}>Replace file</Button><Button variant="outline" disabled={busy} onClick={onReview}>{busy ? "Preparing review…" : "Refresh review"}</Button><Button disabled={busy || expired || counts.blocked > 0 || !preview.previewToken} onClick={onConfirm}>Review &amp; confirm import</Button></div>
  </section>;
}

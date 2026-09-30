"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/globals/components/shad-cn/button";
import { useAuth, type AuthUser } from "@/globals/contexts/AuthContext";
import { ApiError, fetchApi } from "@/globals/utils/api";
import { receiptSchema } from "../import/receiptContract";
import StudentImportReceiptRows from "./StudentImportReceiptRows";

function AuthorizedReceipt({ actor, receiptId }: { actor: AuthUser; receiptId: string }) {
  const { refresh } = useAuth();
  const detail = useQuery({
    queryKey: ["student-imports", "receipt", actor.id, actor.credentialVersion ?? 0, receiptId],
    queryFn: async () => {
      try {
        const receipt = receiptSchema.parse(await fetchApi<unknown>(`/api/students/imports/${encodeURIComponent(receiptId)}`, { cache: "no-store" }));
        if (receipt.id !== receiptId) throw new Error("Receipt identity did not match the request.");
        return receipt;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) void refresh();
        throw error;
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (detail.isPending) return <p role="status">Loading import receipt…</p>;
  if (detail.isError) return <div className="space-y-3"><p role="alert">{detail.error instanceof ApiError && detail.error.status === 404 ? "Import receipt not found." : "Unable to load this import receipt."}</p><Button variant="outline" disabled={detail.isFetching} onClick={() => void detail.refetch()}>Retry receipt</Button><Link className="block text-sm underline" href="/students/import">Back to imports</Link></div>;
  const receipt = detail.data;
  return <article aria-label="Import receipt" className="space-y-6">
    <div className="space-y-2"><h1 className="text-3xl font-bold">Import receipt</h1><p className="break-all text-lg font-semibold">{receipt.fileName}</p><p className="break-words text-sm">Imported {new Date(receipt.committedAt).toLocaleString()} by {receipt.actorNameSnapshot}.</p><p className="break-all text-sm">Import reference: <span className="font-mono">{receipt.commandId}</span></p><p className="break-all text-sm">Receipt ID: <span className="font-mono">{receipt.id}</span></p><p className="break-all text-sm">Source SHA-256: <span className="font-mono">{receipt.sourceFileHash}</span></p></div>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Historical evidence</p><p>This receipt records what the import did at that time. Current student fields and group membership may differ. Students absent from this file were untouched. Any Groups created during review were separate configuration changes before the import.</p></div>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Reviewed", receipt.counts.total], ["Created", receipt.counts.create], ["Updated", receipt.counts.update], ["Unchanged", receipt.counts.unchanged]].map(([label, count]) => <div key={label} className="rounded-lg border p-3"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{Number(count).toLocaleString()}</dd></div>)}</dl>
    <StudentImportReceiptRows rows={receipt.result.rows} />
    <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/students/import">Back to imports</Link></Button><Button asChild variant="outline"><Link href="/students/student-list?category=ALL">View current roster</Link></Button></div>
  </article>;
}

export default function StudentImportReceipt({ receiptId }: { receiptId: string }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p role="status">Checking receipt access…</p>;
  if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE" || user.mustChangePassword) return <p role="alert">A usable administrator account is required to view import receipts.</p>;
  return <AuthorizedReceipt key={`${user.id}:${user.credentialVersion ?? 0}:${receiptId}`} actor={user} receiptId={receiptId} />;
}

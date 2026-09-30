"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/globals/components/shad-cn/button";
import { useAuth, type AuthUser } from "@/globals/contexts/AuthContext";
import { ApiError, fetchApi } from "@/globals/utils/api";
import { receiptHistorySchema } from "../import/receiptContract";

function AuthorizedHistory({ actor }: { actor: AuthUser }) {
  const { refresh } = useAuth();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const history = useQuery({
    queryKey: ["student-imports", "history", actor.id, actor.credentialVersion ?? 0, cursor],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("before", cursor);
      try {
        return receiptHistorySchema.parse(await fetchApi<unknown>(`/api/students/imports?${params}`, { cache: "no-store" }));
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) void refresh();
        throw error;
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  return <section aria-label="Recent imports" className="rounded-xl border bg-card p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Recent imports</h2><p className="text-sm text-muted-foreground">Immutable receipts for confirmed imports. Earlier imports have no fabricated receipts.</p></div><Button variant="outline" disabled={history.isFetching} onClick={() => { if (cursor) setCursors([null]); else void history.refetch(); }}>Refresh imports</Button></div>
    {history.isPending ? <p role="status">Loading import history…</p> : history.isError ? <p role="alert">Unable to load import history. Retry with Refresh imports.</p> : <>
      {history.data.items.length === 0 ? <p>No import receipts yet.</p> : <ul className="space-y-3">{history.data.items.map(item => <li key={item.id} className="rounded-lg border p-4 space-y-2"><p className="font-semibold break-all">{item.fileName}</p><p className="break-words text-sm">{new Date(item.committedAt).toLocaleString()} • {item.actorNameSnapshot}</p><p className="text-sm">{item.counts.create.toLocaleString()} created • {item.counts.update.toLocaleString()} updated • {item.counts.unchanged.toLocaleString()} unchanged</p><Link className="inline-block text-sm underline" href={`/students/import/receipts/${encodeURIComponent(item.id)}`} aria-label={`View receipt for ${item.fileName}`}>View receipt</Link></li>)}</ul>}
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={history.isFetching || cursors.length === 1} onClick={() => setCursors(previous => previous.slice(0, -1))}>Newer imports</Button><p className="text-sm">Page {cursors.length}</p><Button variant="outline" disabled={history.isFetching || !history.data.nextCursor} onClick={() => { if (history.data.nextCursor) setCursors(previous => [...previous, history.data.nextCursor]); }}>Older imports</Button></div>
    </>}
  </section>;
}

export default function StudentImportHistory() {
  const { user, isLoading } = useAuth();
  if (isLoading || !user || user.role !== "ADMIN" || user.status !== "ACTIVE" || user.mustChangePassword) return null;
  return <AuthorizedHistory key={`${user.id}:${user.credentialVersion ?? 0}`} actor={user} />;
}

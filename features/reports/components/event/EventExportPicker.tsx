"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/globals/components/shad-cn/button";
import { useAuth } from "@/globals/contexts/AuthContext";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/globals/components/shad-cn/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/globals/components/shad-cn/select";
import { fetchApi } from "@/globals/utils/api";
import { serializeCsv } from "@/globals/utils/csvExport";
import { formatReportDateTime } from "@/globals/utils/reportTime";
import { GROUP_DIMENSIONS, type GroupDimension } from "@/globals/utils/reportGroups";
import { eventExportSchema, type EventExport, type ExportPreset } from "@/features/reports/utils/eventExport";

type Choice = ExportPreset | "summary";
const choices: { value: Choice; title: string; description: string }[] = [
  { value: "full", title: "Full attendance CSV", description: "Every currently eligible student" },
  { value: "absent", title: "Absent students CSV", description: "Derived absent outcome as of preparation" },
  { value: "late", title: "Late arrivals CSV", description: "After the event grace period" },
  { value: "times", title: "Time records CSV", description: "Current records, including review flags" },
  { value: "groups", title: "Group summary CSV", description: "Non-overlapping group totals" },
  { value: "summary", title: "Printable event summary", description: "Opens the browser print view" },
];

export default function EventExportPicker({ eventId, initialOpen = false }: { eventId: string; initialOpen?: boolean }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [open, setOpen] = useState(initialOpen);
  const [preset, setPreset] = useState<Choice>("full");
  const [groupBy, setGroupBy] = useState<GroupDimension>("SECTION");
  const [prepared, setPrepared] = useState<EventExport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const readyGeneration = useRef<number | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      generation.current += 1;
      readyGeneration.current = null;
      setPrepared(null);
      setOpen(false);
    }
  }, [isAuthLoading, user]);

  useEffect(() => {
    if (!open || preset === "summary") return;
    const token = ++generation.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    const load = async () => {
      setPrepared(null);
      readyGeneration.current = null;
      setPending(true);
      setError(null);
      try {
        const query = new URLSearchParams({ preset });
        if (preset === "groups") query.set("groupBy", groupBy);
        const data = await fetchApi<unknown>(`/api/reports/events/${encodeURIComponent(eventId)}/export?${query}`, { signal: controller.signal, cache: "no-store" });
        const parsed = eventExportSchema.safeParse(data);
        if (!parsed.success || parsed.data.event.id !== eventId || parsed.data.preset !== preset || parsed.data.groupBy !== (preset === "groups" ? groupBy : null)) {
          throw new Error("The server returned an unexpected export result.");
        }
        if (generation.current === token) { readyGeneration.current = token; setPrepared(parsed.data); }
      } catch (cause) {
        if (generation.current === token) setError(controller.signal.aborted ? "Preparation timed out. Try again." : cause instanceof Error ? cause.message : "Export failed.");
      } finally {
        window.clearTimeout(timeout);
        if (generation.current === token) setPending(false);
      }
    };
    void load();
    return () => { generation.current += 1; readyGeneration.current = null; controller.abort(); window.clearTimeout(timeout); };
  }, [open, eventId, preset, groupBy, refresh]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) { generation.current += 1; readyGeneration.current = null; setPrepared(null); setError(null); }
  };

  const refreshData = () => {
    generation.current += 1;
    readyGeneration.current = null;
    setPrepared(null);
    setPending(true);
    setError(null);
    setRefresh((value) => value + 1);
  };

  const download = () => {
    if (!prepared || pending || readyGeneration.current !== generation.current || prepared.event.id !== eventId || prepared.preset !== preset || prepared.groupBy !== (preset === "groups" ? groupBy : null)) return;
    try {
      const csv = serializeCsv(prepared.columns.map((column) => column.label), prepared.rows);
      if (new TextEncoder().encode(csv).byteLength > 10 * 1024 * 1024) throw new Error("CSV exceeds the 10 MiB export limit.");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${prepared.filenameBase}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Download failed."); }
  };

  return <>
    <Button onClick={() => changeOpen(true)}>Export</Button>
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent className="h-svh w-full min-w-0 gap-0 overflow-hidden border-l-slate-200 bg-white p-0 sm:max-w-3xl">
        <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/50 p-5 pr-12">
          <SheetTitle>Export event data</SheetTitle>
          <SheetDescription>Current roster and attendance at preparation time. Report-page filters, search, and pagination are not applied.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold text-slate-900">Preset</legend>
            {choices.map((choice) => <label key={choice.value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${preset === choice.value ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"}`}>
              <input type="radio" name="export-preset" value={choice.value} checked={preset === choice.value} onChange={() => { readyGeneration.current = null; setPreset(choice.value); setPrepared(null); }} className="mt-1 accent-indigo-600" />
              <span><strong className="block text-slate-900">{choice.title}</strong><span className="text-slate-500">{choice.description}</span></span>
            </label>)}
          </fieldset>
          {(preset === "groups" || preset === "summary") ? <div className="space-y-1"><label className="text-sm font-semibold" htmlFor="export-group">Group by</label>
            <Select value={groupBy} onValueChange={(value) => { readyGeneration.current = null; setGroupBy(value as GroupDimension); setPrepared(null); }}><SelectTrigger id="export-group" className="w-52"><SelectValue /></SelectTrigger><SelectContent>{GROUP_DIMENSIONS.map((dimension) => <SelectItem key={dimension} value={dimension}>{dimension}</SelectItem>)}</SelectContent></Select></div> : null}
          {preset === "summary" ? <p className="text-sm text-slate-600">Opening the print view prepares a new evaluation. Its time and totals may differ from a CSV prepared here.</p> : <>
            {pending ? <p role="status" className="text-sm text-slate-600">Preparing full event data…</p> : null}
            {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            {prepared ? <>
              {prepared.provisional ? <p className="text-sm font-bold text-amber-800">PROVISIONAL — EVENT NOT APPROVED</p> : null}
              <p className="text-sm text-slate-700">{prepared.event.title} · {prepared.event.status} · {prepared.rowCount} rows · Whole event</p>
              <p className="text-xs text-slate-500">Prepared {formatReportDateTime(prepared.evaluatedAt)} Asia/Manila (UTC+08:00). Data can change after preparation.</p>
              {prepared.rowCount === 0 ? <p className="text-sm text-slate-600">No {preset === "late" ? "late arrivals" : preset === "absent" ? "absent students" : "rows"} in this prepared result. The CSV will contain headers only.</p> : null}
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200"><table className="min-w-max text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr>{prepared.columns.map((column) => <th key={column.key} className="border-b px-2 py-2 font-semibold">{column.label}</th>)}</tr></thead><tbody>{prepared.rows.slice(0, 10).map((row, index) => <tr key={index}>{prepared.columns.map((column) => <td key={column.key} className="border-b px-2 py-1">{String(row[column.key] ?? "")}</td>)}</tr>)}</tbody></table></div>
              {prepared.rowCount > 10 ? <p className="text-xs text-slate-500">Preview shows 10 rows; download includes all {prepared.rowCount} rows.</p> : null}
              <p className="text-xs text-slate-500">When opening the CSV in a spreadsheet, import Student ID as text to preserve leading zeros.</p>
            </> : null}
          </>}
        </div>
        <SheetFooter className="shrink-0 flex-row flex-wrap justify-end border-t border-slate-200 bg-white">
          <Button variant="outline" onClick={() => changeOpen(false)}>Cancel</Button>
          {preset === "summary" ? <Button asChild><a href={`/reports/events/${encodeURIComponent(eventId)}/print?view=summary&groupBy=${groupBy}`} target="_blank" rel="noopener noreferrer">Open print preview</a></Button> : <>
            <Button variant="outline" onClick={refreshData} disabled={pending}>Refresh data</Button>
            <Button onClick={download} disabled={pending || !prepared || !!error}>Download CSV{prepared ? ` — ${prepared.rowCount} rows` : ""}</Button>
          </>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </>;
}

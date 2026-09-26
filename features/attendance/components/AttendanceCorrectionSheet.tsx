"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/globals/components/shad-cn/sheet";
import { Button } from "@/globals/components/shad-cn/button";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { ApiError, fetchApi } from "@/globals/utils/api";
import { useAttendanceCorrection, useAttendanceHistory } from "../hooks/useAttendanceCorrections";
import type { CorrectionCommand, HistoryChange, HistoryPage } from "../types/corrections";
import { resolveEditedInstant, toManilaInput } from "../utils/correctionTime";

type Action = "HISTORY" | "CORRECT" | "VOID" | "RESTORE";
const ZONE = "Asia/Manila (UTC+08:00)";
const displayTime = (value: string | null) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "medium" }) : "None";

export function AttendanceCorrectionSheet({ eventId, studentId, initialAction, onClose }: {
  eventId: string; studentId: string | null; initialAction: Action; onClose: () => void;
}) {
  const history = useAttendanceHistory(eventId, studentId);
  const correction = useAttendanceCorrection(eventId);
  const confirm = useConfirm();
  const [action, setAction] = useState<Action>(initialAction);
  const [timein, setTimein] = useState("");
  const [timeout, setTimeoutValue] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [unknownCommand, setUnknownCommand] = useState<CorrectionCommand | null>(null);
  const [older, setOlder] = useState<HistoryChange[]>([]);
  const [nextBeforeId, setNextBeforeId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const initializedFor = useRef<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    setAction(initialAction); setReason(""); setMessage(""); setUnknownCommand(null); setOlder([]);
    initializedFor.current = null;
  }, [studentId, initialAction]);
  useEffect(() => {
    if (!history.data || history.data.studentId !== studentId || initializedFor.current === studentId) return;
    setTimein(toManilaInput(history.data.record?.timein ?? null));
    setTimeoutValue(toManilaInput(history.data.record?.timeout ?? null));
    setNextBeforeId(history.data.nextBeforeId);
    initializedFor.current = studentId;
  }, [history.data, studentId]);

  const record = history.data?.record;
  const latest = history.data?.changes[0];
  const proposedIn = resolveEditedInstant(timein, record?.timein ?? null);
  const proposedOut = resolveEditedInstant(timeout, record?.timeout ?? null);
  const outsideSchedule = !!history.data && [proposedIn, proposedOut].some((value) => value &&
    (value < history.data!.eventStart || value > history.data!.eventEnd));
  const setField = (field: "timein" | "timeout" | "reason", value: string) => {
    setMessage("");
    if (field === "timein") setTimein(value);
    else if (field === "timeout") setTimeoutValue(value);
    else setReason(value);
  };

  const send = async (command: CorrectionCommand) => {
    try {
      const receipt = await correction.mutateAsync(command);
      setUnknownCommand(null);
      setMessage(receipt.replayed ? "This command was already saved. Current evidence has been refreshed." : "Attendance change saved.");
      setAction("HISTORY");
      setReason("");
      setOlder([]);
      const fresh = await history.refetch();
      if (fresh.data) {
        setTimein(toManilaInput(fresh.data.record?.timein ?? null));
        setTimeoutValue(toManilaInput(fresh.data.record?.timeout ?? null));
      }
      setNextBeforeId(fresh.data?.nextBeforeId ?? null);
    } catch (error) {
      if (error instanceof ApiError) {
        setUnknownCommand(null);
        if (error.status === 409) {
          setMessage("Attendance changed on another device. Your proposed values remain below; review the latest evidence before trying again.");
          const fresh = await history.refetch();
          setNextBeforeId(fresh.data?.nextBeforeId ?? null);
        } else setMessage(error.message);
      } else {
        setUnknownCommand(command);
        setMessage("Outcome unknown. Retry this exact command to learn whether it saved. Keep this page open if you want to retry.");
      }
    }
  };

  const submit = async () => {
    if (!studentId || submitting.current) return;
    if (unknownCommand) { setMessage("Retry the unresolved command before making another change."); return; }
    if (reason.trim().length < 5 || reason.trim().length > 1000) { setMessage("Enter a reason of 5 to 1,000 characters."); return; }
    let command: CorrectionCommand;
    if (action === "CORRECT") {
      if (!record) return;
      const inInstant = resolveEditedInstant(timein, record.timein);
      const outInstant = resolveEditedInstant(timeout, record.timeout);
      if ((!inInstant && !outInstant) || (timein && !inInstant) || (timeout && !outInstant)) { setMessage("Enter at least one valid attendance time in Manila time."); return; }
      command = { commandId: crypto.randomUUID(), action, studentId, recordId: record.id, expectedRevision: record.revision,
        timein: inInstant, timeout: outInstant, reason: reason.trim() };
    } else if (action === "VOID") {
      if (!record) return;
      command = { commandId: crypto.randomUUID(), action, studentId, recordId: record.id, expectedRevision: record.revision, reason: reason.trim() };
    } else if (action === "RESTORE") {
      if (record || latest?.action !== "VOID") return;
      command = { commandId: crypto.randomUUID(), action, studentId, sourceChangeId: latest.id, reason: reason.trim() };
    } else return;
    submitting.current = true;
    const accepted = await confirm({ title: `${action[0]}${action.slice(1).toLowerCase()} attendance?`,
      description: `This changes the official current evidence for ${history.data?.studentLabel ?? studentId}. The previous values will remain in history.` });
    try { if (accepted) await send(command); }
    finally { submitting.current = false; }
  };

  const loadOlder = async () => {
    if (!studentId || !nextBeforeId || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchApi<HistoryPage>(`/api/events/${encodeURIComponent(eventId)}/attendance-history?studentId=${encodeURIComponent(studentId)}&beforeId=${nextBeforeId}`);
      setOlder((current) => [...current, ...page.changes]);
      setNextBeforeId(page.nextBeforeId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load older history."); }
    finally { setLoadingOlder(false); }
  };

  return <Sheet open={!!studentId} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="flex w-full max-w-none flex-col p-0 [&_button]:min-h-10 sm:w-[min(680px,95vw)] sm:max-w-none">
      <SheetHeader className="border-b p-5 text-left">
        <SheetTitle>Review attendance — {history.data?.studentLabel ?? studentId}</SheetTitle>
        <SheetDescription>{history.data?.eventTitle ?? "Loading event"} · Student {studentId} · Times shown in {ZONE}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {history.isLoading && <p role="status">Loading attendance evidence…</p>}
        {history.isError && <p role="alert">Could not load attendance evidence. <Button variant="outline" onClick={() => void history.refetch()}>Retry</Button></p>}
        {history.data && <>
          {!history.data.inCurrentAudience && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">This student is outside the event’s current audience. Existing evidence may still be corrected or voided; restoration requires current eligibility.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!unknownCommand} variant={action === "HISTORY" ? "default" : "outline"} onClick={() => setAction("HISTORY")}>History</Button>
            {record && <Button disabled={!!unknownCommand} variant={action === "CORRECT" ? "default" : "outline"} onClick={() => setAction("CORRECT")}>Correct</Button>}
            {record && <Button disabled={!!unknownCommand} variant={action === "VOID" ? "default" : "outline"} onClick={() => setAction("VOID")}>Void</Button>}
            {!record && latest?.action === "VOID" && <Button disabled={!!unknownCommand} variant={action === "RESTORE" ? "default" : "outline"} onClick={() => setAction("RESTORE")}>Restore</Button>}
          </div>
          {message && <p role="alert" className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">{message}</p>}
          {action === "HISTORY" && <section aria-label="Attendance change history" className="space-y-3">
            <p className="text-sm">{record ? `Current: ${displayTime(record.timein)} in · ${displayTime(record.timeout)} out · ${record.method}` : latest?.action === "VOID" ? "Voided attendance · no current record." : "No attendance evidence exists for this pair."}</p>
            {[...history.data.changes, ...older].map((change) => <article key={change.id} className="rounded-lg border p-3 text-sm">
              <p className="font-semibold">{change.action} · {displayTime(change.createdAt)} · {change.actorName ?? "Unknown actor"}</p>
              {change.reason && <p className="mt-1 whitespace-pre-wrap">Reason: {change.reason}</p>}
              <p className="mt-1">In: {displayTime(change.before?.timein ?? null)} → {displayTime(change.after?.timein ?? null)}</p>
              <p>Out: {displayTime(change.before?.timeout ?? null)} → {displayTime(change.after?.timeout ?? null)}</p>
            </article>)}
            {nextBeforeId && <Button variant="outline" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : "Load earlier changes"}</Button>}
            <p className="text-xs text-slate-500">Earlier history, if any, was not recorded before history tracking began.</p>
          </section>}
          {action !== "HISTORY" && <div className="space-y-4">
            {record && <p className="text-sm">Original method: {record.method}. Current revision: {record.revision}.</p>}
            {action === "CORRECT" && <div className="grid gap-4 sm:grid-cols-2">
              <div className="text-sm"><p className="font-medium">Current</p><p>Time in: {displayTime(record?.timein ?? null)}</p><p>Time out: {displayTime(record?.timeout ?? null)}</p></div>
              <div className="space-y-3"><p className="text-sm font-medium">Proposed ({ZONE})</p>
                <label className="block text-sm">Time in<input disabled={!!unknownCommand} className="mt-1 w-full rounded-md border p-2" type="datetime-local" step="1" value={timein} onChange={(event) => setField("timein", event.target.value)} /></label>
                <label className="block text-sm">Time out<input disabled={!!unknownCommand} className="mt-1 w-full rounded-md border p-2" type="datetime-local" step="1" value={timeout} onChange={(event) => setField("timeout", event.target.value)} /></label>
                <Button disabled={!!unknownCommand} type="button" variant="outline" onClick={() => setField("timein", "")}>Clear time-in</Button>
                <Button disabled={!!unknownCommand} type="button" variant="outline" onClick={() => setField("timeout", "")}>Clear accidental time-out</Button>
              </div>
            </div>}
            {action === "CORRECT" && <p className="text-sm">Proposed result: {timein ? (timeout ? "Present · time-out recorded" : "Present · no time-out recorded") : timeout ? "No time-in · time-out recorded" : "At least one time required"}.</p>}
            {action === "CORRECT" && outsideSchedule && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">A proposed time is outside the event schedule. Review it before saving.</p>}
            {action === "VOID" && <p className="text-sm">Voiding removes current evidence. The before image and reason remain in history. A later scan can create new attendance.</p>}
            {action === "RESTORE" && <p className="text-sm">Restoration creates a new record from the latest void, if no newer evidence exists and the student is currently eligible.</p>}
            <label className="block text-sm font-medium">Reason<textarea disabled={!!unknownCommand} className="mt-1 min-h-24 w-full rounded-md border p-2 font-normal" maxLength={1000} value={reason} onChange={(event) => setField("reason", event.target.value)} placeholder="Explain the attendance correction without sensitive personal details" /></label>
            <p className="text-xs text-slate-500">Another device may have changed this evidence. Saving requires a final confirmation.</p>
          </div>}
        </>}
      </div>
      {history.data && action !== "HISTORY" && <div className="flex flex-wrap gap-2 border-t bg-white p-4">
        <Button disabled={correction.isPending || !!unknownCommand} onClick={() => void submit()}>{correction.isPending ? "Saving…" : `Review and ${action.toLowerCase()}`}</Button>
        {unknownCommand && <Button variant="outline" disabled={correction.isPending} onClick={() => void send(unknownCommand)}>Retry exact command</Button>}
      </div>}
    </SheetContent>
  </Sheet>;
}

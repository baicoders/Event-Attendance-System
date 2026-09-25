"use client";

import Link from "next/link";
import { ApiError } from "@/globals/utils/api";
import { useEventReadiness } from "@/globals/hooks/useEventReadiness";
import type { ReadinessCheck } from "@/globals/types/eventReadiness";

const labels: Record<ReadinessCheck["id"], string> = {
  approval: "Approval", audience: "Audience", roster: "Eligible students",
  schedule: "Schedule", owner: "Owner", recordingMode: "Recording mode",
};
const symbols: Record<ReadinessCheck["state"], string> = {
  PASS: "✓", WARNING: "!", INFO: "i", BLOCKED: "×",
};

export default function EventReadinessPanel({
  eventId, dirty = false,
}: { eventId: string; dirty?: boolean }) {
  const { data, error, isPending, isFetching, refetch } = useEventReadiness(eventId);
  const restricted = error instanceof ApiError && [401, 403, 404].includes(error.status);
  const visible = restricted ? null : data;
  const title = (error || isFetching) && visible ? "Previous event check"
    : dirty ? "Last saved event checks"
    : visible?.summary === "CHECKS_PASSED" ? "Event checks passed"
    : visible?.summary === "ATTENTION" ? "Event needs attention"
      : visible?.summary === "NOT_APPROVED" ? "Event not approved" : "Event checks";

  return (
    <section aria-label="Event readiness" className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <button type="button" onClick={() => void refetch()} disabled={isFetching}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium disabled:opacity-50">
          {isFetching ? "Checking…" : "Check again"}
        </button>
      </div>
      {dirty && <p className="mt-2 rounded-md bg-amber-100 p-2 font-medium text-amber-900">
        Last saved event — changes below are not included.
      </p>}
      {isPending && !error && <p className="mt-2">Checking saved event and current roster…</p>}
      {error && <p role="alert" className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-rose-800">
        {restricted ? "Event checks are unavailable. Your access may have changed." :
          visible ? "Previous check; couldn’t refresh. Check again to get the current roster." :
            "Couldn’t check this event. Check again to retry."}
      </p>}
      {visible && <>
        {isFetching && <p role="status" className="mt-2 text-amber-900">
          Previous check — checking the saved event and current roster now.
        </p>}
        <p className="mt-2 text-xs text-slate-600">
          Checked {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(visible.evaluatedAt))} · {error || isFetching ? "Previous roster check" : "Current roster"} · Last saved event
        </p>
        <ul className="mt-3 space-y-2">
          {visible.checks.map((check) => <li key={check.id} className="flex min-w-0 gap-2 rounded-md bg-white p-2">
            <span aria-hidden="true" className={check.state === "PASS" ? "text-emerald-700" : check.state === "INFO" ? "text-blue-700" : "text-amber-800"}>{symbols[check.state]}</span>
            <span className="min-w-0 break-words"><strong>{labels[check.id]}:</strong> {check.detail}</span>
          </li>)}
        </ul>
        {visible.recordingAllowed && <Link href={`/attendance?eventId=${encodeURIComponent(eventId)}`}
          className="mt-3 inline-block font-medium text-blue-700 underline">Open attendance</Link>}
      </>}
      <p className="mt-3 text-xs text-slate-600">Device checks are separate. Opening the camera tests this device.</p>
    </section>
  );
}

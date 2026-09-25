"use client";

import type { ReactElement } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/globals/components/shad-cn/dialog";
import EventReadinessPanel from "./EventReadinessPanel";

/** Mounts the server-backed checklist only while its dialog is open. */
export default function EventReadinessDialog({
  eventId,
  dirty = false,
  children,
}: {
  eventId: string;
  dirty?: boolean;
  children: ReactElement;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[85vh] overflow-y-auto p-3 sm:max-w-2xl sm:p-5">
        <DialogHeader className="sticky top-0 z-10 flex-row items-start justify-between gap-3 rounded-md bg-white pb-2 text-left">
          <div>
            <DialogTitle>Event checks</DialogTitle>
            <DialogDescription className="mt-1">
              Saved event and current roster.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button type="button" className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              Close
            </button>
          </DialogClose>
        </DialogHeader>
        <EventReadinessPanel eventId={eventId} dirty={dirty} />
      </DialogContent>
    </Dialog>
  );
}

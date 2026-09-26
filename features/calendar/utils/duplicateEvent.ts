import type { Event, EventForm } from "../../../globals/types/events";
import { ApiError } from "../../../globals/utils/api";

export type DuplicateDefaults = Pick<
  EventForm,
  "title" | "location" | "category" | "includedGroups" | "description" | "allDay"
>;

/** Keep this allowlist explicit: source identity, review and scan state are never reusable. */
export function copyEventDefaults(source: Event): DuplicateDefaults {
  const category = source.category;
  return {
    title: source.title,
    location: source.location,
    category,
    includedGroups: ["ALL", "COLLEGE", "SHS"].includes(category)
      ? []
      : source.includedGroups.map((group) => group.id),
    description: source.description,
    allDay: source.allDay,
  };
}

export function makeDuplicatePayload(
  values: DuplicateDefaults,
  start: Date,
  end: Date,
): EventForm {
  return {
    title: values.title,
    location: values.location,
    category: values.category,
    includedGroups: [...values.includedGroups],
    description: values.description,
    allDay: values.allDay,
    start,
    end,
  };
}

/** Match calendar selection's rule: only a range entirely before now is blocked. */
export function isDuplicateRangeWhollyPast(end: Date, allDay: boolean, now = new Date()): boolean {
  if (allDay) {
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return endDay < today;
  }
  return end < now;
}

/** A create may have committed even when its response never reached the browser. */
export function isUnknownCreateOutcome(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof ApiError && error.message === "Invalid server response");
}

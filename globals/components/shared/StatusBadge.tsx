import type { ReactNode } from "react";

import { cn } from "@/globals/libs/shad-cn";

/**
 * The app's semantic colour tones.
 *
 * Every status-ish colour in the UI should resolve to one of these rather than
 * picking a Tailwind hue ad hoc. `neutral` and `primary` are the two you'll use
 * most; the rest carry meaning and shouldn't be chosen for looks.
 */
export type Tone =
  | "neutral"
  | "primary"
  | "info"
  | "success"
  | "warning"
  | "danger";

/**
 * Tone → badge classes. Soft fill + matching border and text, which is the
 * treatment the Student List's counter chips use.
 */
const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-slate-200 bg-white text-slate-600",
  primary: "border-indigo-200 bg-indigo-50 text-indigo-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
};

/**
 * Tone → solid dot/accent colour, for timeline dots and calendar accent bars
 * where a filled swatch reads better than a soft chip.
 */
export const TONE_ACCENT: Record<Tone, string> = {
  neutral: "bg-slate-400",
  primary: "bg-indigo-500",
  info: "bg-blue-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
};

/**
 * Canonical mapping from an `Event.status` to a tone.
 *
 * This mapping is duplicated in several places today (the Dashboard's
 * `chipClass` map and `features/calendar/components/EventCard.tsx`'s
 * `statusStyles`/`accentStyles`). Those predate this component and still work —
 * but **new code must use this map**, and the existing call sites are tracked
 * for migration rather than left to drift further apart.
 *
 * @see docs/design-system.md — "Known deviations"
 */
export const EVENT_STATUS_TONE = {
  DRAFT: "warning",
  PENDING: "info",
  APPROVED: "success",
  REJECTED: "danger",
} as const satisfies Record<string, Tone>;

/**
 * Canonical mapping from a `User.status` to a tone, for the operator console's
 * user table. Same rule as `EVENT_STATUS_TONE`: resolve the status through this
 * map rather than inlining tones at the call site.
 */
export const USER_STATUS_TONE = {
  PENDING: "info",
  ACTIVE: "success",
  REJECTED: "danger",
} as const satisfies Record<string, Tone>;

type StatusBadgeProps = {
  /** Semantic colour. Pick by meaning, never by preferred hue. */
  tone?: Tone;
  /** Renders a solid leading dot — useful when several badges sit together. */
  withDot?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * StatusBadge
 *
 * The app's standard pill for statuses, counts, and short metadata labels
 * ("Total: 128", "APPROVED", "Search Active").
 *
 * ## Prefer this over
 * - Hand-writing `rounded-full border bg-x-50 text-x-700` chips inline.
 * - shad-cn's `Badge`, which is styled from the neutral shadcn token scale and
 *   does not match the soft-fill treatment used across this app.
 *
 * ## Constraints
 * - Keep the label short — this is a chip, not a sentence. Long text breaks the
 *   toolbar rows it usually lives in.
 * - Choose `tone` by meaning. Don't use `success` because green looks nice; use
 *   it because the thing being described actually succeeded.
 * - For an `Event.status`, resolve the tone through {@link EVENT_STATUS_TONE}
 *   rather than hardcoding one, so all four statuses stay consistent app-wide.
 *
 * @example Counter chips in a table toolbar
 * ```tsx
 * <StatusBadge>Total: {total}</StatusBadge>
 * <StatusBadge tone="primary">Visible: {visible}</StatusBadge>
 * ```
 *
 * @example Event status
 * ```tsx
 * <StatusBadge tone={EVENT_STATUS_TONE[event.status]} withDot>
 *   {event.status}
 * </StatusBadge>
 * ```
 */
const StatusBadge = ({
  tone = "neutral",
  withDot = false,
  children,
  className,
}: StatusBadgeProps) => {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {withDot ? (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", TONE_ACCENT[tone])}
        />
      ) : null}
      {children}
    </span>
  );
};

export default StatusBadge;

export const CLASSROOM_STATUS_TONE={UNMARKED:'neutral',PRESENT:'success',LATE:'warning',ABSENT:'danger',EXCUSED:'info',ACTIVE:'primary',FINALIZED:'success',CANCELED:'neutral'} as const satisfies Record<string,Tone>;

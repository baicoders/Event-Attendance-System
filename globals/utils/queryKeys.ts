type EventScope = "visible" | "mine";
type EventStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";

/**
 * Centralized query key factory.
 *
 * Prevents inconsistent cache keys and makes cache invalidation predictable.
 */
export const queryKeys = {
  audience: {
    all: () => ["audience"] as const,
    count: (scope: string, eventId?: string) => ["audience", "count", scope, eventId ?? "new"] as const,
    roster: (scope: string, search: string, page: number, eventId?: string) =>
      ["audience", "roster", scope, search, page, eventId ?? "new"] as const,
  },
  events: {
    all: () => ["events"] as const,
    list: (scope: EventScope = "visible", status?: EventStatus) =>
      ["events", "list", scope, status ?? "ALL"] as const,
    allApproved: () => ["events", "approved"] as const,
    withId: (eventId: string) => ["events", "byId", eventId] as const,
    statsFromEvent: (eventId: string) => ["events", "stats", eventId] as const,
    progressAll: () => ["events", "progress"] as const,
    progressPrefix: (eventId: string) => ["events", "progress", eventId] as const,
    progress: (eventId: string, viewerId: string, query: string) =>
      ["events", "progress", eventId, viewerId, query] as const,
  },
  students: {
    all: () => ["students"] as const,
    stats: () => ["students", "stats"] as const,
    sections: () => ["students", "sections"] as const,
    withId: (studentId: string) => ["students", "byId", studentId] as const,
    fromEvent: (eventId: string, query = "") =>
      ["students", "fromEvent", eventId, query] as const,
    fromEventWithId: (eventId: string, studentId: string) =>
      ["students", "fromEventWithId", eventId, studentId] as const,
  },
  records: {
    all: () => ["records"] as const,
    withId: (id: string) => ["records", "byId", id] as const,
    fromEvent: (eventId: string, includeAbsent = false, onlyNeedsReview = false) =>
      ["records", "fromEvent", eventId, includeAbsent, onlyNeedsReview] as const,
    // Prefix (omits the includeAbsent flag) so invalidation covers BOTH the
    // present-only live table and the includeAbsent report variants.
    fromEventPrefix: (eventId: string) =>
      ["records", "fromEvent", eventId] as const,
    fromStudent: (studentId: string) =>
      ["records", "fromStudent", studentId] as const,
    fromEventForStudent: (eventId: string, studentId: string) =>
      ["records", "fromEventForStudent", eventId, studentId] as const,
  },
  reports: {
    all: () => ["reports"] as const,
    /** One event's full report (`GET /api/reports/events/[eventId]`). */
    event: (eventId: string) => ["reports", "event", eventId] as const,
    /**
     * Cross-event summary. The range and category are part of the key so each
     * distinct query caches separately; `from`/`to` are ISO date strings
     * (`YYYY-MM-DD`) rather than `Date`s, since a `Date` is a fresh object every
     * render and would never match a cached key.
     */
    overview: (from: string, to: string, category = "ALL_CATEGORIES") =>
      ["reports", "overview", from, to, category] as const,
  },
  groups: {
    // Every group key shares this prefix on purpose: one mutation invalidates
    // the form options, the per-category pickers, and the management table
    // together, so a newly created group is never hidden behind a staleTime.
    all: () => ["groups"] as const,
    options: () => ["groups", "options"] as const,
    byCategory: (category: string) =>
      ["groups", "byCategory", category] as const,
    manage: () => ["groups", "manage"] as const,
  },
  admin: {
    all: () => ["admin"] as const,
    pendingOrganizers: () => ["admin", "pendingOrganizers"] as const,
    users: () => ["admin", "users"] as const,
    system: () => ["admin", "system"] as const,
  },
};

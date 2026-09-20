# #40 — Guard admin rescoping of an approved event that already has attendance

> **Status: DONE 2026-09-20** (PR: `fix/event-rescope-guard`). Implemented as
> **option 2 with a server-side fallback to option 1**: an audience change on an
> approved event with attendance requires an explicit `acknowledgeAudienceChange`
> acknowledgement, otherwise both edit routes return
> `409 AUDIENCE_CHANGE_HAS_RECORDS`. See below for the original brief.
> **Issue:** [#40](https://github.com/baicoders/Event-Attendance-System/issues/40) ·
> **Priority:** P1 (should-fix before beta, not a hard blocker) ·
> **Confidence:** CONFIRMED (re-verified against `main` on 2026-09-20).
>
> **Audience:** the agent picking this up. This file is the complete brief —
> you should not need the original audit session. Read it top to bottom before
> touching code.

---

## The problem in one paragraph

An admin can change an `APPROVED` event's `category` and `includedGroups` — the
two fields that define *who counts as an attendee* — even after attendance
records already exist for that event. Attendance eligibility is computed **live**
from the event's *current* fields (`buildEventStudentFilter`), not snapshotted at
approval, so changing the audience silently rewrites the report of an event that
already happened: scanned students can vanish from it, and present/absent/rate
numbers shift with no audit trail. The analogous **delete** paths already refuse
to delete an event with records (`EVENT_HAS_RECORDS`, 409); the edit paths do not.
That inconsistency is the reason this is filed as a gap, not a decision.

---

## The decision (settle this first — do not skip)

The issue has an unanswered product question. The repo owner's own 2026-08-17
comment on #40 leans toward **option 2**, while the issue's "Recommended
Direction" calls **option 1** the more defensible default:

1. **Hard block** — reject changes to `category` / `includedGroups` when
   `attendanceCount > 0`, while still allowing benign edits (title, location,
   description, schedule) through. Mirrors the existing delete-path guard.
   Cheapest, most defensible.
2. **Confirm with consequence** — allow the change, but require an explicit
   confirmation that names the effect ("This event has N attendance records;
   changing its audience will change who counts toward its report").

**Recommended: implement option 2**, because the owner stated a preference and an
explicit confirmation still lets an admin fix a genuine mistake, while making the
consequence impossible to trigger accidentally. To honor both readings, the
design below is **option 2 with a fallback to option 1** — see below.

> **If the owner is reachable, ask before building.** If not, proceed with the
> recommendation and state the assumption clearly in the PR description (and, if
> convenient, comment on #40). The choice is small enough to flip in review.

---

## Current behavior — verified locations

All line numbers are against `main` at `65c7f7d` (2026-09-20). Re-check before
editing; do not trust the numbers blindly.

**Server — two independent routes (this duplication is deliberate; you must fix
BOTH):**

- `app/api/events/route.ts` — `POST` (create + **update-by-including-an-`id`**,
  used by the event drawer and calendar drag/resize):
  - `:136-142` — `editableStatuses` is all four statuses for admins, including
    `APPROVED`.
  - `:156-165` — `prisma.event.update` applies `...baseData` (which includes
    `category`) and `includedGroups: { set: ... }` unconditionally.
  - `:201-213` — the sibling **DELETE** does the guard correctly (this is the
    pattern to mirror).
- `app/api/events/[eventId]/route.ts` — `PATCH` (workflow actions, **plus a
  content-edit fallback**):
  - `:168-173` — same `APPROVED`-inclusive `editableStatuses` for admins.
  - `:187-196` — `includedGroups: { set: ... }` applied with no attendance check.
  - `:220-232` — the sibling **DELETE** guard (mirror this).

**Eligibility (why the guard matters):**
`globals/utils/buildEventStudentFilter.ts` builds the student filter from the
event's *current* `category` / `includedGroups`. Consumed by
`app/api/events/[eventId]/stats/route.ts` and the reports endpoints.

**Client — the same form edits both benign and audience fields:**

- `features/calendar/components/EventDrawer.tsx` — one form exposes title,
  location, **Category**, **Included Groups**, schedule, description. For an
  admin on an approved event, `isReadOnlyView` is `false` (only organizers are
  locked, `:88-92`), so "Save changes" hits the update path.
- `features/calendar/utils/calendar.ts` — `canEditEvent` returns `true` for
  admins on every event (`:10-17`), so calendar drag/resize reaches the same path.
- `globals/hooks/useEvents.ts` — `useSaveEvent` is the mutation used by both the
  drawer and drag/resize; it POSTs to `/api/events`.

**Schema trap:** `app/api/events/[eventId]/route.ts` has its own inline
`patchSchema` (`:21-45`) that duplicates `eventSchema`
(`globals/schemas/index.ts:8-58`) by hand. If you change what an event edit
accepts, update **both** schemas. Per `docs/conventions.md`, do **not** merge them
as a drive-by — that consolidation is tracked as separate backlog debt.

---

## Required work

### 1. Server — the actual boundary

Add the audience-change guard to **both** update paths. It belongs **after** the
authorization asserts (auth → validate → authorize → persist is the mandatory
order; see the `api-route-patterns` skill).

The guard must:

- Fetch `attendanceCount = await prisma.record.count({ where: { eventId } })`
  only when the event being edited is `APPROVED` **and** the incoming payload
  actually changes `category` or `includedGroups`. (Skip the query for drafts
  and for benign edits — no point paying for a count that can't matter.)
- Decide "changed" by comparing against the **existing** event (its current
  `category`, and its current included-group ids via
  `prisma.event.findUnique({ include: { includedGroups: true } })`), not merely
  by presence of the fields. A drawer that re-submits an unchanged category must
  not trip the guard.
- **Option 2 shape (preferred):** if the audience changed and
  `attendanceCount > 0`, require an explicit acknowledgement to proceed:
  - Add an optional `acknowledgeAudienceChange: z.boolean().optional()` to both
    `eventSchema` and the route-local `patchSchema` (keep both in sync), or
    accept it as a top-level flag alongside the payload.
  - If `attendanceCount > 0` and the flag is absent/false, return
    `NextResponse.json(err(<message>, "AUDIENCE_CHANGE_HAS_RECORDS"), { status: 409 })`
    and include the count in a `data`-less message the client can display.
  - If `acknowledgeAudienceChange` is true, apply the update as normal.
- **Option 1 shape (fallback / belt-and-braces):** always reject with the same
  `409` + code when `attendanceCount > 0` and the audience changed, regardless of
  the flag. If you go this route, drop the flag entirely.
- Use `err(message, code)` — the code is the machine-readable branch the client
  checks. Do **not** invent a new error style; follow `EVENT_HAS_RECORDS` /
  `NO_TIME_IN` usage. Do **not** string-match on the message.
- Error message must name the consequence and the count, e.g.:
  `"This event already has ${attendanceCount} attendance record(s). Changing its category or included groups will change who counts toward its report."`

Mirror the guard's wording and shape between the two routes so they can't drift.
If the two routes would otherwise duplicate a non-trivial block, a small shared
helper (e.g. `globals/utils/eventAudienceGuard.ts`) is acceptable and preferable
to copy-paste — but keep the change scoped; do not refactor the routes' existing
authorization duplication.

### 2. Client — surface the consequence, don't surprise the admin

In `features/calendar/components/EventDrawer.tsx`:

- Detect when the form's `category` or `includedGroups` differ from
  `initialData`'s current values **and** the event is `APPROVED` with attendance.
  You may need the attendance count: `useStatsOfEvent(initialData?.id)` (already
  used elsewhere; it returns `{ eligible, present, absent }`) or add a lightweight
  count to the event payload if that's cleaner.
- Before calling `useSaveEvent`, when the audience changed on an approved event
  with records, call `useConfirm()` from
  `globals/contexts/ConfirmModalContext.tsx` with a description naming the
  consequence and the record count. If the admin cancels, abort the save. If they
  confirm, re-send with `acknowledgeAudienceChange: true`.
  - **Caveat:** `ConfirmDialog` is always styled destructive and is documented as
    "for irreversible actions." This edit is reversible-ish and not a delete. If
    a non-destructive confirmation is wanted, the convention says use a `Dialog`,
    not `ConfirmDialog`. Decide deliberately and note it in the PR; the simplest
    path that respects the documented convention is to keep the audience change
    itself as the "destructive-ish" trigger and use `useConfirm()`.
- `formatEventPayload` (`globals/utils/events.ts`) is the single place the drawer
  builds the POST body — thread the new flag through there if you add one.
- **Also cover calendar drag/resize**, which reaches the same server path via
  `useSaveEvent` without going through the drawer. Drag/resize normally changes
  only dates, so it shouldn't change the audience — but verify that a resize
  payload doesn't inadvertently send a different category/groups, or the server
  guard may 409 a plain date move. This is the most likely way to introduce a
  regression; test it explicitly.
- Mirror the rule cosmetically where it helps (e.g. disable the Save button or
  annotate the field) — but remember **client checks are cosmetic, the server is
  the boundary** (`docs/conventions.md`). A client-only fix is not acceptable.

### 3. Docs

- Update `docs/conventions.md` around `:347-352`: the "Known gap, not a pattern to
  copy" paragraph currently says nothing stops an admin from rescoping an
  approved event. Once fixed, rewrite it to describe the new guard as the pattern
  to follow for "admin can edit anything" pathways.
- Update the audit records so they don't mislead the next reader:
  - `docs/audit/findings.md` — mark `SEC-03` / `DATA-05` resolved (follow the
    existing `~~struck~~ **RESOLVED <date>**` style used for DATA-01/DATA-02).
  - `docs/audit/remediation-plan.md` — the Phase 1 bullet for #40 should be
    marked done the way `#46` and `#39` are.
  - `docs/audit/security.md#sec-03` and `docs/audit/data-integrity.md#data-05` —
    note the resolution.
- Do **not** edit `#52`'s checklist unless you also close the issue; the
  umbrella refresh is a separate task.

---

## Conventions to follow (load these skills first)

- **`api-route-patterns`** — route shape, the `ok()`/`err()` envelope,
  `respondWithError`, when to return a coded `err(...)` directly, and the
  event-routes duplication trap.
- **`auth-and-authorization`** — the four server-side primitives
  (`requireAuth`, `requireRole`, `assertEventOwnership`, `assertEventStatus`,
  `assertEventVisibility`); the guard is an *additional* business rule layered on
  top, not a replacement for those asserts.
- **`forms-tables-ui`** — the mandatory confirm-before-destroy pattern and the
  `useConfirm()` convention.
- **`data-fetching-and-state`** — TanStack Query cache/invalidation; note that
  `useSaveEvent`'s `onSuccess` over-invalidates all events on purpose. If the
  report/stats views depend on the changed event, confirm they refetch.
- **`release-verification`** — there is **no test suite**. Typecheck/lint passing
  is not evidence the change works. Verification is manual.

## Verification (there is no test runner — do this by hand)

1. `pnpm lint` and `pnpm build` (must pass; CI runs lint).
2. **Reproduce the bug first** on unmodified `main` to confirm your understanding:
   create a scoped event → approve it → record at least one attendance record →
   as admin, change `SECTION` → `HOUSE`. Confirm it currently succeeds and the
   stats/report change. Then apply the fix and confirm it no longer silently
   succeeds.
3. **Benign edit still works:** on the same approved event with attendance,
   change only the title/location/description/schedule → saves with no prompt and
   no 409.
4. **Audience change, cancel:** on the approved event with attendance, change the
   audience → prompt appears naming the record count → cancel → nothing is saved
   (re-open and confirm the category is unchanged).
5. **Audience change, confirm:** repeat → confirm → update applies and the report
   reflects the new scope.
6. **No attendance yet:** approve an event with zero records, change the audience
   → no prompt, saves normally.
7. **Both routes:** exercise the drawer (POST `/api/events`) **and** calendar
   drag/resize, and — if reachable from the UI — the `PATCH` content-edit
   fallback. Confirm both enforce the same rule.
8. **Drag/resize regression:** on an approved event with attendance, drag/resize
   to change only the dates → must succeed without a prompt or 409.
9. **Unauthorized path unaffected:** an organizer (non-admin) editing their own
   approved event still gets the existing read-only/409 behavior, unchanged.

## Scope boundaries — do not do these

- Do **not** consolidate the duplicated event-routes authorization logic. It is
  tracked as separate backlog debt.
- Do **not** merge `patchSchema` into `eventSchema`. Keep both in sync only.
- Do **not** touch `#48`, `#41`, `#42`, `#51`, or the `#52` umbrella checklist.
- Do **not** add a migration — this issue needs no schema change. (If you find
  one is needed, stop and flag it; that changes the risk profile.)
- Do **not** change how "absent" is modeled or the `@@unique([eventId, studentId])`
  constraint.

## Definition of done

- [ ] Guard enforced in **both** `app/api/events/route.ts` and
      `app/api/events/[eventId]/route.ts`, with a shared error code.
- [ ] Client surfaces the consequence and does not let it happen accidentally.
- [ ] Drag/resize date-only moves still work.
- [ ] `pnpm lint` + `pnpm build` pass.
- [ ] Manual verification steps 2–9 completed and recorded in the PR description.
- [ ] `docs/conventions.md` "known gap" paragraph updated; audit docs marked
      resolved.
- [ ] No incidental refactors beyond the above.
- [ ] PR body: state which option (block vs. confirm) you implemented and why,
      note the assumption if the owner wasn't consulted, and `Closes #40`.

## Commit / PR conventions

Match recent history: `fix(events): <imperative summary> (#40)` for the commit,
branch `fix/event-rescope-guard`. Recent PRs squash-merge with the issue number.

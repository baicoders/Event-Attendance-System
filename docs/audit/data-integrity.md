# Data Integrity Audit

Scope: Prisma/database operations, transactions, constraints, cascading behavior,
race conditions, and orphaned data. Every finding below was verified by reading the
actual query and schema code, not inferred from behavior.

**Headline finding**: the attendance ledger itself — the part most likely to cause
"incorrect/lost/duplicate attendance" — is well-built. The unique constraint plus
compare-and-set `updateMany` pattern genuinely prevents double-recording under
concurrent scans. The real data-integrity risk in this codebase is concentrated in two
places that don't get scanned every day but matter enormously this specific week:
**bulk-loading 2,000+ students**, and **the complete absence of a backup story** for the
one file that holds everything.

---

## DATA-01 — Bulk import has no transaction timeout override, likely fails at scale {#data-01}

**Severity:** P0 — release blocker
**Confidence:** CONFIRMED (code) / LIKELY (scale) — **RESOLVED 2026-08-20, issue #38**
**Location:** `app/api/bulk-import/students/route.ts:46-86`

```ts
const results = await prisma.$transaction(
  students.map((data) => {
    ...
    return prisma.student.upsert({
      where: { id: data.id },
      update: { ..., groups: { set: studentGroupIds } },
      create: { ..., groups: { connect: studentGroupIds } },
    });
  }),
);
```

**Problem:** this is Prisma's *array* form of `$transaction` — every upsert in the
array runs inside one database transaction, sequentially. Neither this call nor the
Prisma client instantiation (`globals/libs/prisma.ts`) overrides Prisma's defaults,
which are `timeout: 5000ms` and `maxWait: 2000ms` for this API. Each `upsert` with a
`groups.set`/`.connect` relation write isn't one SQL statement — it's several (find, then
disconnect old joins, then connect new ones, per Prisma's relation-write strategy).
For 2,000 rows, that's easily 6,000–10,000+ sequential SQL statements inside a single
transaction on a single-writer SQLite connection.

**Why it matters:** if the whole batch doesn't complete inside 5 seconds — very
plausible at this volume on ordinary laptop hardware — Prisma aborts and **rolls back
the entire transaction**. The operator gets one opaque failure (mapped through
`handlePrismaError`'s `default: "Database error occurred."`, 500) with **zero
information about which rows would have succeeded**, and **zero students imported** —
an all-or-nothing failure at the exact moment the roster most needs to get loaded before
the event.

**Verified behavior (2026-08-20):** exercised with a realistic 2,000-student fixture
(`scripts/benchmark/roster-2000.json`) through both the real API and a standalone
probe (`scripts/benchmark/direct-transaction.ts`). Two things became clear:

- **The 5s timeout does not fire for the synchronous better-sqlite3 adapter.** The
  batch runs as a microtask chain that blocks the event-loop's timer phase, so the
  engine's timeout timer cannot interrupt it. A full 2,000-row import completes and
  commits — measured ~10s through the API (fresh and idempotent re-run) and ~24–54s
  through the raw probe, with 10,004–14,005 SQL statements and no rollback.
- **The 2s `maxWait` is the real latent failure.** Two imports at once (a double-fire,
  or two organizers importing concurrently) queue on the single SQLite writer; the
  second fails after 2s with P2028 ("Unable to start a transaction in the given time."),
  which previously surfaced as the opaque `500 "Database error occurred."`.

**RESOLVED (2026-08-20, issue #38).** `globals/libs/prisma.ts` now sets explicit
`transactionOptions: { timeout: 120_000, maxWait: 30_000 }` — the one place that
governs batch-transaction options — so a full-roster import (and any import queued
behind one) completes instead of erroring. Notes on the resolution:

- **The array form is kept.** The whole roster stays in a single transaction: invalid
  rows still roll back the entire batch (the all-or-nothing contract the UI documents),
  and upserts keep the import idempotent — retrying never creates duplicates.
- **P2028 now maps to a clear, retry-safe message.** `handlePrismaError` returns
  `503 "The database transaction did not complete and was rolled back. Retrying the
  operation is safe."` instead of the generic `500 "Database error occurred."`.
- **Verified against the production build.** `scripts/benchmark/http-import-benchmark.ts`
  ran the full fresh import (2,000 students created), a re-run (idempotent — still
  2,000, no duplicates), and an invalid-row import (whole batch rejected, nothing
  changed). See `scripts/benchmark/README.md`.
- **Operator copy updated.** The importer now notes a full roster can take up to a
  minute to import, so a slow run isn't mistaken for a hang.

**Release blocker:** yes — this was the one place the audit had high confidence a scale
problem would manifest at roster onboarding; it is now resolved and exercised at the
full stated scale. **Backlog ticket:** the chunked/progress UI remains backlog
(OPS-04).

---

## DATA-02 — No way to add a `Group` without a destructive reseed {#data-02}

**Severity:** P0 — release blocker
**Confidence:** CONFIRMED
**Location:** `app/api/groups/` (only `GET` routes exist — no `POST`/`PATCH`/`DELETE`), `prisma/seed.ts` (wipes `record → event → student → group → user`, every table, before inserting fixed demo data)

**Problem:** `Group` rows — every department, program, strand, house, section, and year
grouping — are created *only* by `prisma/seed.ts`, which is fully destructive (it
deletes every row in every table first) and writes a fixed, small vocabulary
(3 departments, 4 programs, 4 sections, 2 strands, 5 houses — see `globals/constants/groups.ts`
and `GROUP_DATA`/`DERIVED_GROUPS` in the seed). There is no API endpoint and no UI
screen to create a `Group` outside of that.

**Why it matters:** `validateStudentGroupSlugs` (shared by both the single-student and
bulk-import write paths) rejects the **entire** request if even one referenced slug
doesn't already exist as a `Group` row (`Unknown group(s): …`). For a real school with
2,000+ students across what is almost certainly *more than 4 sections and 3
departments*, the seeded vocabulary will not match reality. The only way to add the
missing groups is: (a) edit `globals/constants/groups.ts` and re-run the destructive
seed — which also erases any students/events/users already created that week — or (b)
insert `Group` rows directly via Prisma Studio or a script. Neither is something an
"unrelated organizer who has never seen the source code" can do, and per the release
context, **the developer may be unavailable during the event**.

**Reproduction:** attempt to bulk-import a CSV containing a section name that isn't in
the seeded list. Expect the entire batch (all 2,000 rows) to be rejected with
`Unknown group(s): <section-name>. Fix and retry.`

**Recommended fix direction:** before the beta, either (a) confirm and adjust the
seeded vocabulary in `globals/constants/groups.ts` to exactly match the real school's
current sections/departments/programs/strands/houses, then seed once from that correct
list, or (b) have whoever has terminal access rehearse adding a `Group` row via Prisma
Studio (`pnpm db:studio`) as a documented runbook step, so it can be done quickly if a
missing section surfaces mid-week. A minimal "add group" admin screen is the right
long-term fix but is out of scope for this week.

**RESOLVED (2026-08-17, issue #39).** Groups are now operator-managed from
**Settings → Groups**, backed by `POST /api/groups`,
`PATCH|DELETE /api/groups/[groupId]`, and `GET /api/groups/manage` — all admin-only
via `requireRole(user, "ADMIN")`. Notes on the resolution:

- **No restart or reseed.** `validateStudentGroupSlugs` was always a pure database
  lookup, so a group created in the console is usable by the importer immediately.
  The group query caches previously had a 5-minute `staleTime` and *no* invalidation
  anywhere; all group keys now share a `["groups"]` prefix that every mutation
  invalidates, so a new group also appears in the student form and event drawer at
  once.
- **Delete is guarded.** Students are reassigned to a replacement group of the same
  category (or deliberately left unassigned). Deletion is refused outright with
  `409 GROUP_IN_USE_BY_EVENTS` while any event targets the group, because the
  `_EventGroups` join cascades and would silently rewrite that event's audience.
- **A latent bug was fixed alongside it.** `buildEventStudentFilter` returned an
  unfiltered `where` when a scoped event had zero groups, matching the *entire*
  roster rather than nobody — a silent scope explosion reachable for the first time
  once groups became deletable. It now fails closed. See DATA-12.
- **The selection boards are no longer constants-driven.** They render one tile per
  `Group` row, so a department added in the console is reachable by navigation and
  not just by hand-editing a URL. `globals/constants/groups.ts` is now seed data plus
  tile artwork; the `Group` table is the source of truth.

The Prisma Studio procedure survives as a fallback in
[`../deployment/operator-runbook.md`](../deployment/operator-runbook.md) §2, along
with the pre-onboarding step of reconciling the seeded vocabulary against the real
school's structure — still worth doing, since the seed ships only 4 sections and 4 of
13 programs.

**Release blocker:** yes — this needs a resolved plan (not necessarily a code change)
before roster onboarding begins. **Backlog ticket:** yes, for a proper group-management
UI post-beta.

---

## DATA-03 — Deleting a student with attendance history gives a misleading error {#data-03}

**Severity:** P2
**Confidence:** CONFIRMED
**Location:** `app/api/students/[id]/route.ts:35-49` (DELETE), `globals/utils/prismaError.ts:52-57` (P2003 mapping)

**Problem:** `Record.studentId` is `onDelete: RESTRICT`. The student-delete route makes
no attempt to check for existing records first — it calls `prisma.student.delete()`
directly and lets the database reject it. That FK violation surfaces to Prisma as
`P2003`, which `handlePrismaError` maps to:

```
{ status: 400, message: "Invalid reference. Related record does not exist." }
```

That message describes a *different* failure mode entirely (referencing something that
doesn't exist) — the true reason is the opposite: the student **does** have related
records, and that's exactly why the delete is blocked. Contrast this with
`DELETE /api/events`, which proactively checks `attendanceCount > 0` and returns a
precise, correct 409 `EVENT_HAS_RECORDS` message — the student-delete path is missing
the equivalent guard that the event-delete path already has.

**Why it matters:** an organizer cleaning up a duplicate or mistaken student profile
mid-event, after that student has already been scanned once, gets a confusing error
that doesn't explain what to do next. Cross-referenced in
[`operability.md`](./operability.md#ops-07) since the user-facing impact is primarily
an operator-confusion issue, not a data-corruption one — the RESTRICT constraint is
doing its job correctly; only the message is wrong.

**Recommended fix direction:** mirror the event-delete pattern — count
`prisma.record.count({ where: { studentId: id } })` before deleting, and return a clear
409 if non-zero (e.g., `"Cannot delete this student because attendance has already
been recorded for them."`).

**Release blocker:** no. **Backlog ticket:** yes — small, well-understood fix.

---

## DATA-04 — No backup strategy for the single SQLite file {#data-04}

**Severity:** P1 — should fix before beta
**Confidence:** CONFIRMED (absence, verified against `package.json` scripts, deployment docs, and the repo — no backup tooling, no scheduled task, no export-everything endpoint exists anywhere)

**Problem:** the entire system of record is one file (`prisma/dev.db`, per
`DATABASE_URL=file:./prisma/dev.db`) on one laptop. There is no automated backup, no
`pnpm` script for it, and no in-app "export everything" or "download database" action.

**Why it matters:** this is the single most damaging failure mode the brief explicitly
asks about — "lost attendance," "data corruption," "recovery difficulties." A dropped
laptop, a failed drive, an accidental `rm`, or even the SQLite file being on a synced
folder that partially uploads mid-write could destroy the only copy of every student
record, every event, and every attendance timestamp collected that week, with zero path
to recovery.

**Recommended fix direction:** this doesn't require a code change. Before the event:
(1) confirm where `DATABASE_URL` resolves to on the actual host laptop, (2) set up a
simple periodic copy of that file (a scheduled `copy`/`cp` to a USB drive or a synced
cloud folder, on a 15–30 minute cadence during the event), and (3) do one practice
restore (stop the server, copy the backup file back, restart, confirm the app reads it)
so the procedure is proven, not assumed. This is cheap insurance against the worst
possible outcome of the week.

**Release blocker:** operationally, yes — this needs a plan before the event even if no
code changes. **Backlog ticket:** yes, for an in-app export/backup feature post-beta.

---

## DATA-05 — see SEC-03

Admin edits to an approved, already-recorded event's category/audience silently
change eligibility retroactively. Full detail in
[`security.md`](./security.md#sec-03) since the root cause is an authorization-model
gap; referenced here because the *consequence* is a data-integrity one (report numbers
for an already-happened event change without any audit trail explaining why).

**RESOLVED 2026-09-20 (#40)** — see
[`security.md#sec-03`](./security.md#sec-03) for the guard. An audience change on an
approved event with attendance now requires an explicit acknowledgement, so the report
can no longer be rewritten silently.

---

## DATA-06 — Eligibility is always computed live, not snapshotted {#data-06}

**Severity:** P2
**Confidence:** CONFIRMED (by design — documented in `domain-model.md`)
**Location:** `globals/utils/buildEventStudentFilter.ts`, all **7** call sites across 5
files (`app/api/events/[eventId]/stats/route.ts`, `app/api/records/route.ts`,
`app/api/events/[eventId]/records/route.ts` ×2, `app/api/students/route.ts` ×2, and
`app/(main)/reports/events/[id]/print/page.tsx`) — corrected from "six" during the
2026-08-16 reconciliation pass
**Tracked:** [#45](https://github.com/mjfelecio/Event-Attendance-System/issues/45)

**Problem:** "is this student eligible for this event" is recomputed from the *current*
roster and group membership every time it's read — there is no snapshot of who was
eligible at event/approval time. This is an architectural decision, not a bug, but it
has a sharp edge: fixing a student's section on Wednesday retroactively changes the
attendance report of Monday's event, potentially causing an already-scanned student to
disappear from that report entirely (if they no longer match the event's current
scope).

**Why it matters:** roster corrections *will* happen during a live, week-long rollout —
typos get fixed, students get moved between sections, imports get corrected. Every one
of those corrections silently edits the historical record of past events. This is
listed as P2 rather than P0/P1 because it's a known, by-design tradeoff, not a defect —
but operators need to understand it, because "why did this report change overnight"
will otherwise look like a bug.

**Recommended fix direction:** no code change recommended for this beta. Document the
behavior explicitly for whoever runs reports ("attendance reports reflect the *current*
roster, not a historical snapshot — don't edit student groups after an event without
expecting its report to change"). A proper fix (snapshotting eligibility at event
approval or event start) is a schema change, appropriately deferred to backlog.

**Release blocker:** no. **Backlog ticket:** yes, for historical eligibility snapshots.

---

## DATA-07 — Names/IDs are not trimmed by validation {#data-07}

**Severity:** P3
**Confidence:** CONFIRMED
**Location:** `globals/schemas/studentSchema.ts` (no `.trim()` on `id`, `firstName`, `lastName`, `middleName`)

**Problem:** `z.string().min(1)` accepts a leading/trailing-whitespace-padded value,
and a single space (`" "`) satisfies `min(1)` entirely. A CSV cell with a stray space —
extremely plausible across a 2,000-row import — creates a record that looks correct in
most views but won't exact-match elsewhere and sorts oddly.

**Recommended fix direction:** add `.trim()` to the relevant string fields in
`studentSchema` (and ideally `eventSchema`'s `title`/`location`).

**Release blocker:** no. **Backlog ticket:** yes, low priority.

---

## DATA-08 — No duplicate-ID detection within a single import batch {#data-08}

**Severity:** P3
**Confidence:** CONFIRMED
**Location:** `app/api/bulk-import/students/route.ts:46-86`

**Problem:** if the same student ID appears twice in one CSV, both `upsert`s execute in
order — the second silently overwrites the first inside the same transaction. No
warning is surfaced that a duplicate was collapsed.

**Recommended fix direction:** pre-scan `students` for duplicate `id`s and reject the
batch with a clear message before the transaction starts, listing the offending IDs.

**Release blocker:** no. **Backlog ticket:** yes, low priority.

---

## DATA-09 — "One group per category" is assumed, not enforced {#data-09}

**Severity:** P3
**Confidence:** POSSIBLE (the gap is real in the schema; reachability through the
reviewed application write paths is low — the student write path always uses
`groups: { set: [...] }` from five single-valued form fields, which structurally
produces at most one group per category when written through the app)
**Location:** `prisma/schema.prisma` (`Student.groups Group[]`, no cardinality constraint per category)

**Problem:** nothing in the schema stops a `Student` from being connected to two
`SECTION` groups (or two houses, etc.) simultaneously. The app's own write path makes
this unlikely in practice, but a direct database edit (which, per DATA-02, is an
expected recovery mechanism in this app) could create it. If it happened,
`flattenStudentGroups` would non-deterministically keep whichever group of that
category came last in the array, and `buildEventStudentFilter`'s `groups.some(...)`
match would treat the student as eligible if *either* section matched — silently wrong
eligibility with no error anywhere.

**Recommended fix direction:** low priority given the low reachability, but worth a
one-line runtime assertion if `Group` rows are ever hand-edited via Studio. No
schema-level fix is realistic without moving to a per-category foreign key, which is a
larger change appropriately left to backlog.

**Release blocker:** no. **Backlog ticket:** optional.

---

## DATA-10 — Record deletion audit trail is console-only {#data-10}

**Severity:** P3
**Confidence:** CONFIRMED (by design)
**Location:** `app/api/records/[recordId]/route.ts:36-38`

```ts
console.info(`[audit] record ${recordId} (event ${record.eventId}, student ${record.studentId}) deleted by user ${user.id}`);
```

**Problem:** deleting a record ("Mark as Absent") is a hard delete with no tombstone
row. The only trace of who deleted it and when is a line written to the server's
stdout — not persisted anywhere in the database, and lost the moment the terminal is
closed or scrolled past (unless the operator is separately capturing logs to a file).

**Why it matters:** if a disputed attendance record comes up later ("I was marked
absent but I definitely scanned in"), there is no way to reconstruct what happened once
the terminal session is gone.

**Recommended fix direction:** if the terminal running the server is going to stay open
for the week, redirect its output to a log file (`pnpm start >> attendance-server.log
2>&1`) as a cheap interim measure. A real fix (a `RecordAudit` table, or soft-delete
instead of hard-delete) is appropriately backlog.

**Release blocker:** no. **Backlog ticket:** yes.

---

## DATA-12 — A scoped event with zero groups matched the entire school {#data-12}

**Severity:** P1 (was latent; became reachable with DATA-02's fix)
**Confidence:** CONFIRMED — **fixed 2026-08-17**
**Location:** `globals/utils/buildEventStudentFilter.ts`

**Problem:** the group filter was only applied when the event had at least one included
group:

```ts
const includedSlugs = event.includedGroups.map((g) => g.slug);
if (includedSlugs.length > 0) {
  where.groups = { some: { slug: { in: includedSlugs } } };
}
return where;   // <- empty `where` when the list is empty: matches EVERY student
```

A `DEPARTMENT` event whose groups had all been removed therefore resolved to an
**unfiltered** query — the whole roster — rather than to nobody. It is a silent scope
explosion, not a crash: nothing errors, the numbers are simply wrong. It propagates to
`GET /api/events/[eventId]/stats`, the absent-students list in
`GET /api/events/[eventId]/records`, the scan eligibility gate in `POST /api/records`,
and `GET /api/students`.

**Why it was found now:** the `_EventGroups` join cascades, so this state was only
reachable by editing the database directly — until DATA-02's fix put a delete button on
groups. Discovered while designing that flow.

**Fix:** the function now fails closed, returning a filter that matches no students
(`where.id = { in: [] }`) when a scoped event has no groups. Deleting a group that an
event targets is *also* refused outright (see DATA-02), so this is the second line of
defence rather than the first.

---

## DATA-11 — Missing affected-row check in one scan branch {#data-11}

**Severity:** P3
**Confidence:** CONFIRMED (code) — reachability through the app's current UI write
paths is NOT established; likely dead/defensive code today
**Location:** `app/api/records/route.ts:114-126`

```ts
} else if (!existing.timein) {
  await prisma.record.updateMany({
    where: { id: existing.id, timein: null },
    data: { timein: now, lastModifiedById: user.id },
  });
  ...
  return NextResponse.json(ok({ ...current, changed: true }), { status: 200 });
}
```

**Problem:** this branch hardcodes `changed: true` without checking how many rows the
`updateMany` actually affected — unlike every other compare-and-set write in this same
file and in `PATCH /api/records/[recordId]`, which all correctly gate `changed` on
`res.count > 0`. If two requests raced to fill the same null `timein`, the loser here
would still report `changed: true` (a false "success").

**Why this is low severity, not higher:** every path in the current codebase that
creates a `Record` sets `timein: now` *at creation* (`prisma.record.create({ ...,
timein: now })`) — there is no reviewed code path that ever leaves an existing record's
`timein` null after creation in normal (non-timeout) mode. This branch therefore
appears to be defensive/unreachable through the app's actual UI today. It's flagged
because (a) it's a real, verifiable inconsistency against the sibling implementations,
and (b) this app's own documented recovery pattern is direct database edits — an
operator hand-creating a `Record` row with a null `timein` during an incident (entirely
plausible given DATA-02's precedent) would hit exactly this gap.

**Recommended fix direction:** add the same `res.count > 0` check used everywhere else
in this file — a one-line, low-risk change.

**Release blocker:** no. **Backlog ticket:** yes, low priority, for consistency.

---

## Explicitly checked and found sound

- **Duplicate attendance:** `@@unique([eventId, studentId])` plus the compare-and-set
  `updateMany(... WHERE column IS NULL)` pattern used on every timestamp write
  (`POST /api/records`, `PATCH /api/records/[recordId]`) genuinely prevents two
  concurrent scans from producing two records or overwriting an existing timestamp.
  The `P2002` race on record *creation* is caught and the losing request returns the
  winner's row untouched rather than erroring. Verified by reading the exact logic;
  this is correct.
- **Timeout-mode toggle race:** `POST /api/events/[eventId]/timeout` takes an explicit
  desired boolean and applies it via `updateMany WHERE isTimeout = !desired` — two
  operators both intending "start timeout" converge instead of double-toggling back and
  forth.
- **Cascading deletes:** `_GroupToStudent` and `_EventGroups` join tables cascade
  correctly; `Record → Event`/`Record → Student` are `RESTRICT` (verified — an event or
  student with attendance cannot be deleted, only the student-delete path has the
  message-quality gap noted in DATA-03); `Event → User` and `Record → User` (audit
  actor fields) are `SET NULL`, which is appropriate — deleting a user shouldn't cascade
  into deleting their events or records.
- **Referential integrity on writes:** `validateEventGroupIds` and
  `validateStudentGroupSlugs` both check existence *and* category match before any
  write touches the database, preventing category-smuggled group references.
- **No raw SQL, no injection surface** in any query reviewed.

# Domain Model

The business model as it actually exists in the code, derived from
`prisma/schema.prisma`, the API route handlers, and the Zod schemas. Nothing here is
aspirational — if a rule isn't enforced somewhere in the codebase, it is marked as
*not enforced*.

Companion document: [`architecture.md`](./architecture.md).

---

## Entity map

```
        User ──────────────┐ createdBy / reviewedBy
          │                │
          │ recordedBy /   ▼
          │ lastModifiedBy Event ──────< _EventGroups >────── Group
          │                  │                                  │
          └────────────────► Record ◄──────────────── Student ──┘
                             (eventId, studentId)   _GroupToStudent
                                UNIQUE
```

Five models. `Group` is the hinge: it is the only thing that both a `Student` and an
`Event` point at, and that is how "who is invited" is computed.

---

## Student

### What it represents

One enrolled student. **A student is not a user** — students never authenticate and
have no password. Their only interaction with the system is having their QR code
scanned.

### Fields

| Field | Type | Notes |
|---|---|---|
| `id` | `String` **PK, client-supplied** | The school student number. `studentSchema` requires **exactly 11 characters**. This is also the QR payload and the natural join key for imports. Not a cuid. |
| `lastName` | `String` | Required |
| `firstName` | `String` | Required |
| `middleName` | `String?` | Rendered as an initial by `fullName()` |
| `yearLevel` | `YearLevel` | `YEAR_1..YEAR_4` \| `GRADE_11` \| `GRADE_12` |
| `schoolLevel` | `SchoolLevel` | `COLLEGE` \| `SHS` |
| `createdAt` / `updatedAt` | `DateTime` | |

Note what is **not** a column: section, house, department, program, and strand. Those
were all dropped in `20260401135507_overhaul_schema` and `20260408082631` and are now
`Group` memberships. The API re-flattens them onto the JSON response via
`flattenStudentGroups()` (`groups[].category.toLowerCase()` → `groups[].slug`), which is
why client code still reads `student.house`, `student.section`, etc. **That flattening
is a response shape, not a database shape.**

### Relationships

- `groups: Group[]` — many-to-many via `_GroupToStudent` (CASCADE both ways)
- `records: Record[]` — one per event attended (`RESTRICT` on delete)

### Invariants

- **Exactly one group per category, in practice.** Nothing in the schema prevents a
  student belonging to two sections; the write path (`groups: { set: [...] }` from five
  single-valued columns) makes it structurally unlikely, and `flattenStudentGroups`
  would silently keep whichever came last. **Not enforced by the database.**
- **Level/track consistency**, enforced by `studentSchema.superRefine`:
  - `COLLEGE` → must have `program` **and** `department`, must **not** have `strand`,
    year must be `YEAR_1..YEAR_4`
  - `SHS` → must have `strand`, must **not** have `department` or `program`, year must
    be `GRADE_11` or `GRADE_12`
- **`section` and `house` are required** for every student (`z.string().min(1)`).
- **Every referenced slug must exist as a `Group` and match its column's category** —
  `validateStudentGroupSlugs`. A house slug in the section column is rejected.
- Strings are **not** trimmed by the schema, so a whitespace-only name currently passes
  `min(1)`.
- A student with attendance records **cannot be deleted** — the `Record → Student`
  foreign key is `ON DELETE RESTRICT`, so the delete fails at the database level
  (surfaces as a 400 "Invalid reference. Related record does not exist.").

### Who can create / update / delete

**Any authenticated, active user — organizer or admin.** This is a deliberate,
code-documented policy (`app/api/students/route.ts`): organizers are expected to fix
roster data during an event. There is no ownership concept for students.

- `POST /api/students` — **upsert** keyed on `id`. Creating a "new" student with an
  existing ID silently overwrites that student's record.
- `POST /api/bulk-import/students` — array upsert in one transaction, all-or-nothing.
- `DELETE /api/students/[id]` — hard delete, no confirmation server-side.

### Who depends on it

Everything downstream of eligibility: `buildEventStudentFilter`, event stats, the
attendance records endpoint (both variants), the print report, the manual-attendance
search, the Student List roster and its stat cards, and every CSV export.

---

## Group

### What it represents

One entry in the school's taxonomy — a department, a program, a strand, a house, a
section, or a year level — discriminated by `category`. **One table for all six.** This
is the central design decision of the schema: because both students and events attach to
the same table, event scoping and student membership speak one vocabulary.

### Fields

| Field | Type | Notes |
|---|---|---|
| `id` | `String` cuid, PK | What **events** reference (`includedGroups` is an id array) |
| `name` | `String` | Human label, e.g. "Computer Studies", "Giallio", "BSCS-2A" |
| `slug` | `String` **UNIQUE** | What **students** reference and what eligibility matches on |
| `category` | `EventCategory` | `DEPARTMENT` \| `PROGRAM` \| `STRAND` \| `HOUSE` \| `SECTION` \| `YEAR` (the `ALL`/`COLLEGE`/`SHS` values of the enum are event-only and never used on a Group) |
| `createdAt` / `updatedAt` | `DateTime` | Indexed on `[category]` |

The **id/slug asymmetry is a real trap**: event group selection is by `id`, student group
assignment is by `slug`. `validateEventGroupIds` validates ids; `validateStudentGroupSlugs`
validates slugs and returns a slug→id map for the actual `connect`.

### Relationships

- `students: Student[]` (`_GroupToStudent`)
- `events: Event[]` (`_EventGroups`, named relation `"EventGroups"`)

### Invariants

- `slug` is globally unique across **all** categories.
- A student's group must match the category of the column that referenced it.
- An event's groups must all match the event's `category`.
- Slug conventions the seed and constants rely on:
  - houses → `HOUSES[].slug` (`giallio`, `roxxo`, `azul`, `cahel`, `vierrdy`)
  - strands → `slugify(SHS_STRANDS[].code)` (`stem`, `abm`, `assh`, `css`, `he`, …)
  - departments / programs / sections / years → `slugify(name)`
  - section naming → `<CODE>-<year><letter>` (`BSIT-2A`, `STEM-11A`), per
    `buildSectionName` in `globals/constants/groups.ts`

### Who can create / update / delete

**Admins**, from **Settings → Groups**:

| Route | Who | Notes |
|---|---|---|
| `GET /api/groups` | anyone | **Unauthenticated.** Form-select options, keyed by category. |
| `GET /api/groups/byCategory/[category]` | anyone | **Unauthenticated.** `{ id, name, slug }`. |
| `GET /api/groups/manage` | ADMIN | Console table rows, with student counts and referencing events. |
| `POST /api/groups` | ADMIN | `slug` is globally unique → `409 DUPLICATE`. |
| `PATCH /api/groups/[groupId]` | ADMIN | **Renames only.** The slug is immutable. |
| `DELETE /api/groups/[groupId]` | ADMIN | See below. |

**Deletion has two guards.** It is refused with `409 GROUP_IN_USE_BY_EVENTS` while any
event targets the group — the `_EventGroups` join cascades, so deleting anyway would
silently rewrite that event's audience. Students are moved to a replacement group of the
same category, or deliberately left without one.

Still true, and still the thing that bites first: **a student import can only reference
sections and houses that already exist as `Group` rows.** An unknown slug rejects the
entire batch with `Unknown group(s): …`. The difference is that recovering now takes a
minute in the UI rather than a destructive reseed.

### Who depends on it

Event scoping, student eligibility, the student form's dropdowns
(`GET /api/groups` → `useFetchGroups`), the event drawer's group picker
(`GET /api/groups/byCategory/[category]`), report section grouping, and the
`SECTION` column in every attendance table.

---

## Event

### What it represents

A scheduled happening that attendance is taken for, together with its approval workflow
state and its audience scope.

### Fields

| Field | Type | Notes |
|---|---|---|
| `id` | cuid, PK | |
| `title` | `String` | Required, min 1 |
| `location` | `String?` | |
| `description` | `String?` | |
| `category` | `EventCategory` | Determines how the audience is computed — see below |
| `isTimeout` | `Boolean` = `false` | **Event-global recording mode.** `false` → scans record time-*in*; `true` → scans record time-*out*. Not per-student. |
| `start` / `end` | `DateTime` | `end >= start` enforced by Zod. **Neither bounds attendance writes.** |
| `allDay` | `Boolean` = `false` | All-day events have start/end normalized to midnight client-side |
| `status` | `EventStatus` = `DRAFT` | `DRAFT` \| `PENDING` \| `APPROVED` \| `REJECTED` |
| `createdById` | `String?` → User | The owner. Nullable (`SET NULL` if the user is deleted) — **a deleted owner makes the event unowned, and `assertEventOwnership` then fails for every non-admin** |
| `reviewedById` / `reviewedAt` | `String?` / `DateTime?` | Stamped on APPROVE / REJECT |
| `rejectionReason` | `String?` | Required on REJECT; cleared on SUBMIT and APPROVE |
| `createdAt` / `updatedAt` | `DateTime` | |

Indexes: `[status]`, `[createdById]`, `[status, start]` (the composite serves the common
"list by status, ordered by start" query without a temp sort).

### The audience rule

`category` plus `includedGroups` defines who the event is for:

| `category` | Audience |
|---|---|
| `ALL` | Every student. `includedGroups` ignored. |
| `COLLEGE` | `schoolLevel = COLLEGE`. `includedGroups` ignored. |
| `SHS` | `schoolLevel = SHS`. `includedGroups` ignored. |
| `DEPARTMENT`, `HOUSE`, `STRAND`, `PROGRAM`, `SECTION`, `YEAR` | Students in **any** of the selected groups (`groups.some.slug IN [...]`). At least one group required. |

Two consequences worth remembering:

- The scoped categories are **OR**, not AND. An event scoped to two houses invites both.
- `COLLEGE` and `SHS` require no group selection. Their school-level predicate is
  shared by audience preview, attendance recording, student lookup, stats, and reports.
- **`YEAR` events match zero students.** Nothing ever connects a student to a `YEAR`
  group — year level is the `Student.yearLevel` enum column. The seed creates `YEAR`
  `Group` rows, so the category is selectable in the drawer, but the join never exists.

### Relationships

- `includedGroups: Group[]` (`_EventGroups`)
- `records: Record[]` (`RESTRICT` on delete, plus an explicit API guard)
- `createdBy` / `reviewedBy` → `User`

### Invariants

- `end >= start` (Zod, both write paths).
- Scoped categories require ≥1 group (`validateEventGroupIds` + a Zod refine).
- All `includedGroups` must exist and share the event's `category`.
- Created events always start as `DRAFT` with `createdById = user.id` — the client cannot
  choose a status.
- **Attendance requires `status === "APPROVED"`.** No other status accepts records.
- **An event with any record cannot be deleted** (409 `EVENT_HAS_RECORDS`).
- Only APPROVED events can have `isTimeout` toggled.

### Lifecycle

See [`architecture.md` §9](./architecture.md#9-event-lifecycle) for the full table. In short:
`DRAFT --SUBMIT--> PENDING --APPROVE--> APPROVED`, with `REJECT` (PENDING only, reason
required) and an organizer's edit of a rejected event resetting it to `DRAFT`. `DRAFT` is
deliberately not directly approvable.

### Who can create / update / delete

| Operation | Who |
|---|---|
| Create | Any active user (organizer or admin) |
| Edit content | Owner or admin. Organizers only while `DRAFT` or `REJECTED`; admins in any state |
| Submit | Owner (admin bypasses the ownership check), `DRAFT` only |
| Approve / Reject | **ADMIN only** |
| Toggle `isTimeout` | Owner or admin, APPROVED only |
| Delete | Owner or admin, and only with zero records |
| **Read** | Owner, **or anyone if APPROVED**, or admin |

### Who depends on it

The calendar, both dashboards, the attendance page's event picker
(`GET /api/events?status=APPROVED` — note this returns *all* approved events, not just
the caller's), the reports list, both report pages, and every stats/records endpoint.

---

## Record

### What it represents

The fact that a specific student was marked present at a specific event, with when they
timed in and (optionally) out. **This is the system's ledger.** Absence is not stored —
it is derived as "eligible with no record".

### Fields

| Field | Type | Notes |
|---|---|---|
| `id` | cuid, PK | |
| `eventId` | → Event | `RESTRICT` |
| `studentId` | → Student | `RESTRICT` |
| `method` | `AttendanceMethod` | `MANUAL` \| `SCANNED`. Set at creation and **never updated** — a record created by scan and completed manually still reads `SCANNED` |
| `timein` | `DateTime?` | Server clock at first time-in |
| `timeout` | `DateTime?` | Server clock at time-out; only settable after `timein` |
| `recordedById` | `String?` → User | Who created it. `SET NULL` |
| `lastModifiedById` | `String?` → User | Who last set a timestamp. `SET NULL` |
| `createdAt` / `updatedAt` | `DateTime` | `createdAt DESC` is the live table's order |

**`@@unique([eventId, studentId])`** — the most important constraint in the schema.

### Invariants

1. At most one record per (event, student). The create path tolerates the P2002 race
   rather than trying to avoid it.
2. `timeout` requires an existing `timein` (409 `NO_TIME_IN` otherwise).
3. Timestamps are **write-once**. Every update is `updateMany WHERE <column> IS NULL`, so
   nothing in the API overwrites an existing value. The only way to change a timestamp is
   to delete the record and re-scan.
4. Records only exist on APPROVED events.
5. A record whose student is no longer eligible for the event **still exists in the
   database but is invisible** to every read path (records list, stats, report, print) —
   they all filter by current eligibility. It is orphaned, not deleted.

### Who can create / update / delete

| Operation | Who | Route |
|---|---|---|
| Create (scan or manual "Time In") | Any active user who can *see* the APPROVED event | `POST /api/records` |
| Complete (fill the missing timestamp) | Same — **no ownership required** | `PATCH /api/records/[recordId]` |
| Delete ("Mark as Absent") | **Event owner or admin only** | `DELETE /api/records/[recordId]` |

Deletion is a hard delete. The only trace is a `console.info("[audit] record … deleted by
user …")` line on the server's stdout — **there is no database audit of deletions.**

### Who depends on it

Event stats (`present`), the live attendance table, the report table and its
present/absent status column, the print report, CSV export, and the event-deletion guard.

---

## User

### What it represents

An operator of the system: an organizer or an admin.

### Fields

| Field | Type | Notes |
|---|---|---|
| `id` | cuid, PK | |
| `name` | `String` | Shown as `organizerName` on events and in the sidebar |
| `email` | `String` **UNIQUE** | Stored lowercased/trimmed by both signup and login |
| `password` | `String` | `scrypt:<salt>:<key>`, **or** a legacy plaintext value that is accepted once and rehashed on next successful login |
| `role` | `UserRole` = `ORGANIZER` | `ORGANIZER` \| `ADMIN` |
| `status` | `UserStatus` = `PENDING` | `PENDING` \| `ACTIVE` \| `REJECTED` |
| `rejectionReason` | `String?` | Shown on the login attempt and in the blocked-access screen |
| `createdAt` / `updatedAt` | `DateTime` | |

Back-relations: `createdEvents`, `reviewedEvents`, `createdRecords`, `modifiedRecords`.

### Invariants

- Email is unique and normalized, so case-variant duplicates are impossible.
- Password minimum 8 characters at signup (not re-checked at login).
- Only `ACTIVE` users pass `requireAuth()`. `PENDING` and `REJECTED` users get a 403 with
  an explanatory message and see a blocked-access screen instead of the app shell.
- Signup **always** produces `ORGANIZER` / `PENDING`. Role and status are never
  client-settable.
- Only `PENDING` organizers can be reviewed — `PATCH /api/admin/organizers/[id]` returns
  409 for anything else.
- Rejection requires a non-empty reason.

### Who can create / update / delete

| Operation | Who |
|---|---|
| Create (organizer) | Anyone, via public signup — rate-limited to 5 per IP per 10 min |
| Create (admin) | **Nobody through the app.** Seed or direct database edit only |
| Approve / Reject a PENDING organizer | ADMIN, via the dashboard |
| Change password | **Nobody.** No reset flow, no change-password screen |
| Deactivate / delete a user | **Nobody through the app.** Database edit only |

`GET /api/admin/organizers` lists **only `PENDING` organizers**. There is no screen
anywhere that lists active organizers or admins.

### Who depends on it

The auth session (revalidated against this row on every protected request), event
ownership, event review stamps, record audit actors, the admin dashboard's approval
queue, and the sidebar identity block.

---

## Enums

| Enum | Values | Used by |
|---|---|---|
| `UserRole` | `ORGANIZER`, `ADMIN` | authorization |
| `UserStatus` | `PENDING`, `ACTIVE`, `REJECTED` | login gate, admin queue |
| `EventStatus` | `DRAFT`, `PENDING`, `APPROVED`, `REJECTED` | event lifecycle |
| `AttendanceMethod` | `MANUAL`, `SCANNED` | provenance on `Record`; not currently surfaced in any UI |
| `YearLevel` | `YEAR_1..YEAR_4`, `GRADE_11`, `GRADE_12` | student validation; a `Group` category that never joins to students |
| `SchoolLevel` | `SHS`, `COLLEGE` | student validation, `COLLEGE`/`SHS` event scoping |
| `EventCategory` | `ALL`, `COLLEGE`, `SHS`, `DEPARTMENT`, `HOUSE`, `STRAND`, `PROGRAM`, `SECTION`, `YEAR` | **shared** between `Event.category` and `Group.category` — `ALL`/`COLLEGE`/`SHS` are meaningful only on events |

---

## Derived concepts (no table backs these)

### Eligibility

"Is this student invited to this event." Computed at read time by
`buildEventStudentFilter(event)`. Six call sites. Not stored, not snapshotted.

### Attendance status

`"present" | "absent"` on `StudentAttendanceRecord`. `present` = an eligible student has a
`Record`; `absent` = an eligible student has none. Absence has no row.

### Attendance rate

`present / eligible`, formatted to one decimal, computed independently in four places
(attendance header, reports summary, report page, print page). All four show `—` or `0`
when `eligible` is 0.

### `changed`

A transient boolean added to record create/update responses. `false` means the request
was a no-op (already timed in, or already timed out) so the UI can warn instead of falsely
confirming. Not persisted.

### `organizerName`

A denormalized display field the event endpoints add from `createdBy.name` so the UI need
not show a raw user id.

---

## Business rules, consolidated

Ranked by how much damage getting them wrong would do.

1. **One attendance record per student per event.** Re-scanning never creates a second row
   and never overwrites a timestamp.
2. **Time-out requires a prior time-in.** No exceptions, on any path.
3. **Attendance is only writable on APPROVED events.** Approval is the only gate — there
   is deliberately **no start/end time-window restriction**.
4. **Approval makes an event shared.** Any active user can scan for any approved event;
   only the owner (or an admin) can edit it, delete it, toggle its mode, or delete its
   records.
5. **Present is always counted among the currently eligible**, so attendance can never
   exceed 100%, and a report's rows always agree with its totals.
6. **Eligibility is evaluated at read time**, which means roster edits retroactively
   change past events' reports. There is no historical snapshot.
7. **An event with attendance cannot be deleted.**
8. **Every group reference is category-checked** on both the student and event write
   paths.
9. **Organizer accounts require admin approval**; rejected accounts see the reason.
10. **Role and status come from the database on every request**, so revoking access is
    immediate.
11. **Students never authenticate.** A QR code is a bare student ID.
12. **Group vocabulary is admin-managed.** No section exists until someone creates it —
    in Settings → Groups, or in the seed. It is data, not code.

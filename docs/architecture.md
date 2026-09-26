# Architecture

**Audience:** you, six months from now, about to change how attendance works.

This document describes how this specific application is actually built — not how
Next.js apps are built in general. It is written against the state of `main` at
commit `a3896e8`.

---

## 1. What the system is

A single Next.js application that lets a school run event attendance:

- **Organizers** create events in a calendar, scope them to parts of the student
  body, submit them for approval, then record attendance by QR scan or manual entry.
- **Admins** approve/reject organizer signups and event submissions.
- **Students** are a roster, not users. They never log in. A student's identity for
  attendance purposes is their 11-character student ID, encoded in a QR code.

There is one Node process, one PostgreSQL 17 database, and no background jobs,
queues, caches, or external services.

---

## 2. High-level architecture

```
Browser (organizer laptop / phone on the LAN)
  │
  │  HTTP  (Next.js dev or `next start`, single process)
  ▼
┌───────────────────────────────────────────────────────────────┐
│ Next.js 15 App Router                                          │
│                                                                │
│  app/(auth)/*       client pages: login, signup, logout        │
│  app/(main)/*       client pages: dashboard, calendar,         │
│                     students,    attendance, reports, settings │
│    └─ two server components (see §5)                           │
│                                                                │
│  app/api/**/route.ts   ALL mutations and nearly all reads      │
│      └─ requireAuth() → Prisma → JSON { success, data }        │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
Prisma Client 7  ──  PrismaPg (pg Pool)  ──  PostgreSQL 17
```

Key structural facts:

- **There is no `middleware.ts`.** Route protection is enforced *inside each API
  route handler*, not at the edge. The `(main)` layout's redirect is cosmetic.
- **There are no Server Actions.** Every write is `fetch` → `/api/...` route handler.
- **Almost everything is a client component.** Pages fetch through TanStack Query.
- The only exceptions that touch Prisma directly from a page are documented in §5.

### Stack

| Concern | Choice |
|---|---|
| Framework | Next.js `15.5.20`, App Router, React 19, Turbopack for dev *and* build |
| Language | TypeScript, `strict: true`; path alias `@/*` → repo root |
| ORM | Prisma 7 with the `PrismaPg` **driver adapter** over a `pg` pool |
| DB | PostgreSQL 17 |
| Server state | TanStack Query v5 |
| Tables | TanStack Table v8 |
| Forms | react-hook-form + Zod v4 resolvers |
| UI | Tailwind v4 + shadcn/ui (vendored under `globals/components/shad-cn`) |
| Calendar | FullCalendar (dayGrid + timeGrid + interaction) |
| QR | `@yudiel/react-qr-scanner` (read), `react-qr-code` (render) |
| CSV | `react-papaparse` (parse on import, `jsonToCSV` on export) |
| Package manager | pnpm (via corepack) |
| Tests | **none** — there is no test framework, no test files, and no CI config |

---

## 3. Directory structure and responsibilities

Three top-level source roots. The split is by *ownership*, not by technical layer.

```
app/                    Routing only: pages + API route handlers
  (auth)/               Unauthenticated pages (login, signup, logout)
  (main)/               Authenticated shell (sidebar + client auth gate)
  api/                  All HTTP endpoints

features/               Feature-owned UI. Nothing here is imported cross-feature
  attendance/           …except attendance/components/DataCard, which reports reuse
  auth/
  calendar/
students/
  reports/

globals/                Everything shared
  components/shad-cn/   Vendored shadcn primitives — treat as third-party
  components/shared/    App-level shared components (Sidebar, DataTable, ComboBox…)
  constants/groups.ts   THE school vocabulary (departments/programs/strands/houses)
  contexts/             AuthContext, ConfirmModalContext, SidebarContext
  hooks/                TanStack Query hooks — one per domain (useEvents, useRecords…)
  libs/prisma.ts        Prisma singleton
  schemas/              Zod schemas shared between client forms and API routes
  types/                Domain types, mostly `PrismaX & { … }`
  utils/                auth, rate limiting, eligibility filter, formatting, errors

prisma/                 schema.prisma, migrations/, seed.ts
public/                 logos + student_import_template.csv
```

A useful rule of thumb: **if a change affects who can do what, it lives in
`globals/utils/auth.ts` plus one API route.** If it affects who *counts* as an
attendee, it lives in `globals/utils/buildEventStudentFilter.ts`.

---

## 4. Request / data flow

The standard path for every screen:

```
Client component
  └─ globals/hooks/useX.ts          (TanStack Query hook; key from queryKeys.ts)
       └─ globals/utils/api.ts      fetchApi<T>()  — throws ApiError on !ok or !success
            └─ /api/... route.ts
                 ├─ requireAuth()            → 401/403 as AuthError
                 ├─ Zod parse of body/query  → 400
                 ├─ authorization asserts    → 403/409 as AuthError
                 ├─ prisma …
                 └─ NextResponse.json(ok(data))   or  respondWithError(error)
```

### The API envelope

Every route returns the same shape (`globals/utils/api.ts`):

```ts
{ success: true,  data: T }
{ success: false, message: string, code?: string }
```

`fetchApi` unwraps `data` and throws `ApiError(message, status, code)` otherwise, so
hooks never see the envelope. Error codes actually used in branching:
`NO_TIME_IN`, `EVENT_HAS_RECORDS`, `INVALID_GROUPS`, `DUPLICATE`, `FORBIDDEN`,
`UNAUTHORIZED`, `INACTIVE_USER`, `INVALID_STATUS`.

### The `/api/reports/*` namespace

Reporting has its own namespace rather than extending the endpoints the live
attendance screen polls. `GET /api/events/[eventId]/stats` and
`GET /api/events/[eventId]/records` are deliberately left alone: the attendance
page is the one screen operated under time pressure, and reshaping its payloads to
serve reports would put the riskiest change on the least forgiving surface.

| Route | Returns | Builder |
|---|---|---|
| `GET /api/reports/events/[eventId]` | totals (eligible/present/late/absent/attended/noTimeout/scanned/manual), rate, arrival buckets, per-section breakdown, one row per eligible student | `globals/utils/eventReport.ts` |
| `GET /api/reports/overview?from&to&category` | per-event rates for a date range, range totals, best/worst, per-category averages | `globals/utils/reportsOverview.ts` |

Both builders are `server-only`; their payload types live in
`globals/types/reports.ts` so the client hooks can import them without crossing
that boundary. `buildEventReport` is also called directly by the print page — see
`conventions.md` §"How do I build a printable report?".

Two things to know before changing either:

- **The overview covers APPROVED events only.** Attendance is only writable on
  approved events, so a draft has no records by construction and would report as 0%
  turnout for an event that never ran. It also makes authorization trivially safe:
  approved events are readable by every active user, so the filter is strictly
  narrower than any caller's visibility and cannot leak another organizer's draft.
- **`overview` batches by eligibility scope, not by event.** Events sharing a
  filter (every `ALL` event, every event scoped to the same groups) share one
  student count and one grouped record query, so the cost tracks distinct scopes
  rather than event count. The range is Zod-validated and capped at 366 days.

### Error funnel

`globals/utils/httpError.ts::respondWithError` is the single catch-all:
`AuthError` → its own status; `ZodError` → 400 "Invalid request payload.";
anything else → `handlePrismaError` (P2002→409, P2025→404, P2003→400, P2000→400,
default→500). **Note:** three routes bypass this funnel and call `handlePrismaError`
directly (`/api/groups/byCategory/[category]`, `/api/stats/student-counts`, and the
error path of `/api/groups`).

### Query keys and invalidation

`globals/utils/queryKeys.ts` is the single key factory. Two conventions matter:

- `records.fromEventPrefix(eventId)` deliberately omits the `includeAbsent` flag so
  one invalidation refreshes **both** the live present-only table and the report's
  present+absent variant.
- Roster mutations call `invalidateStudentDependents`, which invalidates students,
  student stats, **events**, and **records** — because changing the roster changes
  event eligibility, and therefore every stat and report. This is a deliberate
  over-invalidation, not an accident.

### Polling

There is no websocket. Multi-device freshness comes from opt-in polling controlled
by a `live` flag on three hooks (`useFetchEvent`, `useStatsOfEvent`,
`useAllRecordsFromEvent`): `staleTime: 5s`, `refetchInterval: 8s`,
`refetchIntervalInBackground: false`. Only the **attendance page** passes `live: true`.
Report pages deliberately do not poll. Global defaults (`QueryProvider`):
`staleTime 60s`, `refetchOnWindowFocus: false`, `retry: 1`.

---

## 5. Client / server responsibilities

**Client owns:** all page rendering, all form state, all table sorting/filtering/
pagination (except nothing — there is no server-side pagination on `main`), session
display state, toasts, and confirmation dialogs.

**Server owns:** authentication, all authorization, all validation that matters,
eligibility computation, scan rules, and stats arithmetic.

Every client-side permission check (hiding a Delete button, rendering a read-only
drawer) has a server-side counterpart. The client checks exist so users aren't shown
controls that would 403 — they are not the security boundary.

### The two server components

1. **`app/(main)/students/select-category/page.tsx`** — trivial; reads `searchParams`
   and picks a selection board or redirects. No data access.
2. **`app/(main)/reports/events/[id]/print/page.tsx`** — the important one. It queries
   Prisma *directly*, bypassing the API layer entirely, and therefore carries its own
   copy of the auth logic (`getFreshAuthSession` + status check + a hand-written
   visibility check). It also computes its own eligible/present counts and its own
   section grouping. **If you change event visibility rules or eligibility, this file
   will not follow automatically.**

---

## 6. Authentication flow

Custom, cookie-based. No NextAuth, no JWT library.

### Cookie format

Cookie name `event-attendance-auth`:

```
base64url( JSON.stringify({ session, exp }) ) + "." + HMAC_SHA256(payload, AUTH_SECRET)
```

- `session` = `{ id, name, email, role, status, rejectionReason }`
- `exp` = unix seconds, now + 7 days — checked server-side, so stripping the browser
  `Max-Age` does not extend the session
- Flags: `httpOnly`, `sameSite: "lax"`, `path: "/"`, `maxAge` 7 days,
  and **`secure: process.env.NODE_ENV === "production"`** (see §16 — this matters
  enormously for the LAN deployment)
- Signature compared with `timingSafeEqual`

### `AUTH_SECRET`

`globals/utils/auth.ts::getAuthSecret()` requires ≥16 chars. In production a missing
or short secret **throws**. Outside production it silently falls back to
`"dev-only-insecure-secret"`. The checked-in `.env` contains only `DATABASE_URL`, so
locally the app is running on the dev fallback secret today.

### Passwords

`globals/utils/password.ts` — scrypt, stored as `scrypt:<saltHex>:<keyHex>`, 64-byte
key, `timingSafeEqual` comparison. `verifyPassword` **also accepts a stored plaintext
value** by direct string comparison, and the login route rehashes-and-saves on
success. This exists so the seed (which writes plaintext `"password"`) works, and so
any legacy row is upgraded on first login. It is intentional, not a bug — but it means
a plaintext password in the DB is a valid credential.

### Login sequence

`POST /api/auth/login` → rate-limit key `login:<ip>:<email>` (10 per 5 min) →
lookup by normalized lowercase email → verify → rehash if legacy → reject `PENDING`
(403) and `REJECTED` (403, echoes `rejectionReason`) → `setAuthSession` → return the
user. `AuthContext.login` stores the returned user in React state.

### Session read

- Client: `AuthContext` calls `GET /api/auth/session` **once on mount**, with
  `cache: "no-store"`, and never throws (a dead server resolves to "logged out"
  rather than hanging the app on "Checking access…").
- Server: `requireAuth()` calls `getFreshAuthSession()`, which verifies the cookie
  **and then re-reads the `User` row**. Role, status, and name always come from the
  database, so an admin demoting or rejecting someone takes effect on that user's very
  next request — not at cookie expiry. The cookie is an identity claim, not a cache.

### Logout

Fail-closed. `POST /api/auth/logout` clears the cookie; the client only clears local
state and navigates if the server confirmed. A failed logout surfaces a retry rather
than showing a logged-out UI over a live cookie.

### Signup

`POST /api/auth/signup` — rate-limit `signup:<ip>` (5 per 10 min), email lowercased,
password ≥8 chars, always creates `role: ORGANIZER, status: PENDING`. **There is no
way to create an ADMIN through the application.** Admins exist only via the seed or a
direct database edit. There is also **no password reset flow**.

---

## 7. Authorization model

Two axes: `User.role` (`ORGANIZER` | `ADMIN`) and `User.status`
(`PENDING` | `ACTIVE` | `REJECTED`). `requireAuth()` enforces `ACTIVE` for every
protected route, so PENDING/REJECTED users are effectively locked out of everything.

### The four primitives (`globals/utils/auth.ts`)

| Helper | Rule |
|---|---|
| `requireRole(user, allowed)` | role must be in the list |
| `assertEventOwnership(event, user)` | **ADMIN always passes**; otherwise `event.createdById === user.id` |
| `assertEventVisibility(event, user)` | **ADMIN always passes**; otherwise owner **or** `status === "APPROVED"` |
| `assertEventStatus(event, allowed)` | 409 `INVALID_STATUS` if the event isn't in an allowed state |

The single most important consequence: **an APPROVED event is visible to every active
user.** Approval is what makes an event shared. Organizers can read, take attendance
on, and report on *any* approved event — but can only edit, delete, toggle timeout
mode on, or delete records from events **they created**.

### Route guard matrix

| Route | Guard |
|---|---|
| `POST /api/auth/login`, `/signup` | public + in-memory rate limit |
| `POST /api/auth/logout` | none (clears cookie) |
| `GET /api/auth/session` | none (returns the session or `null`) |
| `GET /api/admin/organizers` | `requireAuth` + `requireRole ADMIN` |
| `PATCH /api/admin/organizers/[id]` | `requireAuth` + `requireRole ADMIN` |
| `GET /api/events` | `requireAuth`; ADMIN sees all, organizer sees own ∪ APPROVED |
| `POST /api/events` (create/update) | `requireAuth`; update → `assertEventOwnership` + editable-status check |
| `DELETE /api/events` and `DELETE /api/events/[id]` | `requireAuth` + `assertEventOwnership` + refuses if any record exists |
| `GET /api/events/[id]` | `requireAuth` + `assertEventVisibility` |
| `PATCH /api/events/[id]` | SUBMIT → ownership + DRAFT; APPROVE/REJECT → `requireRole ADMIN`; edit → ownership + editable status |
| `POST /api/events/[id]/timeout` | `requireAuth` + `assertEventOwnership` + must be APPROVED |
| `GET /api/events/[id]/stats` | `requireAuth` + `assertEventVisibility` |
| `GET /api/events/[id]/records` | `requireAuth` + `assertEventVisibility` |
| `POST /api/records` | `requireAuth` + `assertEventVisibility` + must be APPROVED |
| `GET /api/records` | `requireAuth` + `assertEventVisibility` |
| `PATCH /api/records/[id]` | `requireAuth` + `assertEventVisibility` + APPROVED |
| `DELETE /api/records/[id]` | `requireAuth` + **`assertEventOwnership`** (owner or admin only) |
| `GET/POST /api/students`, `GET/DELETE /api/students/[id]` | `requireAuth` only — **any active user may read and mutate the roster** |
| `POST /api/bulk-import/students` | `requireAuth` only |
| `GET /api/groups` | **no auth** |
| `GET /api/groups/byCategory/[category]` | **no auth** |
| `GET /api/stats/student-counts` | **no auth** |
| `GET /reports/events/[id]/print` (page) | own `getFreshAuthSession` + ACTIVE + hand-rolled visibility check |

The broad roster permission is a **documented deliberate policy** (see the comment in
`app/api/students/route.ts`) — organizers are expected to fix roster data during an
event. The three unauthenticated `GET`s expose the school's group vocabulary and
aggregate student counts; they expose no personally identifying data.

---

## 8. Database architecture

### Connection

`globals/libs/prisma.ts` builds one `PrismaClient` over `PrismaPg` on a `pg`
`Pool` (max 8 connections per process), with the connection string resolved by
`globals/libs/dbConfig.ts::getRuntimeDatabaseUrl()`. It **throws on boot unless
`DATABASE_URL` is a PostgreSQL URL** — deliberately, so a misconfigured
deployment can't silently run against a local file or in-memory database and
lose every write on restart. Non-local hosts get verified TLS (`sslForUrl`).
The client is cached on `globalThis` outside production so dev HMR doesn't leak
connections.

`DATABASE_URL` is the pooled runtime endpoint; `DIRECT_URL` is the direct
non-pooled endpoint for migrations and maintenance (the two may coincide in
local development, never via a transaction pooler). `prisma.config.ts`
resolves the migration URL the same way and likewise refuses
non-PostgreSQL URLs.

### Five models

`Event`, `Student`, `Record`, `User`, `Group`. Full field-by-field treatment is in
[`domain-model.md`](./domain-model.md). Structurally:

- **`Group` is the universal taxonomy table.** One table holds departments, programs,
  strands, houses, sections, and year-level groups, discriminated by
  `category: EventCategory`. It joins to `Student` (`_GroupToStudent`) *and* to
  `Event` (`_EventGroups`). Student membership and event scoping therefore speak the
  same vocabulary — that is the central design idea of the schema.
- **`Record` is the attendance fact**, unique on `(eventId, studentId)`. Nullable
  `timein` / `timeout`.
- Referential actions: `Record → Event` and `Record → Student` are **RESTRICT** on
  delete; `Event → User` and `Record → User` (audit actors) are **SET NULL**;
  both join tables are **CASCADE**.

### Indexes

Added deliberately in `20260720235052_...` after measurement:

```
Event:   [status], [createdById], [status, start]
Student: [updatedAt, id], [lastName, firstName, id],
         [schoolLevel, yearLevel, lastName, firstName, id]
Group:   [category], unique [slug]
Record:  unique [eventId, studentId]
```

Group-membership filtering goes through the join table and is intentionally *not*
indexed on `Student` — the schema comment says that belongs on the join table if it
ever needs tuning.

### Migrations

One PostgreSQL baseline migration (`20260926075853_init_postgres_baseline`,
`provider = "postgresql"` in `migration_lock.toml`). The SQLite history was
squashed, not replayed, and is archived read-only under
`prisma/migrations-sqlite-archive/`. The baseline absorbed a destructive
history along the way — `20260401135507_overhaul_schema` dropped
`Student.collegeProgram/department/departmentSlug/house/houseSlug/shsStrand/status`
and `Event.includedGroups` (a JSON column) in favour of the `Group` relations, and
`20260408082631` dropped `Student.section`. Several stale files in `features/` still
reference those removed columns (see §14).

### PostgreSQL notes (SQLite → Postgres migration landed, issue #51)

**In your favour (carried over unchanged):**
- Domain reads and writes go through the Prisma Client query builder, which
  generates the Postgres dialect. All enums are real Prisma enums and map to
  native Postgres enums.
- IDs are `cuid()` strings, not autoincrement integers.
- `DateTime` fields carry no SQLite-only semantics.
- The only database coupling in application code is the adapter construction
  in `globals/libs/prisma.ts` and `prisma/seed.ts` (now `PrismaPg` over a `pg`
  pool), plus connection rules in `globals/libs/dbConfig.ts`.

**Postgres-specific behaviour to know:**
- Targeted raw SQL exists, and only for Postgres mechanics: the guarded-write
  protocol issues `SELECT ... FOR SHARE` and `pg_advisory_xact_lock` calls
  (`globals/utils/pgLocks.ts`), and the operator-console identity check reads
  `current_database()`/`version()`. No domain query is hand-written SQL.
- Case-sensitivity differs from SQLite: Postgres `LIKE` is case-sensitive, so
  the human name/ID search passes `mode: "insensitive"`
  (`globals/utils/audiencePreview.ts`). All other text search still happens
  client-side (`globals/utils/fuzzySearch.ts`).
- Concurrency follows the guarded-write protocol plus Repeatable Read
  snapshots — see §12.

---

## 9. Event lifecycle

```
                       ┌──────────────────────────────────┐
                       │  organizer edits a REJECTED event│
                       │  → status resets to DRAFT        │
                       ▼                                  │
  (create) ──► DRAFT ──SUBMIT──► PENDING ──APPROVE──► APPROVED
                 ▲                  │                     ▲
                 │                  └──REJECT──► REJECTED ─┘
                 └───────────────── (edit) ────────────────┘
                                                  (admin may APPROVE directly)
```

Precise rules as implemented in `app/api/events/[eventId]/route.ts`:

| Action | Who | Allowed source states |
|---|---|---|
| create | any active user | — (always created as `DRAFT`, `createdById = user.id`) |
| edit content | owner or admin | organizer: `DRAFT`, `REJECTED` · admin: any |
| `SUBMIT` | owner (admin bypasses ownership) | `DRAFT` only |
| `APPROVE` | ADMIN only | `PENDING`, `REJECTED`, `APPROVED` — **`DRAFT` is deliberately not approvable**, so approval always reviews a submitted event |
| `REJECT` | ADMIN only | `PENDING` only; requires a non-empty `reason` |
| delete | owner or admin | any state, **but refused with 409 `EVENT_HAS_RECORDS` if any attendance row exists** |

Side effects worth knowing:

- `SUBMIT` clears `reviewedById`, `reviewedAt`, `rejectionReason`.
- A **non-admin** editing a `REJECTED` event triggers `rejectionReset`: status → `DRAFT`
  and the whole review is cleared. An admin editing a rejected event does *not* trigger
  this.
- `APPROVE` stamps `reviewedById` / `reviewedAt` and clears `rejectionReason`.
- Editing is locked for organizers on `PENDING` and `APPROVED` events; the drawer
  renders read-only in those states specifically so a save can't 409.

There are **two** endpoints that create/update events — `POST /api/events` (used by the
event drawer and by calendar drag/resize) and `PATCH /api/events/[eventId]` (used for
workflow actions and also capable of content edits). They implement the same ownership
and status rules independently. **Change one, change the other.**

### The calendar's role

`features/calendar/utils/calendar.ts::canEditEvent` mirrors the server rule
(admin, or own DRAFT/REJECTED) to set FullCalendar's per-event `editable` flag, so
drag/resize is only offered where it will succeed. On failure the handlers call
`info.revert()` and toast — the calendar never keeps an optimistic position the server
rejected. Drag/resize goes through `toEventForm`, which converts the `Group[]` relation
back to an id array because the save API validates ids.

---

## 10. Attendance lifecycle

### Eligibility — `globals/utils/buildEventStudentFilter.ts`

This one function decides who counts for an event, and it is used by **six** call sites
(records POST, records GET, event records list, event stats, students GET, and the
print page). Learn it first.

```ts
category === "ALL"      → {}                                  // every student
category === "COLLEGE"  → { schoolLevel: "COLLEGE" }
category === "SHS"      → { schoolLevel: "SHS" }
otherwise               → { groups: { some: { slug: { in: includedGroupSlugs } } } }
```

Two behaviours to hold in your head:

1. If a scoped event somehow has **zero** `includedGroups`, the `if (length > 0)` guard
   leaves the filter empty and the event matches **every student in the school**.
   `validateEventGroupIds` prevents creating such an event through the API, so this only
   matters for rows written outside the app.
2. **`YEAR`-category events match nobody.** Students are never connected to `YEAR`
   groups — year level lives on the `Student.yearLevel` enum column, and neither the
   student write path (`validateStudentGroupSlugs`, which only handles
   section/house/department/program/strand) nor the seed ever creates that link. The
   seed *does* create `YEAR` `Group` rows, so the category is selectable in the event
   drawer. See §15.

### Scan rules — `POST /api/records`

The event's `isTimeout` boolean is a **global mode switch for the whole event**, not a
per-student state. Everyone scanning that event is recording time-ins, or everyone is
recording time-outs.

```
POST /api/records { eventId, studentId, method }
  requireAuth
  event must exist, be visible, and be APPROVED
  student must exist AND pass buildEventStudentFilter(event)   → else 404
                                                                 "Student is not
                                                                  included in the event."
  if event.isTimeout:
      no record, or record.timein is null  → 409 NO_TIME_IN
      record.timeout is null               → updateMany WHERE timeout IS NULL
                                             (changed = rowsAffected > 0)
      record.timeout already set           → changed = false
  else:
      no record   → create { timein: now, recordedById: user.id }   (201)
                    P2002 on race → fall through, return the winner's row untouched
      timein null → updateMany WHERE timein IS NULL                 (200)
      else        → changed = false                                 (200)
```

Every write is a **compare-and-set** (`updateMany` with the null column in the `WHERE`),
so two devices scanning the same student simultaneously converge on one timestamp
instead of overwriting each other. The `changed` flag in the response is what lets the
UI say "already recorded" instead of falsely reporting success — do not drop it.

**There is no time-window check.** Attendance is writable on any approved event
regardless of `start`/`end`. This is explicitly documented in the route as intentional:
organizers set up early and make late corrections, and approval is the only gate.

### Manual correction — `PATCH /api/records/[recordId]`

Same rules, same compare-and-set, same `changed` flag, but it only ever *fills a missing
timestamp*. It never overwrites an existing one, and it does not require ownership —
any active user can complete a record on a visible approved event.

### Deletion — `DELETE /api/records/[recordId]`

Requires **event ownership or admin**. Hard delete, no tombstone. The only trace is a
`console.info("[audit] …")` line on the server's stdout. In the UI this action is
labelled "Mark as Absent", and the client hides the control when `canManage` is false.

### Audit trail

`Record.recordedById` is stamped on create; `Record.lastModifiedById` on every
compare-and-set update. Both are `SET NULL` if the user is deleted. **Deletion is not
recorded in the database.**

---

## 11. QR attendance flow

```
features/attendance/components/
  Scanner.tsx        camera-off placeholder; next/dynamic({ ssr:false }) loads →
  ScannerCamera.tsx  @yudiel/react-qr-scanner, ~170KB, only after "Open Camera"
```

- The QR payload is **the raw 11-character student ID and nothing else**
  (`StudentQRModal` renders `<QRCode value={student.id} />`).
- `ScannerCamera` debounces identical values within 1000 ms and passes `paused={isPending}`
  so the camera stops while a record is saving.
- `AttendanceSection.processScan` then does **two** sequential requests:
  1. `GET /api/students?eventId=…&studentId=…` — resolves the student *and* enforces
     eligibility (404 if not eligible), then displays them
  2. `POST /api/records` — writes the attendance
- Toast wording branches on `selectedEvent.isTimeout` and on the response's `changed`.

The attendance page holds only `selectedEventId` in state and derives the whole event
object from `useFetchEvent(id, live=true)`. That is deliberate: the header, the timeout
toggle, the manual actions, and the records table all read the *same polled* event, so a
mode change made on another device propagates within ~8 seconds instead of leaving one
device on a stale copy.

**Runtime dependency:** `getUserMedia` requires a *secure context*. Browsers treat
`localhost` as secure but **not** `http://192.168.x.x`. See §16.

---

## 12. Concurrency assumptions

- **Postgres MVCC plus the guarded-write protocol.** Attendance writes
  (`features/attendance/server/recordAttendance.ts`) run in a bounded
  transaction: a shared roster-state advisory lock (freezes eligibility without
  making different-student scans exclusive with each other), `SELECT ...
  FOR SHARE` on the event row (scans linearize against mode changes), then an
  exclusive transaction-scoped advisory lock on the `(eventId, studentId)`
  pair — followed by the long-standing compare-and-set `updateMany` plus the
  `@@unique([eventId, studentId])` constraint. The whole transaction retries
  once on serialization/deadlock errors only.
- The bulk student import is a single all-or-nothing interactive transaction
  (explicit `timeout: 120s`, `maxWait: 30s`) that takes the **exclusive**
  roster lock; attendance takes the shared form, so the two block each other.
  **Do not run a bulk import while an event is being scanned.**
- Reads that must be self-consistent (event report, attendance progress,
  exports, audience preview) run at **Repeatable Read** so concurrent writes
  can't skew totals mid-read.
- The timeout-mode endpoint takes an **explicit desired state** (`{ isTimeout: true }`),
  not a blind toggle, inside a transaction holding `FOR UPDATE` on the event
  row — so two operators both pressing "start time-out" converge instead of
  cancelling out.
- Rate limiting (`globals/utils/rateLimit.ts`) is an in-process `Map`, fixed-window,
  with opportunistic cleanup above 10,000 keys. It is correct for one process only, and
  it keys off `x-forwarded-for` falling back to the literal string `"local"` — on a LAN
  without a proxy, **every client shares the `"local"` bucket**.

---

## 13. Important shared utilities and components

| File | Why it matters |
|---|---|
| `globals/utils/buildEventStudentFilter.ts` | The eligibility rule. Six call sites. Change here changes every count in the app. |
| `globals/utils/auth.ts` | Session format, all four authorization primitives. |
| `globals/constants/groups.ts` | The school vocabulary: departments, programs, strands, houses, section-naming convention, `labelForGroup`. Forms, event pickers, and the seed all derive from it. |
| `globals/utils/studentGroups.ts` | `validateStudentGroupSlugs` — every slug must exist **and** match its column's category. Shared by the single-student and bulk-import write paths so both enforce identical integrity. |
| `globals/utils/eventGroups.ts` | `validateEventGroupIds` — event group ids must exist and match the event's category. |
| `globals/utils/queryKeys.ts` | The key factory; see the `fromEventPrefix` note in §4. |
| `globals/utils/api.ts` | The envelope + `fetchApi`. |
| `globals/components/shared/dataTable/DataTable.tsx` | The shared table. Supports client mode *and* a server-driven `manual` mode. **On `main` nothing uses `manual` mode** — it was built for a server-paginated roster that hasn't landed here yet. |
| `globals/hooks/useDataExport.ts` | CSV export. Escapes leading `= + - @ \t \r` to defeat spreadsheet formula injection, and lazy-imports `react-papaparse`. |
| `globals/contexts/ConfirmModalContext.tsx` | `useConfirm()` returns a promise — used for every destructive action. |
| `globals/utils/formatting.ts` | `fullName` (no double space when the middle name is absent), `formatSection`, `readableDate`. |

### DataTable pagination, specifically

`autoResetPageIndex` is turned **off** in client mode. That is not an oversight: the
attendance table polls every 8 seconds and the automatic reset would bounce the operator
back to page 1 mid-event. The behaviours it would have provided are re-added explicitly:
a `useEffect` clamps `pageIndex` when the row set shrinks, a `resetKey` prop resets to
page 1 when the *data set identity* changes (e.g. selecting a different event), and the
sort/filter/search handlers reset the page themselves.

---

## 14. Important invariants

Break any of these and the system starts lying about attendance.

1. **One `Record` per (event, student).** Enforced by `@@unique([eventId, studentId])`.
   The create path is written to tolerate the P2002 race rather than avoid it.
2. **A `timeout` is never set without a `timein`.** Enforced on both the POST and PATCH
   paths (409 `NO_TIME_IN`).
3. **A timestamp is written once.** Every update is conditional on the column being
   `NULL`. Nothing in the API overwrites an existing `timein` or `timeout`.
4. **Attendance only exists on `APPROVED` events.** Checked on record create and update.
5. **Only currently-eligible students appear in counts and rows.** Stats count present
   *among* eligible; the records endpoint filters records by the same eligibility
   predicate. This is what keeps attendance from exceeding 100%.
6. **Rows and totals derive from the same predicate.** `?includeAbsent=true` starts from
   the eligible set and marks each student present/absent, so a report's rows always sum
   to its header numbers.
7. **An event with attendance cannot be deleted.** 409 `EVENT_HAS_RECORDS`.
8. **A student's group slug must match the category of the column referencing it.** A
   house slug cannot be smuggled into the section column.
9. **An event's group ids must belong to the event's category.**
10. **Role and status always come from the database on every protected request**, never
    from the cookie payload.
11. **`Event.isTimeout` is event-global**, not per-student.

---

## 15. Important assumptions

These are baked into the code. They are not necessarily wrong — but they *are*
assumptions, and they are the things that surprise you six months later.

1. **Reports are "current state", not historical snapshots.** Because eligibility is
   recomputed from the roster at read time, editing a student's groups (or importing a
   corrected roster) **retroactively changes the attendance report of an event that
   already happened**. A student moved out of a section vanishes from that event's
   report even though they were scanned. There is no snapshot of who was eligible at
   event time. This is the single most consequential assumption in the system.
2. **Approval implies sharing.** Any active organizer can operate any approved event.
   There is no per-event staff assignment.
3. **Students never authenticate.** A QR code is a bare student ID — anyone holding it
   can be scanned in. There is no anti-passback beyond one-scan-per-phase.
4. **`Group` rows are created only by the seed.** There is **no API and no UI to create
   a Group.** Consequently a student import can only reference sections/houses/etc.
   that already exist as `Group` rows, or the whole batch is rejected with
   `Unknown group(s): …`. See §16 for why this matters before the beta.
5. **The group vocabulary is stable within a school year.** Section names live only as
   `Group` rows; `globals/utils/eventValidation.ts` explicitly notes sections can't be
   validated against constants because they change annually.
6. **A `YEAR`-scoped event will match zero students** (see §10). The category is
   offered in the UI.
7. **One server process.** Rate limiting and the Prisma singleton assume it.
8. **Clock trust.** All timestamps are `new Date()` on the server; a wrong laptop clock
   silently produces wrong attendance times.
9. **Timezone.** Everything is stored as `DateTime` and rendered with
   `toLocaleString("en-US")` in the **browser's** timezone. Server and client are
   assumed to be in the same zone — true for a LAN deployment.
10. **Roster size fits in a single response.** No endpoint paginates. `GET /api/students`
    returns every matching student *with their groups*; the manual-attendance search
    downloads the full eligible roster and fuzzy-filters it in the browser
    (`globals/utils/fuzzySearch.ts`). At 2,000+ students this is a multi-megabyte
    payload per event selection.

---

## 16. Deployment model and runtime dependencies

### Intended shape

One laptop runs the Next.js server; phones and other laptops on the same Wi-Fi hit it
by IP. The PostgreSQL 17 database is the entire system of record — a local
container (`docker compose up -d db`) or a managed instance; the server just
points at it.

```bash
corepack pnpm install
# .env must contain DATABASE_URL (+ DIRECT_URL for pooled production) and (for production) AUTH_SECRET
corepack pnpm exec prisma migrate deploy
corepack pnpm build
corepack pnpm start
```

### Environment variables

| Variable | Required | Behaviour |
|---|---|---|
| `DATABASE_URL` | **always** | Pooled runtime PostgreSQL connection string. The app throws on boot unless it is a `postgresql://…` URL — SQLite/file URLs are refused. |
| `DIRECT_URL` | pooled production | Direct (non-pooled, non-pooler) PostgreSQL URL for migrations and maintenance. May coincide with `DATABASE_URL` in local development. |
| `AUTH_SECRET` | production | ≥16 chars, else boot throws in production. Silently falls back to `dev-only-insecure-secret` outside production. **Not present in the committed `.env`.** |
| `NODE_ENV` | set by tooling | Controls the auth-cookie `secure` flag, the Prisma global cache, and the seed guard. |
| `SEED_FORCE` | optional | `"true"` allows the destructive seed to run with `NODE_ENV=production`. |

### Runtime dependencies

- Node
- Network access to the PostgreSQL database (local container or managed instance)
- A camera + a **secure browsing context** for QR scanning
- Google Fonts are fetched at **build** time by `next/font` (Poppins, Geist Mono) — the
  build machine needs network access; runtime does not.

### Two hard HTTP-over-LAN constraints

Both follow from browser platform rules, not from this codebase, and both should be
verified on the real devices before the beta:

1. **The QR camera will not open over `http://<lan-ip>`.** `getUserMedia` requires a
   secure context. `localhost` on the host laptop qualifies; a LAN IP over plain HTTP
   does not. Scanning from a phone therefore needs HTTPS (or a tunnel, or Chrome's
   `unsafely-treat-insecure-origin-as-secure` flag per device).
2. **Login may fail over `http://<lan-ip>` in a production build.** `next start` sets
   `NODE_ENV=production`, which sets the auth cookie's `Secure` flag. Browsers reject
   `Secure` cookies from non-secure origins (localhost excepted). The host laptop would
   work; other devices would appear to log in and then immediately be logged out.

`next.config.ts` also sends `Strict-Transport-Security` on every response. Over plain
HTTP this header is ignored, so it is inert rather than harmful — but if any device ever
reaches the app over HTTPS on that host, HSTS will pin it there for a year.

### Other deployment notes

- Security headers set globally: `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`. A full CSP is
  **intentionally omitted** — the config comment explains that Next's inline runtime
  scripts need nonce plumbing to do it properly.
- `pnpm db:seed` **wipes every table** (records → events → students → groups → users) and
  refuses to run under `NODE_ENV=production` unless `SEED_FORCE=true`.
- Backups are entirely manual: `pg_dump` to a timestamped file (see the
  operator runbook §1). There is no export-everything
  endpoint and no automated backup.
- No database files live in the repo — nothing under `prisma/` is the database itself.
- Build and lint both pass on `main`; `npx tsc --noEmit` is clean.

---

## 17. Known architectural constraints

Things you cannot do without changing the architecture, listed so you don't rediscover
them under time pressure:

1. **No horizontal scaling.** In-memory rate limiting assumes a single process.
2. **No historical eligibility.** See §15.1. Fixing this means snapshotting the eligible
   set at approval or event start — a schema change, not a patch.
3. **No group management UI.** New sections require a database edit or a (destructive)
   reseed.
4. **No admin bootstrap and no password reset.** Both are database-edit operations.
5. **No way to deactivate an active organizer.** `PATCH /api/admin/organizers/[id]`
   rejects anything not in `PENDING` status (409), and `GET /api/admin/organizers` only
   lists `PENDING` users — so once approved, an organizer can only be removed from the
   database directly.
6. **No pagination anywhere on the server.** See §15.10.
7. **No server-side text search.** All filtering is client-side.
8. **Record deletion leaves no database trace** — only a stdout log line.
9. **Duplicated authorization logic** in three places that must be kept in sync:
   `POST /api/events` vs `PATCH /api/events/[eventId]`, and the print page's hand-rolled
   copy of `assertEventVisibility`.
10. **The client `(main)` layout is not a security boundary.** Any new page that reads
    data server-side must authenticate itself, as the print page does.

---

## 18. Where the architecture is intentionally simple

Do not "fix" these without a concrete reason — several are the result of a previous fix,
and the reasoning is recorded in code comments and git history.

- **Custom cookie auth instead of a library.** ~150 lines, signed, expiring, and
  revalidated against the DB on every request. Adding NextAuth would add more surface
  than it removes for two roles.
- **No CSP.** Documented decision in `next.config.ts`; the app renders no untrusted HTML.
- **No optimistic updates on record create/update.** They were *removed* deliberately
  (`5695513`): the cache holds enriched `StudentAttendanceRecord` rows that a mutation's
  input can't reconstruct, and the optimistic write corrupted and duplicated rows in
  timeout mode. Invalidation plus 8-second polling replaced it. Record *deletion* still
  has an optimistic path, because removing by id is reconstructable.
- **Bounded guarded-write transactions on the scan path.** Compare-and-set plus a
  unique constraint plus short advisory/row-share locks keep concurrent scans safe
  without long exclusive holds. (The pre-Postgres design avoided transactions
  entirely to dodge SQLite's single-writer lock; the current design keeps the same
  compare-and-set core inside a short Postgres transaction — see §12.)
- **In-memory rate limiting.** Correct for one process; the file says so.
- **Console-only audit logging.** Enough to answer "who deleted that record" from the
  terminal.
- **Client-side table state.** Fine at current data sizes; the shared `DataTable`
  already has a `manual` (server-driven) mode ready if that changes.
- **Placeholder Settings page and disabled Attendance "Export" button.** Deliberately
  shown as unavailable rather than shipped half-working (`94d6d9e`, `916be6c`).

---

## 19. Maintenance notes: stale and dead code

Found during this pass. None of it breaks the running app, but all of it will mislead
you later. Listed here so a future reader doesn't treat it as live.

| File / symbol | State |
|---|---|
| `globals/utils/eventValidation.ts` | **Dead.** Validates `includedGroups`/`excludedGroups` as *JSON strings* — columns removed in the schema overhaul. Zero importers. Superseded by `eventGroups.ts`. |
| `buildEventStudentFilter.ts::isStudentInEvent` | **Dead.** No importers. Duplicates the eligibility rule against flattened student fields. |
| `globals/hooks/useGroups.ts::useFetchGroupsForStudent` | **Broken and unused.** Calls `/api/groups/forStudent/[id]`, which does not exist. |
| `features/reports/components/EventMetadataCard.tsx` | Renders the raw `event.createdById` under the "Organizer" label, although both event endpoints already return `organizerName`. |
| `globals/components/shared/dataTable/config.ts` | Comment points at a `PAGE_SIZES` constant in `manage-student/page.tsx` that doesn't exist on `main`. |
| `README.md` seeded credentials | Documents `admin@gmail.com / adminama123`; `prisma/seed.ts` actually writes `password`. |
| `features/attendance/constants/eventAttendanceTable.tsx` | A commented-out `status` column block. |

`features/calendar/constants/categoryGroups.ts` also still exports `CATEGORY_GROUPS`,
`EXCLUDABLE_GROUP_TYPES`, and `ExcludedGroup` from the pre-`Group`-table design; only
`EVENT_CHOICES` is imported today. The exclusion feature was built (`ab37085`,
`682d036`) and then superseded by the `Group` relation model — this is leftover, not a
feature waiting to be wired up.

---

## 20. If you're here to change the attendance system

Read, in order:

1. `prisma/schema.prisma` — `Record` and `Group`
2. `globals/utils/buildEventStudentFilter.ts` — who counts
3. `app/api/records/route.ts` — the scan rules and the compare-and-set pattern
4. `app/api/events/[eventId]/records/route.ts` — how rows are produced, and why
   `includeAbsent` exists
5. `app/api/events/[eventId]/stats/route.ts` — why present is counted *among eligible*
6. `globals/utils/auth.ts` — `assertEventVisibility` vs `assertEventOwnership`
7. `features/attendance/components/AttendanceSection.tsx` — the two-request scan path

Then check whether your change also needs to land in
`app/(main)/reports/events/[id]/print/page.tsx`, which queries Prisma directly and does
not go through any of the above.

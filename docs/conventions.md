# Conventions

**Audience:** you, months from now, about to add a feature and wondering "how does
this codebase normally do that."

This document describes the conventions the codebase *actually follows*, verified by
reading the code — not a style guide for how a Next.js app should be built in general.
Where the codebase is inconsistent, that's written down as an inconsistency, not
smoothed over. Where a clearly better convention exists but isn't what's used, it's
called out separately and labeled as such — this document is not asking you to adopt
it, just telling you it's an option.

Companion reading: [`architecture.md`](./architecture.md) (how the system is built),
[`domain-model.md`](./domain-model.md) (what the entities mean),
[`audit/findings.md`](./audit/findings.md) (known issues, so you don't rediscover them
mid-feature).

---

## How do I add a new page?

Create `app/(group)/route-name/page.tsx`. Two route groups exist:
`(auth)` for unauthenticated pages (`login`, `signup`, `logout`) and `(main)` for
everything behind the sidebar (`dashboard`, `calendar`, `students`, `attendance`,
`reports`, `settings`). Almost every page is a **client component** (`"use client"` at
the top) that renders a feature component and wires it to TanStack Query hooks — the
page file itself typically stays thin (see `app/(main)/attendance/page.tsx`,
`app/(main)/calendar/page.tsx`).

**Auth is not enforced by the route group or a `middleware.ts` — there isn't one.**
`app/(main)/layout.tsx` calls `useAuth()` client-side, redirects to `/login` if there's
no session, and blocks rendering with a message if `user.status !== "ACTIVE"`. This is
a **UX convenience, not a security boundary** — it runs after the page has already
been sent to the browser. If a new page under `(main)` needs to guarantee data isn't
exposed to an unauthenticated request, it must check auth itself, server-side.

**Exception — server components.** Two pages break the "thin client page" pattern and
query Prisma directly:
- `app/(main)/students/select-category/page.tsx` — trivial, just reads `searchParams`.
- `app/(main)/reports/events/[id]/print/page.tsx` — the important one. Because it
  bypasses the API layer, it carries its **own copy** of authentication
  (`getFreshAuthSession()`) and authorization (a hand-rolled version of
  `assertEventVisibility`). If you change visibility/eligibility rules elsewhere, you
  must change them here too — nothing enforces they stay in sync (see
  `architecture.md` §17.9).

**If a new page needs to be a server component** (e.g., for the same reason the print
page is — direct Prisma access, or avoiding shipping a library to the client), follow
the print page's pattern exactly: call `getFreshAuthSession()` yourself, check
`status === "ACTIVE"`, and check whatever ownership/visibility rule applies, all before
touching Prisma. Don't assume the layout already did it.

---

## How do I add an API endpoint?

Create `app/api/.../route.ts` exporting `GET`/`POST`/`PATCH`/`DELETE` as named async
functions. Every handler in the codebase, without exception among the authenticated
ones, follows this shape:

```ts
export async function POST(req: Request) {
  try {
    const user = await requireAuth();               // 1. who is this
    const payload = someSchema.parse(await req.json()); // 2. is the body valid
    // 3. authorization asserts (ownership/status/role) as needed
    // 4. prisma call(s)
    return NextResponse.json(ok(result), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
```

Representative examples: `app/api/records/route.ts`, `app/api/events/[eventId]/route.ts`.
Route params are `Promise`-typed and awaited (`{ params }: { params: Promise<{ id: string }> }`
→ `const { id } = await params`) — this is the Next.js 15 App Router requirement, not
an app-specific choice, but it's consistent everywhere.

**Exception — three unauthenticated routes.** `app/api/groups/route.ts`,
`app/api/groups/byCategory/[category]/route.ts`, and
`app/api/stats/student-counts/route.ts` skip `requireAuth()` entirely (see
`audit/security.md#sec-06`). If you're touching one of these, know that's deliberate-by-
omission, not something to copy for a route that returns sensitive data.

**Exception — error handling.** The same two `byCategory`/`student-counts` routes
(plus one branch of `app/api/groups/route.ts`) don't use `respondWithError` — they call
`handlePrismaError` directly and build the `NextResponse` by hand. Every other route
uses `respondWithError`. Use `respondWithError` for anything new; it's the one that
also handles `AuthError` and `ZodError`, which these three routes don't need only
because they don't call `requireAuth()` or `.parse()`.

**Two-endpoints-doing-the-same-thing pattern.** Event create/update is split across
`POST /api/events` (create, and update-by-including-an-id — used by the drawer and
calendar drag/resize) and `PATCH /api/events/[eventId]` (workflow actions like
`SUBMIT`/`APPROVE`/`REJECT`, and *also* a content-edit fallback). Both independently
re-implement the same ownership/status rules. This is a known duplication (see
`architecture.md` §17.9) — not a pattern to imitate, but if you're editing event
authorization logic, **you must change both files**.

---

## How do I query Prisma?

Import the singleton: `import { prisma } from "@/globals/libs/prisma"`. Never
instantiate `PrismaClient` yourself — `globals/libs/prisma.ts` is the only place that
happens, and it throws at boot if `DATABASE_URL` is unset (deliberately, so a
misconfigured deployment can't silently run against an empty in-memory database).

Query patterns actually used, consistently:

- **`include` for relations needed by the response**, inline at the call site — there's
  no repository/DAO layer. `prisma.event.findUnique({ where: { id }, include: {
  includedGroups: true, createdBy: { select: { name: true } } } })` is the typical
  shape (`app/api/events/[eventId]/route.ts`).
- **`select` to narrow a relation to just what's rendered**, e.g. `createdBy: { select:
  { name: true } }` rather than pulling the full `User` row (which would include the
  password hash) into a response payload.
- **Reusable `where`-builders as plain functions**, not classes: `buildEventStudentFilter(event)`
  (`globals/utils/buildEventStudentFilter.ts`) and `buildStudentQuery(filters)`
  (`globals/utils/queryBuilder.ts`) both return a `Prisma.XWhereInput` object that
  gets spread or passed directly into `where`. If a filter is going to be reused across
  more than one route, this is the pattern — a plain exported function, not a class or a
  query-builder abstraction.
- **`updateMany` with a condition in `where`, not `update`, for compare-and-set
  writes.** Every attendance timestamp write uses this:
  `prisma.record.updateMany({ where: { id, timein: null }, data: { timein: now } })`
  followed by re-reading the row. This is the pattern for "write this value only if
  it's still unset," used specifically to make concurrent writes safe without a
  transaction (`app/api/records/route.ts`, `app/api/records/[recordId]/route.ts`,
  `app/api/events/[eventId]/timeout/route.ts`). If you're adding a new field that
  should be "written once," follow this pattern rather than reaching for a transaction.
- **Zod-then-Prisma, never Prisma-then-Zod.** Validation always happens before any
  database call, using `.parse()` (which throws, caught by the route's `try/catch`).

---

## How do I use a transaction?

Rarely, and the codebase has exactly one non-trivial example:
`app/api/bulk-import/students/route.ts` uses `prisma.$transaction([...upserts])` (the
**array form** — a list of already-built Prisma promises, not a callback) so a batch of
student upserts either all succeed or all roll back.

**Know this pattern has a real problem before copying it**: the array form uses
Prisma's default `timeout`/`maxWait` (5s/2s), which is very likely too short for a
large batch of relation-heavy upserts — see `audit/data-integrity.md#data-01`. If
you're adding a new bulk operation, pass an explicit longer `timeout`, or use the
*interactive* form (`prisma.$transaction(async (tx) => { ... })`) instead, which gives
you more control and doesn't force the whole batch into one all-or-nothing multi-second
lock.

Everywhere else, the codebase deliberately avoids transactions in favor of the
compare-and-set `updateMany` pattern above, specifically to avoid holding SQLite's
single-writer lock during a scan burst (`architecture.md` §18). Don't reach for a
transaction to solve a "don't double-write" problem that a unique constraint plus
`updateMany(... WHERE column IS NULL)` already solves — that's the established idiom
here.

---

## How do I validate request data?

**Zod, always, at the API boundary.** But *where* the schema lives is inconsistent —
three different patterns coexist:

1. **Shared, reused across multiple write paths**: `globals/schemas/studentSchema.ts`
   (`studentSchema`, with a `.superRefine` for school-level-dependent field
   requirements) is imported by both `POST /api/students` and
   `POST /api/bulk-import/students`, and by the client-side student form
   (`StudentFormDrawer`). This is the pattern to follow when a shape is genuinely
   shared between a form and one or more API routes.
2. **Shared but only one real consumer**: `globals/schemas/index.ts` exports
   `eventSchema`, used by `POST /api/events` and by `useEventForm` on the client. Same
   idea as (1), just one route.
3. **Route-local, defined inline in the route file**: most routes define their own
   small Zod object right above the handler and never export it — e.g.
   `createRecordSchema` in `app/api/records/route.ts`, `decisionSchema` in
   `app/api/admin/organizers/[organizerId]/route.ts`, and notably `patchSchema` in
   `app/api/events/[eventId]/route.ts`, which is a **second, independently-maintained
   validation schema for event content** that doesn't share code with `eventSchema` at
   all (it duplicates the shape by hand). This is the same duplication noted above
   under event routes — if you change what an event edit accepts, check both schemas.

**When adding validation for something new**: if a form on the client submits the exact
same shape an API route accepts, put the schema in `globals/schemas/` and import it on
both sides (pattern 1/2). If it's a one-off request shape with no client form
counterpart (an action payload, a query-string shape), define it locally in the route
file (pattern 3) — that's the norm, not a shortcut.

**Known validation gaps, not to copy**: no schema in this codebase sets an upper-bound
`.max()` on any string field, and trimming is applied inconsistently — `patchSchema` in
`app/api/events/[eventId]/route.ts` does use `z.string().trim().min(1)` for `title`, but
`studentSchema` (the one that matters for CSV import) does not trim `id` or any name
field. See `audit/security.md#sec-09` and `audit/data-integrity.md#data-07`, tracked as
[#47](https://github.com/mjfelecio/Event-Attendance-System/issues/47). If you're writing
a new schema, adding both is a reasonable improvement, not a deviation from convention
(there isn't a considered convention here to preserve — it's an oversight, which is
different from a deliberate pattern).

---

## How do I implement a form?

**react-hook-form + `zodResolver` + the Zod schema that also validates the API
request**, so client and server agree on shape by construction. The hook that wires
this up lives next to the form, not in `globals/`: `features/calendar/hooks/useEventForm.ts`
wraps `useForm` with `getDefaultValues()` and a `resetForm()` helper; `StudentFormDrawer`
calls `useForm` directly.

Two sub-patterns depending on complexity:

- **Single-step form, `Controller` per custom input**: `EventDrawer.tsx` — plain
  `register()` for text inputs (via the shared `FormInput` wrapper), `Controller` for
  anything that isn't a native input (`ComboBox`, `CheckboxGroup`, `Switch`,
  `DateTimeForm`).
- **Multi-step form, `FormProvider` + `useFormContext` in child sections**:
  `StudentFormDrawer/index.tsx` owns the single `useForm()` call and wraps its steps
  (`PersonalInfoSection`, `AcademicSection`, `GroupsSection`) in `<FormProvider>`, so
  each step component pulls its own fields via `useFormContext()` without prop-drilling
  the whole form. Step transitions call `methods.trigger([...fieldsForThisStep])` to
  validate only the current step's fields before advancing — see
  `FIELDS_TO_VALIDATE` in `StudentFormDrawer/index.tsx`.

**Submission always goes through a TanStack `useMutation` hook**, never a raw `fetch`
inside the form's `onSubmit` — see the next section. The one exception is documented
there too.

**Editing an existing record**: don't rebuild the form from scratch on every render.
`useEventForm` and `StudentFormDrawer` both call `form.reset(newDefaults)` inside a
`useEffect` keyed on the incoming record, so switching which record is being edited
resets the form to the new values without remounting the component.

---

## How do I fetch/mutate server data (TanStack Query)?

One hook file per domain under `globals/hooks/`: `useEvents.ts`, `useStudents.ts`,
`useRecords.ts`, `useAdmin.ts`, `useGroups.ts`. A feature-specific fetch that isn't
reused elsewhere can live under `features/*/hooks/` instead (e.g.
`features/attendance/hooks/useStartTimeoutMode.ts`) — the line is "shared across
features → `globals/hooks`, single feature → `features/*/hooks`."

**Naming**: `useX` for the primary/default fetch of a domain (`useEvents`, default
export), `useFetchX` for a specific/secondary fetch (`useFetchEvent`,
`useFetchApprovedEvents`, `useFetchGroups`), `useXFromY` for a fetch scoped by a
relation (`useStudentsFromEvent`, `useRecordOfStudentInEvent`), `useSaveX`/`useDeleteX`/
`useXAction` for mutations. Not perfectly uniform (`useEvents` is a default export,
every other hook is named) but consistent enough to predict where to look.

**Every query and mutation calls `fetchApi<T>()`** (`globals/utils/api.ts`), never raw
`fetch` — it unwraps the `{ success, data }` envelope and throws a typed `ApiError` on
any failure, so hook consumers can just `try/catch` and read `error.message`.

**Wire-format transform pattern**: API responses carry dates as ISO strings (JSON has
no `Date` type). Every hook that returns a type with date fields defines a small
`transformX` function that converts strings to `Date` objects before handing data to
the component — see `transformEvent` in `useEvents.ts`, `transformStudent` in
`useStudents.ts`. The corresponding type pair is `X` (real `Date` fields, what
components consume) vs `XAPI`/`XDTO` (string fields, what the wire actually carries) —
see `globals/types/events.ts` (`Event` vs `EventAPI`) and `globals/types/students.ts`
(`Student` vs `StudentDTO`). If you add a new fetched type with date fields, follow this
pair-plus-transform pattern rather than trusting `Date` fields straight out of `fetch`.

**Live polling is opt-in, not default.** `useFetchEvent`, `useStatsOfEvent`, and
`useAllRecordsFromEvent` all take a `live` boolean; only the attendance page passes
`true`. When `live`, they spread in `{ staleTime: 5_000, refetchInterval: 8_000,
refetchIntervalInBackground: false }`. Report pages deliberately pass nothing (no
polling) — a completed event's data doesn't need to refresh every 8 seconds. Follow
this if you add a new "does this need to update while someone's actively scanning"
query.

**Exception — one component bypasses this pattern entirely.**
`features/students/components/StudentImporter.tsx` does a raw `fetch()` to
`/api/bulk-import/students` inside a plain async function, manually parses the JSON
envelope, and manually calls `queryClient.invalidateQueries(...)` four times — instead
of a `useMutation` hook in `globals/hooks/useStudents.ts`. This is a genuine
inconsistency, not a considered exception; if you're touching bulk import, moving it to
a `useMutation` (mirroring `useSaveStudent`) would match the rest of the codebase, but
that's a refactor, not something required to add new features elsewhere.

---

## How do I invalidate cached data?

**Prefer the `queryKeys` factory** (`globals/utils/queryKeys.ts`) over hand-written key
arrays — it's what most of the codebase does (`useEvents.ts`, `useRecords.ts`,
`useAdmin.ts`, most of `useStudents.ts`). Two things worth understanding before adding
a new key:

1. **Prefix invalidation is deliberate, not an accident.**
   `queryKeys.records.fromEventPrefix(eventId)` returns a *shorter* key than
   `queryKeys.records.fromEvent(eventId, includeAbsent)` on purpose — invalidating the
   prefix refreshes **both** the live present-only table and the report's
   present+absent variant in one call, because TanStack Query invalidates by key-prefix
   match. If you add a new query key with a boolean/variant suffix like `includeAbsent`,
   consider whether callers will usually want to invalidate all variants at once (use a
   prefix helper) or just one (use the full key).
2. **Roster mutations over-invalidate deliberately.**
   `invalidateStudentDependents()` in `useStudents.ts` invalidates students, student
   stats, **all events**, and **all records** on every student save/delete — because
   changing the roster changes event eligibility, which changes every stat and report.
   This looks excessive until you remember eligibility is computed live
   (`domain-model.md`'s "Eligibility" section) — a roster edit really does affect
   everything downstream. Don't narrow this without checking whether the narrower
   invalidation set still covers every screen that reads eligibility-derived data.

**Exception — inconsistent key style.** `globals/hooks/useGroups.ts` doesn't use the
`queryKeys` factory at all — it writes inline arrays (`["groups", "byStudentId",
studentId]`, `["groups", "by-category", eventCategory]`, `["student-filters"]`), and
`useStudentsStats` in `useStudents.ts` does the same (`["stats", "students"]`, matched
by a separate inline invalidation call elsewhere — `["stats", "students"]` appears
independently in both `useStudents.ts` and `StudentImporter.tsx` rather than through a
shared constant). If you're adding a new groups-related query, extending
`queryKeys.ts` with a `groups: {...}` section (there isn't one) would be the more
correct move, matching what every other domain does — but don't be surprised the
existing groups hooks don't already do this.

---

## How do I enforce authorization?

**Server-side, always, using the four primitives in `globals/utils/auth.ts`** — this
is the one convention with zero exceptions found anywhere in the API layer:

| Primitive | Use it when... |
|---|---|
| `requireAuth()` | any protected route needs to know who's calling (returns the session, re-read from the DB) |
| `requireRole(user, "ADMIN")` | the action is admin-only (approve/reject organizers or events) |
| `assertEventOwnership(event, user)` | the action requires being the event's creator (or admin) — edit, delete, toggle timeout, delete a record |
| `assertEventVisibility(event, user)` | the action just requires being able to *see* the event — owner, or admin, or the event is APPROVED (shared) |
| `assertEventStatus(event, allowed)` | the action is only valid in certain workflow states |

Call them in that rough order — auth, then role, then ownership/visibility, then
status — and let them throw (`AuthError`); `respondWithError` maps the thrown error to
the right HTTP status. Don't hand-roll an equivalent `if` check in a new route; import
these.

**Client-side authorization checks are cosmetic, not a boundary — and every one of them
mirrors a real server check.** `canEditEvent` (`features/calendar/utils/calendar.ts`),
`canManage` (`features/attendance/components/StudentDetails.tsx`), and the
`isReadOnlyView` logic in `EventDrawer.tsx` all recompute the same rule the server
enforces, purely to hide/disable a control the server would reject anyway. If you add a
new server-side rule, ask whether the UI should mirror it (usually yes, for a good
error-free experience) — but never treat the client check as the actual enforcement.

**Pattern for "admin can edit anything" pathways**: event audience edits are guarded
the same way the delete paths are. Changing an *approved* event's `category` or
`includedGroups` after it already has attendance records silently rewrites which
students count as "eligible" (eligibility is recomputed live — see
`audit/data-integrity.md#data-06`), so both event-edit routes
(`POST /api/events`, `PATCH /api/events/[eventId]`) run the shared
`getEventAudienceChangeError` guard (`globals/utils/eventAudienceGuard.ts`): when the
audience actually changed and `attendanceCount > 0`, the edit is rejected with
`409` + code `AUDIENCE_CHANGE_HAS_RECORDS` unless the caller sends
`acknowledgeAudienceChange: true`. The `EventDrawer` prompts with `useConfirm()` naming
the record count and only re-sends with that flag after the admin confirms (benign
edits — title/location/description/schedule — pass through untouched, and the
changed-ness comparison ignores field order and unchanged re-submissions so calendar
drag/resize never trips it). If you add another admin-edit pathway that can change an
event's audience, apply the same `attendanceCount > 0` guard rather than inventing a
new one. Resolved from `SEC-03` / `DATA-05` (#40).

---

## How do I handle errors?

**Server**: throw, don't return an error response by hand, except for the handful of
"this specific business rule failed" cases that return `NextResponse.json(err(...),
{status, code})` directly (e.g., `EVENT_HAS_RECORDS`, `NO_TIME_IN`) because they need a
specific `code` string the client branches on. Everything else — validation failures,
auth failures, database errors — is caught by the route's `try { } catch (error) {
return respondWithError(error); }` and classified by `respondWithError`
(`globals/utils/httpError.ts`): `AuthError` → its own status, `ZodError` → 400,
anything else → `handlePrismaError` (`P2002`→409, `P2025`→404, `P2003`→400, `P2000`→400,
default→500).

**When you need the client to branch on a specific failure** (not just show a generic
error), give it a `code` via `err(message, "SOME_CODE")` and check
`error.code === "SOME_CODE"` in the calling hook or component — see how `NO_TIME_IN`,
`EVENT_HAS_RECORDS`, `INVALID_GROUPS`, and `DUPLICATE` are used. Don't parse the
message string to detect a condition (one place does this anyway —
`AttendanceSection.tsx`'s `processScan` checks `message.toLowerCase().includes("already
exists")` — treat that as legacy, not a pattern to extend).

**Client**: every mutation's error path goes through a toast
(`toastDanger`/`toastWarning`), reading `error.message` off the caught `Error`/`ApiError`.
There is no global error boundary component and no silent-catch anywhere reviewed —
every mutation handler in the codebase surfaces failure to the user one way or another.

**Known messaging gap**: `P2003` (foreign key constraint) is mapped to a single generic
message ("Invalid reference. Related record does not exist.") regardless of which
constraint actually failed. This reads correctly for most P2003s but is actively wrong
for `DELETE /api/students/[id]`, where the real cause is the opposite of what the
message says (see `audit/data-integrity.md#data-03`). If you add a delete route
guarded by a `RESTRICT` foreign key, add a proactive existence check first (the way
`DELETE /api/events` already does with `attendanceCount > 0`) rather than relying on
this generic message.

---

## How do I show loading / empty / error states?

**Shared table states, not ad hoc per feature**:
`globals/components/shared/dataTable/DataTableStates.tsx` provides
`DataTableErrorState`/empty-state components that `DataTable` renders internally based
on `isLoading`/`isError`/row count — see `RecordsList.tsx` passing a custom
`errorState`. For non-table content, the pattern is a small local
`LoadingState`/`EmptyState` component defined right above the component that needs it
(see `StudentDetails.tsx`) — not extracted to `globals/` unless reused.

**Mutation-in-flight state**: read `isPending` off the `useMutation` result and disable
the triggering control — every button that fires a mutation reviewed
(`AttendanceActionButtons`, `EventDrawer`'s save/submit/approve buttons, the admin
dashboard's approve/reject buttons) disables itself and swaps its label
(`"Approving..."`) while pending. Follow this for any new mutation-triggering button.

---

## How do I show a toast?

Import from `globals/components/shared/toasts.tsx`:
`toastSuccess`/`toastInfo`/`toastWarning`/`toastDanger`, each `(title, description?)`.
Built on `sonner`, rendered once globally via `<Toaster />` in `app/layout.tsx`. Use
`toastWarning` for "the operation was a no-op, not an error" (e.g., "Attendance was
already recorded" when `changed: false` comes back) — don't use `toastDanger` for
that, it's reserved for actual failures. This distinction is used consistently in
`AttendanceSection.tsx` and `AttendanceActionButtons.tsx`.

---

## How do I confirm a destructive action?

`useConfirm()` from `globals/contexts/ConfirmModalContext.tsx` — it returns a promise
that resolves to `true`/`false`, backed by one shared dialog instance mounted at the
root (`ConfirmProvider` in `app/layout.tsx`). Every irreversible action reviewed (delete
event, delete record, delete student where wired up) awaits this before proceeding:

```ts
const confirmed = await confirm({ title: "...", description: "..." });
if (!confirmed) return;
```

This is the one pattern in the codebase with **no exceptions found** — nothing
destructive skips it. If you add a new destructive action, use it; don't build a new
one-off confirmation dialog (`ConfirmDialog` in `globals/components/shared/ConfirmModal.tsx`
is the underlying presentational piece, already wired to the context — you shouldn't
need to touch it directly).

---

## How do I build a modal / drawer?

Vendored Radix primitives from `globals/components/shad-cn/`:
- **`Dialog`** for centered modals (confirmations, `StudentQrModal`).
- **`Sheet`** for the slide-in student form (`StudentFormDrawer`).
- **`Drawer`** (a separate vendored primitive, visually similar to `Sheet` but a
  different underlying component) for the event drawer (`EventDrawer.tsx`).

**Inconsistency, not a considered choice**: `Sheet` and `Drawer` serve the same visual
role (a slide-in panel) but are two different vendored components used by two different
features for what is functionally the same UI pattern. If you're adding a third
slide-in panel, either is technically fine to copy from, but there's no single "the"
drawer component to reach for — check which one the feature you're extending already
uses.

---

## How do I add a table?

**There are two independent table implementations — know which one you're extending.**

1. **`globals/components/shared/dataTable/DataTable.tsx`** — the more capable one.
   Supports client mode (manages sorting/filtering/pagination itself) and a `manual`
   mode (server-driven — the parent owns pagination/sorting state and the table just
   renders whatever page it's given). Used by the attendance records table and the
   reports records table. `manual` mode exists in the code but **nothing on `main`
   currently uses it** — it was built ahead of a server-paginated roster that hasn't
   landed. If you're adding a table for a dataset large enough to need server-side
   pagination, this is the component with that capability already built in.
2. **`features/students/components/StudentsDataTable/`** — a separate,
   simpler, feature-local implementation (its own header/body/pagination
   sub-components) used only by the Student List's roster. It does not share code
   with (1).

This is a real inconsistency, not a layered/intentional design (there's no comment or
doc explaining why the Student List has its own table). If you're adding a new table and it
isn't specifically extending the Student List's roster, use (1) — it's the one
described in its own doc comment as "the standard, reusable table used throughout the
application," and it's the one every other feature actually uses.

**Column definitions** are `ColumnDef<T>[]` arrays exported from a `constants/`
file next to the feature that owns the table (`features/attendance/constants/eventAttendanceTable.tsx`,
`features/reports/constants/eventRecordsTable.tsx`) — not inlined in the component that
renders the table. Follow this split for a new table: columns in `constants/`, the
table usage in `components/`.

**A relation field in a column must be reduced to a primitive before rendering**, via
`accessorFn`, not passed through raw — `reportColumns`'s `section` column derives
`row.section?.name ?? ""` rather than rendering the `Group` object directly (a raw
object crashed React and broke sorting; see the git history / `eventRecordsTable.tsx`
comment). If a new column's data is a relation object, follow this pattern.

---

## How do I add a new UI component?

- **Vendored shadcn/Radix primitive** (`globals/components/shad-cn/*`): treat as
  third-party. Don't hand-edit these to add app-specific behavior — wrap them instead.
- **App-level shared wrapper** (`globals/components/shared/*`): a thin, opinionated
  wrapper around one or more shad-cn primitives that encodes this app's specific
  styling/behavior — e.g. `FormInput` wraps shad-cn's `Input` + `Field` with the app's
  label/error/description layout, `ComboBox` wraps `Popover` + `Command`. Add here when
  the component will be used by more than one feature.
- **Feature-local component** (`features/*/components/*`): everything else. Per
  `architecture.md` §3, nothing in `features/` is imported cross-feature *except*
  `features/attendance/components/DataCard.tsx`, which reports reuses — that's a known,
  narrow exception, not a precedent for casually importing across features.

**Styling**: Tailwind utility classes inline, no CSS modules or styled-components
anywhere reviewed. `cn()` (`globals/libs/shad-cn.ts`, the standard `clsx` +
`tailwind-merge` helper) is used whenever a class list is conditional — see `Sidebar.tsx`,
`DataTable.tsx`. For a static class list, plain template literals are used directly
without `cn()` — both styles appear in the codebase depending on whether the classes
are conditional; there's no inconsistency here, just two situations.

---

## How do I handle dates and times?

- **Server**: every timestamp is `new Date()` at write time (no client-supplied
  timestamps are ever trusted for `timein`/`timeout`/`reviewedAt`).
- **Wire format**: dates serialize to ISO strings over JSON; see the `X`/`XAPI` type
  pair pattern under "How do I fetch/mutate server data" above.
- **Display formatting**: two small, purpose-specific helpers in
  `globals/utils/formatting.ts` — `readableDate` (date + time, used for event
  metadata) and `readableTime` (time only, used for timein/timeout cells) — both
  wrapping `Date.prototype.toLocaleString("en-US", {...})` with a fixed option set.
  `eventRecordsTable.tsx` has its own separate inline `formatTime` doing roughly the
  same thing with a slightly different option set (adds seconds, `hour12: true`
  explicit) — a small duplication, not a different convention; if you need "format a
  time for display," check `formatting.ts` first before writing a new one.
- **Timezone**: nothing is normalized to UTC for display — every render uses the
  browser's local timezone via `toLocaleString`, which is correct for this app's
  single-LAN, single-timezone deployment (`architecture.md` §15.9) but would need
  revisiting if that assumption ever changes.
- **All-day events**: normalized to midnight client-side before submission
  (`normalizeAllDay`/`formatEventPayload` in `globals/utils/events.ts`), not
  server-side — if you add another all-day-sensitive field, follow this client-side
  normalization point rather than adding date-truncation logic in the API route.

---

## How do I name things?

- **Files**: `PascalCase.tsx` for components, `camelCase.ts` for hooks/utils/schemas.
  Hook files are named after their primary export (`useEvents.ts` exports `useEvents`
  as default plus several named hooks) — a hook file is "the hooks for this domain,"
  not strictly "one hook per file."
- **API routes**: always `route.ts`, dynamic segments in brackets matching the Prisma
  field they look up where practical — mostly consistent, but note
  `app/api/students/[id]/route.ts` uses `[id]` while
  `app/api/records/[recordId]/route.ts` uses `[recordId]` for the equivalent role (the
  route's own primary key param) — cosmetic inconsistency, not meaningful.
- **Hooks**: `useX`/`useFetchX`/`useXFromY`/`useSaveX`/`useDeleteX` as described above.
- **Zod schemas**: `xSchema` (`studentSchema`, `eventSchema`, `loginSchema`), inferred
  types via `z.infer<typeof xSchema>` named `XFormValues` or reusing the domain type
  name (`EventForm = z.infer<typeof eventSchema>`).
- **Types**: domain type `X` (e.g. `Event`, `Student`) is usually `PrismaX & {
  ...denormalized/derived fields }`; the wire-format counterpart is `XAPI` (events) or
  `XDTO` (students) — both mean the same thing (string dates instead of `Date`), just
  named differently depending which file introduced the pattern first. Ad hoc
  relation-inclusive types use Prisma's own generic:
  `Prisma.XGetPayload<{ include: {...} }>` (`EventWithGroupsAndCreator`,
  `StudentWithRecords`) rather than hand-writing the shape.
- **Booleans/flags**: `isX`/`hasX` (`isTimeout`, `isPending`, `hasTimeIn`, `isEdit`).

---

## Where do constants live?

- **Domain vocabulary that multiple features must agree on** (departments, programs,
  strands, houses, section-naming convention, group-label formatting):
  `globals/constants/groups.ts` — the file's own header comment calls it "the single
  source of truth," and the seed script, the student form, the event drawer's group
  picker, and report grouping all import from it. If you're adding a new piece of
  school vocabulary, it goes here, not hardcoded at the call site.
  **Caveat**: this file's inline comments are stale — they describe fields
  (`Student.department`, `Student.houseSlug`, etc.) that were removed from the schema
  in the `Group`-model overhaul. Don't trust the comments' description of *where
  values are stored*; trust `domain-model.md` for that. The vocabulary data itself
  (names/slugs/codes) is still current and in active use.
- **Feature-scoped constants** (table column configs, UI copy, category-to-icon maps):
  `features/*/constants/`.
- **Cross-feature small config** (page-size options, calendar timing config):
  `globals/components/shared/dataTable/config.ts`, `features/calendar/constants/calendarConfig.ts`
  — scoped to whichever component tree actually uses them, not centralized further than
  that.

---

## Where should shared logic live?

Follow `architecture.md` §3's rule of thumb, which holds up under inspection: **if a
change affects who can do what, it lives in `globals/utils/auth.ts` plus the relevant
API route(s). If it affects who counts as an event's attendee, it lives in
`globals/utils/buildEventStudentFilter.ts`.** More generally:

- **Used by more than one API route or more than one feature** → `globals/utils/`
  (plain exported functions, no classes — see `studentGroups.ts`, `eventGroups.ts`,
  `formatting.ts`).
- **Used by exactly one feature's components** → `features/*/utils/` or
  `features/*/hooks/`.
- **A TanStack Query hook reused by more than one feature** → `globals/hooks/`; scoped
  to one feature → `features/*/hooks/`.
- **A type describing a Prisma model plus denormalized fields** → `globals/types/`,
  named after the model.

---

## What should be server-side vs client-side?

Per `architecture.md` §5: **server owns authentication, all authorization, all
validation that matters, eligibility computation, scan rules, and stats arithmetic.
Client owns rendering, form state, table state, and toasts.** In practice this means:

- Never trust a client-computed boolean (`canEdit`, `isEligible`, a count) for anything
  that gates a write — recompute it server-side even if the client already computed the
  same thing to decide what to render. Every authorization/eligibility check in this
  codebase already follows this; it's the reason `audit/security.md` found no
  client-side-only authorization bypasses despite fairly loose-looking client code.
- Client-side "permission" booleans (`canManage`, `canEditEvent`, `isReadOnlyView`)
  exist purely to avoid showing a control that would 403 — treat any new one you add the
  same way: cosmetic, always backed by the real server check.
- Default to a client component (`"use client"`) unless there's a specific reason not
  to (direct Prisma access to avoid an API round-trip, or avoiding shipping a
  server-only auth check to the client bundle) — that's what the two existing server
  component pages did it for, and it's the exception, not the starting assumption in
  this codebase.

---

## How do I add a new database model?

Follow the `Group` model as the precedent (it's the newest addition to the schema and
the most instructive):

1. Add the model to `prisma/schema.prisma`, with explicit `@@index`/`@@unique` where a
   query will filter or need uniqueness on it — every model in the schema has at least
   one deliberate index with a comment explaining what query it serves.
2. Choose the referential action deliberately per relation, not by default:
   `RESTRICT` where deleting the parent should be blocked if dependents exist (`Record →
   Event`/`Student`), `SET NULL` where the relation is informational/audit-only and
   shouldn't cascade-delete anything (`Event/Record → User`), implicit `CASCADE` only
   on pure join tables.
3. Run `pnpm db:migrate` (wraps `prisma migrate dev`) to generate the migration — don't
   hand-write migration SQL; every migration in `prisma/migrations/` is generator
   output (see the `PRAGMA defer_foreign_keys` table-rebuild pattern SQLite's migration
   engine produces for most schema changes — that's the tool, not something to
   replicate by hand).
4. Add a domain type in `globals/types/` (see the `X`/`XAPI` pairing convention
   above) if the model needs to travel over the wire with date fields.
5. Add a Zod schema in `globals/schemas/` if it's user-submitted data.
6. Add API routes under `app/api/` following the `requireAuth → validate → authorize →
   prisma → respond` shape.
7. Add a `globals/hooks/useX.ts` file with the fetch/mutation hooks, using
   `queryKeys.ts` (add a new top-level key to the factory — follow the existing
   `events`/`students`/`records` shape) rather than inline arrays.
8. If the model needs seed data, add it to `prisma/seed.ts` following the existing
   sections (see "How do I seed data?" below).

---

## How do I write a migration?

Don't hand-write one — run `pnpm db:migrate` (`prisma migrate dev`) and let Prisma
generate it from your `schema.prisma` change. Every one of the 13 existing migrations
is generator output; several use SQLite's table-rebuild pattern
(`PRAGMA defer_foreign_keys=ON` → recreate table → copy data → drop/rename → restore
pragmas) for changes SQLite can't do with a direct `ALTER TABLE`. This is 100%
SQLite-specific and won't replay against a different database provider — see
`audit/postgres-migration.md` if that's ever relevant. Name the migration for *what
changed*, matching the existing style (`add_is_timeout_column_to_events`,
`remove_section_as_static_field`) — not a ticket number or a date-only name.

---

## How do I seed data?

Edit `prisma/seed.ts` and run `pnpm db:seed`. Know before you touch this file:

- **It is fully destructive** — it deletes every row in every table (`record → event →
  student → group → user`, in that FK-safe order) before inserting anything. There is
  no "add to existing data" mode.
- **It's guarded against running in production** — it throws unless `NODE_ENV !==
  "production"` or `SEED_FORCE=true` is explicitly set. Don't remove this guard; if you
  need to seed a production-like environment on purpose, use the `SEED_FORCE` escape
  hatch rather than weakening the check.
- **Group vocabulary is derived from `globals/constants/groups.ts`**
  (`HOUSES`, `SHS_STRANDS`) plus an inline `GROUP_DATA`/`DERIVED_GROUPS` map for
  departments/programs/sections/years — this is the *only* place `Group` rows are ever
  created (there's no API route for it; see `audit/data-integrity.md#data-02`). If the
  real-world vocabulary needs to change, it changes here and the app needs reseeding
  (destructively) or a direct database edit — there's no lighter-weight path today.
- **Users are created with plaintext passwords** (`password: "password"`) —
  this works because `verifyPassword` accepts legacy plaintext and rehashes on first
  successful login (`globals/utils/password.ts`). Don't "fix" the seed to pre-hash
  passwords without understanding this is intentional — it's simpler for local/demo
  setup, and the upgrade-on-login path exists specifically to handle it.

---

## How do I import/export data (CSV)?

- **Import**: `react-papaparse`'s `useCSVReader` hook, parsed client-side
  (`{ header: true, skipEmptyLines: true }`), then POSTed as JSON (not as a file) to
  `/api/bulk-import/students` — see `StudentImporter.tsx`. The API validates every row
  with the same `studentSchema` used for single-student creation, plus the shared
  `validateStudentGroupSlugs` group-integrity check, before writing anything.
- **Export**: `globals/hooks/useDataExport.ts`, a generic `{ apiUrl, filename }` hook
  used wherever CSV export exists. It lazy-imports `react-papaparse`'s `jsonToCSV` (kept
  out of the main bundle) and runs every row through `escapeCsvFormulas()` first — this
  is a deliberate security measure, not incidental: it prefixes any cell value starting
  with `= + - @` (or a tab/CR) with a `'` so it can't execute as a spreadsheet formula
  when opened in Excel/Sheets. **Keep this if you add a new export path** — don't build
  a second CSV export that skips it.

---

## How do I work with QR functionality?

- **Generation**: `react-qr-code`'s `<QRCode value={student.id} />` — the payload is
  **the bare 11-character student ID, nothing else** (no signature, no event context).
  See `StudentQRModal` (also referenced as `StudentQrModal` internally — the component
  name and prop-type names use "Qr", the filename uses "QR"; a cosmetic naming
  inconsistency, not a functional one).
- **Scanning**: `@yudiel/react-qr-scanner`, loaded via `next/dynamic({ ssr: false })`
  so the ~170KB library only loads after the user taps "Open Camera" — see
  `Scanner.tsx` (the lazy boundary) and `ScannerCamera.tsx` (the actual camera
  component). If you add another camera-driven feature, follow this lazy-load split
  rather than importing the scanner library at the top of a page.
- **Debounce**: duplicate-scan suppression is a `useRef`-held `{ value, timestamp }`
  pair with a 1000ms window, local to `ScannerCamera` — not a shared utility. If a
  second scanner UI is ever added, this logic would need to be extracted rather than
  copy-pasted (it isn't currently reused anywhere, so there's no established shared
  version to reach for).
- **What a scan actually does**: the scanner component only reports a raw string via
  `onRead`. All business logic (resolve student, check eligibility, write the record)
  happens in the *page-level* handler (`AttendanceSection.processScan`), not inside the
  scanner component. Keep that split if you add a second scan-consuming screen — the
  scanner stays a dumb "here's a string" component.

---

## How do I build a printable report?

**One builder feeds both the screen and the paper.**
`globals/utils/eventReport.ts` (`server-only`) exports `buildEventReport(event)`,
which runs the eligibility query, derives every student's outcome, and returns the
totals, section breakdown, arrival buckets, and rows. Its two consumers are:

1. **On-screen** — `GET /api/reports/events/[eventId]` →
   `features/reports/hooks/useEventReport.ts` → `app/(main)/reports/events/[id]/page.tsx`.
2. **Print** — `app/(print)/reports/events/[id]/print/page.tsx`, a **server
   component**, calls `buildEventReport` directly and renders
   `features/reports/components/print/AttendanceSheet.tsx`.

This replaced an arrangement where the print page queried Prisma and recomputed
eligibility and stats itself. That was previously flagged here as the single most
important "these two things must be changed together" relationship in the
codebase; it no longer exists. **If you change what counts as present or eligible,
change it in `buildEventReport` (or the derivation rules in
`globals/utils/attendance.ts`) and both surfaces follow.**

### The print route group

Printable pages live under `app/(print)/`, which supplies a bare white layout. They
deliberately do **not** sit under `(main)`: that layout mounts the sidebar, mobile
bars, a slate background and a `pb-24` gutter, and gates rendering behind a
client-side auth check that flashes "Checking access…" first. The nav chrome all
carries `print:hidden` so it never reached paper, but it framed the on-screen
preview and delayed first paint.

Because `(main)`'s gate is a client component and never protected a direct request
to a server route anyway, print pages **authenticate on the server themselves** —
`getFreshAuthSession()` plus an inline visibility check mirroring
`assertEventVisibility`. Keep that if you add another printable page.

### Print styling

Tailwind `print:` variants inline in the component, plus the shared rules in
`app/globals.css` (`@page A4 portrait`, `.no-print`, `.print-break-inside-avoid`,
`.print-table thead { display: table-header-group }` so headers repeat on every
page).

Two constraints worth knowing:

- **No charts on printed pages.** Recharts' `ResponsiveContainer` measures the DOM
  and renders blank or mis-sized in print. Printed documents are tables and numbers.
- **No page numbers in the markup.** Chrome does not support `@page` counters for
  HTML content, so any "Page 1 of 4" rendered in the document would be wrong on
  every sheet after the first. The browser's own print header/footer supplies real
  ones.

### Print options

The sheet's options (include absentees, group by section, signature column) live in
**URL search params**, read by the server page from `searchParams`. That keeps the
page a server component — no report logic ships to the browser — and makes a
configuration a shareable link. The only client component is
`PrintOptionsBar`, which is `.no-print`.

---

## How do I use environment variables?

Only two exist today: `DATABASE_URL` (always required — `globals/libs/prisma.ts`
throws at import time if it's missing, deliberately, rather than falling back to an
in-memory database) and `AUTH_SECRET` (required only in production —
`globals/utils/auth.ts`'s `getAuthSecret()` throws if `NODE_ENV === "production"` and
it's unset/short, otherwise silently falls back to a dev-only constant). Read them via
`process.env.X` directly at the point of use — there's no centralized `env.ts`
validation module. If you add a new required env var, follow the `DATABASE_URL`
pattern: fail fast and loud at the point it's first needed, rather than letting a
missing value silently degrade behavior.

---

## How do I log something?

There's no logging library — everything is `console.log`/`console.warn`/`console.error`/
`console.info`, and it's used sparingly and specifically, not as general-purpose
debugging noise left in:

- `console.info("[audit] ...")` — the one deliberate audit trail in the codebase
  (`app/api/records/[recordId]/route.ts`, on record deletion). It's console-only, not
  persisted to the database — see `audit/data-integrity.md#data-10` if you're
  considering whether to extend this pattern to other destructive actions (the honest
  answer is this pattern doesn't provide durable audit and a new one probably shouldn't
  copy it as-is).
- `console.warn(...)` — used for "the request was rejected by validation, here's the
  detail that didn't make it into the user-facing message," e.g. `respondWithError`
  logs the full `ZodError` tree via `z.treeifyError()` before returning the generic
  "Invalid request payload." to the client. Follow this if you add a new validation
  path: log the detail server-side, keep the client message generic.
- `console.error(...)` — genuine unexpected-failure paths (bulk import's catch block,
  the two routes that bypass `respondWithError`).

No route or hook logs on the success path. If you're tempted to add a log line, match
one of these three purposes rather than introducing general tracing.

---

## How do I write comments?

The codebase's comment style, followed fairly consistently: **explain *why*, not
*what*.** A representative comment doesn't describe what the next line does (that's
what reading the code is for) — it explains the non-obvious reason it's written that
way:

```ts
// No optimistic write here: the attendance-records cache holds enriched
// StudentAttendanceRecord rows (fullName/schoolLevel/section) which this
// mutation's input can't reconstruct - appending a raw record corrupted
// the row and duplicated it in timeout mode.
```
(`globals/hooks/useRecords.ts`)

This shows up throughout `globals/utils/`, the API routes, and the more intricate UI
logic (`DataTable.tsx` is especially dense with these, since its behavior — disabled
`autoResetPageIndex`, the manual page-clamp `useEffect`, the `resetKey` prop — is
non-obvious without the history behind each decision). Multi-line block comments are
reserved for exactly this "here's the incident/constraint that led to this code" case,
not used as section dividers or restated type signatures.

**Known exception, worth knowing about rather than trusting blindly**: comments can go
stale and this codebase has real examples — `globals/constants/groups.ts`'s header and
per-field comments describe `Student` columns (`department`, `houseSlug`, `shsStrand`,
etc.) that were removed from the schema during the `Group`-model migration. The data in
that file is current; the comments' description of *where it's stored* is not. If a
comment describes a database column, cross-check it against `schema.prisma` /
`domain-model.md` rather than trusting it outright — this file is the known instance,
but it's a reason for a general habit, not a promise every other comment is equally
current.

---

## Summary: the load-bearing conventions

If you only take three things from this document:

1. **The API route shape is real and load-bearing**: `requireAuth → Zod.parse →
   authorization asserts → prisma → respond via ok()/err()`, wrapped in one
   `try/catch` → `respondWithError`. Every new route should look like this.
2. **`buildEventStudentFilter` and the four `globals/utils/auth.ts` primitives are the
   two places correctness and security actually live.** Everything else (client
   components, forms, tables) is UI convenience sitting on top of these. When in doubt
   about whether a check belongs on the client or server, it belongs on the server,
   using one of these.
3. **This codebase has real, documented inconsistencies** (two table implementations,
   two drawer primitives, `useGroups.ts`'s inline query keys, `StudentImporter`'s raw
   `fetch`, two independent event-edit schemas). None of them are bugs, and none of
   them need fixing to add a new feature — but copy from the *majority* pattern
   described in each section above, not from whichever inconsistent example you happen
   to open first.

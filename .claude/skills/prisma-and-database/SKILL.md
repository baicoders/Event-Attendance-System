---
name: prisma-and-database
description: Prisma/PostgreSQL conventions for the Event Attendance System — schema change workflow, migration generation, the guarded-write concurrency protocol, snapshot reads, and seed script danger. Use whenever touching prisma/schema.prisma, prisma/migrations, prisma/seed.ts, any $transaction, or writing a new Prisma query.
---

# Prisma & Database Conventions

## The database is PostgreSQL 17 via a driver adapter — not the classic Prisma engine

`globals/libs/prisma.ts` constructs `PrismaClient` with `@prisma/adapter-pg`
(`pg` Pool, one bounded pool per process: max 8, 5s connect/acquire, 30s idle),
not the default engine. There is exactly one `PrismaClient` singleton — never
instantiate one yourself. Connection ownership lives in `globals/libs/dbConfig.ts`:
`DATABASE_URL` is the runtime (pooled) endpoint, `DIRECT_URL` the direct
migration/maintenance endpoint (never a pooler); both must be `postgresql://`
URLs or the app throws at boot, deliberately, so a misconfigured deployment fails
loudly instead of silently running against the wrong database. Keep that fail-fast
behavior if you touch these files. Remote hosts require verified TLS — never
disable certificate validation. SQLite/`file:` URLs are refused everywhere; the old
SQLite history is archived under `prisma/migrations-sqlite-archive/` (forensic only,
never replayed).

## Concurrency: the guarded-write protocol, not bare writes

Every attendance-affecting write runs inside the guarded-write protocol
(`globals/utils/pgLocks.ts`, issue #51 §4) — transaction-scoped
`pg_advisory_xact_lock` keys plus row locks, never session-scoped locks:

1. Bounded Read Committed transaction. Attendance/record writes take the **shared**
   roster-state advisory lock; roster edits, imports, group membership
   replacement/deletion and lifecycle writes take the **exclusive** form.
2. Lock Event rows in deterministic ID order: `FOR SHARE` for recording,
   `FOR UPDATE` for mode/content/lifecycle mutations or deletion. Re-read
   event/permission/mode facts **after** locking.
3. Take the exclusive per-`(eventId, studentId)` advisory lock (even when no
   Record exists), then run the existing create/conditional-update logic:
   `updateMany` with a `…: null` condition in `where`, followed by a re-read.
   Unique constraints and affected-row checks stay mandatory — they are what make
   concurrent scans converge on one record with write-once timestamps.
4. Retry the whole transaction **once** and only for a classified
   serialization/deadlock (`P2034` / `40001` / `40P01` via
   `isRetryableTransactionError`) — never for unique, validation, auth or
   transport failures.

**If you add a new writer, follow this protocol.** Copy the shape in
`features/attendance/server/recordAttendance.ts` (shared form) or
`app/api/events/[eventId]/route.ts` (exclusive form). Credential writes lock
User rows `FOR UPDATE` in deterministic order and run the conditional update +
winning-generation reread on the **same** transaction (`globals/utils/credentials.ts`
+ `lockUserRowsForUpdate`) — a fresh global reread is never authority to mint a
cookie. Don't invent a second lock ordering; if an operation can't follow the
common order, resolve it in tests before enabling it.

## Reads: Repeatable Read snapshots for multi-query promises

Anything promising a coherent population (audience preview, event report/export/
print snapshot, progress, student history, stats, bulk preview/export) runs in a
short `RepeatableRead` transaction with **all** reads on the `tx` client — never
mix the global client into an established snapshot, never nest transactions.
Capture DTO inputs inside, then sort/project/render outside. Single independent
reads stay outside transactions. Name search is explicitly
`contains: { mode: "insensitive" }` (PostgreSQL `LIKE` is case-sensitive);
ID/slug/identity lookups keep their exact/normalized policies.

## Schema changes: always generate migrations, never hand-write SQL

Run `pnpm db:migrate` (wraps `prisma migrate dev`) after editing `schema.prisma`.
`prisma/migrations/` holds exactly one PostgreSQL baseline plus incremental
follow-ups — `migrate deploy` into a brand-new database must stay green, and an
upgrade baseline→latest must be tested, not just a fresh reset. All `DateTime`
columns are `@db.Timestamptz(3)` (UTC instants; presentation stays Asia/Manila
where contracted). Name migrations for *what changed*
(`add_is_timeout_column_to_events`), matching existing style. Never run
`migrate dev` / `db push` / `migrate reset` / destructive seeds against
staging/production.

When adding a relation, choose the referential action deliberately, following existing
precedent: `RESTRICT` where deleting the parent should be blocked if dependents exist
(`Record → Event`/`Student` — this is what makes attendance history un-deletable by
accident), `SET NULL` for audit/informational relations that shouldn't cascade
(`Event/Record → User`), implicit `CASCADE` only on pure join tables.

## The seed script is fully destructive — treat it with respect

`prisma/seed.ts` deletes **every row in every table** (`record → event → student →
group → user`, in FK-safe order) before inserting fixed demo data. It's guarded to
refuse running when `NODE_ENV === "production"` unless `SEED_FORCE=true` is explicitly
set — **do not remove or weaken that guard**. If you need to seed a production-like
environment on purpose, use the `SEED_FORCE` escape hatch, don't loosen the check
itself. It connects via the migration URL (`DIRECT_URL`, local fallback
`DATABASE_URL`) and refuses non-PostgreSQL targets.

`Group` rows (departments/programs/strands/houses/sections — the entire vocabulary a
student or event can be scoped by) are created **only** by this seed script; there is
no API route or UI to add one afterward. This is `DATA-02`, a confirmed P0 finding —
a real-world roster whose sections don't match the seeded vocabulary gets **entirely
rejected** on bulk import with no in-app recovery path. If your task involves group
vocabulary, read `docs/audit/data-integrity.md#data-02` and
`globals/constants/groups.ts` (the single source of truth the seed derives from) before
assuming you can "just add a group" some other way.

## Query patterns to follow

- `include`/`select` inline at the call site — there is no repository/DAO layer.
  `select` a relation down to only the fields actually rendered (e.g. `createdBy: {
  select: { name: true } }`, never the full `User` row, which carries the password
  hash).
- Reusable filters are plain exported functions returning a `Prisma.XWhereInput`
  (`buildEventStudentFilter`, `buildStudentQuery`) — not classes, not a query-builder
  abstraction. `buildEventStudentFilter` in particular is the single source of truth
  for "who is eligible for this event"; if you change it, check every one of its
  current call sites (**7**, across 5 files) including the print page, which
  calls it directly rather than through the stats API.
- Validate with Zod **before** any Prisma call, never after.
- Targeted raw SQL is allowed **only** for Postgres mechanics Prisma can't express:
  `SELECT … FOR SHARE/UPDATE` with quoted fixed identifiers + parameterized values,
  and `SELECT pg_advisory_xact_lock($1)` via `$executeRaw` (the function returns
  `void`, which `$queryRaw` can't deserialize). Everything else goes through the
  query builder.

## Adding a new model

Follow `Group` as the precedent (the newest, most instructive addition). Full 8-step
checklist is in `docs/conventions.md`'s "How do I add a new database model?" section —
don't skip the index/uniqueness planning step (every existing model has at least one
deliberate `@@index` with a comment explaining the query it serves).

# Issue #51 — PostgreSQL migration (implementation record)

**Mode:** FRESH_START (recommended default). The SQLite file was disposable
development data; no SQLite data was copied. The old artifact stays read-only
in the working tree (`prisma/dev.db`, `prisma/benchmark.db` — untracked, never
committed); the tracked SQLite history is archived under
`prisma/migrations-sqlite-archive/` (migrations + `migration_lock.toml` +
`schema.sqlite.prisma`) for forensic value and is never replayed.

**Baseline:** PostgreSQL 17.11, UTF-8, UTC (`docker-compose.yml` pins
`postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`).
Development, CI and restore tooling target this major deliberately; a different
supported major is acceptable only with deliberate realignment.

## What changed

- Provider `sqlite` → `postgresql`; all `DateTime` → `@db.Timestamptz(3)`;
  one reviewed PG baseline `prisma/migrations/20260926075853_init_postgres_baseline/`
  (enums, join tables, unique `(eventId, studentId)`, FKs with
  `RESTRICT`/`SET NULL`/implicit `CASCADE`, indexes). `migrate deploy` into a
  brand-new database verified; `migrate status` clean on dev.
- Runtime adapter `PrismaBetterSqlite3` → `PrismaPg` (`pg` Pool, one bounded
  pool per process: max 8, 5s connect/acquire, 30s idle). `DATABASE_URL` =
  runtime/pooled, `DIRECT_URL` = migration/direct (never a pooler); local dev
  points both at the same server. Remote hosts require verified TLS
  (`rejectUnauthorized`, `sslmode=verify-full`); SQLite/file: URLs refused
  everywhere. New owner: `globals/libs/dbConfig.ts`.
- Guarded-write protocol (`globals/utils/pgLocks.ts`, transaction-scoped
  `pg_advisory_xact_lock` only): attendance/record writes take the shared
  roster lock + `FOR SHARE` event lock + per-pair exclusive lock; roster
  edits/imports/group replacement/deletion/lifecycle take the exclusive form;
  mode/content/lifecycle mutations and deletion take `FOR UPDATE` with re-reads
  after locking. Unquoted SQLite no-op lock removed. Retry only on classified
  serialization/deadlock (`P2034`/`40001`/`40P01`), at most twice.
- Coherent reads use `RepeatableRead`: audience preview (groups validated
  inside the snapshot), event report/export/print snapshot, progress,
  student history, stats, bulk preview/export.
- Name search is explicitly `mode: "insensitive"` (verified: mixed case,
  literal `%`/`_`, ID search). IDs stay text (leading zeros preserved);
  nullable `timein`/`timeout` and time-out-only records preserved; Manila
  presentation unchanged.
- Credentials (#83 preserved): `credentialVersion` in the PG baseline;
  own-change and admin-reset run conditional update + winning-generation
  reread on the same guarded transaction (user rows `FOR UPDATE`, admin
  rechecked inside the reset boundary). Recovery CLI verifies the PG
  maintenance target/identity instead of a database file. No second CLI, no
  second version migration.
- System route reports PG identity (`current_database()` + server version),
  never paths/secrets. Fixtures use disposable `test_*` PG databases with real
  migrations + production adapter + independent pools; `TEST_DATABASE_URL`
  never falls back to `DATABASE_URL`; cleanup restricted to created targets.

## Verification (2026-09-26, Asia/Manila)

- `pnpm exec tsc --noEmit`: clean.
- `pnpm build`: succeeds.
- `migrate deploy` into `event_attendance_verify` (fresh): applied baseline cleanly.
- `pnpm db:seed` on PG dev: 100 students / 29 groups / 10 events / 5 users;
  leading-zero IDs and `timestamptz` confirmed via `psql`.
- Unit (PG): recordAttendance 8/8, progress 5/5 + studentEdit 1/1,
  credentials 7/7, pure suites 19/19.
- HTTP (PG disposable + production build): account-recovery (revocation,
  restriction, races, pending, legacy, old-cookie), operator API (permissions,
  mode conflict, timeout-only, races), progress API, duplicate-event API.
- Search fixture: `contains, mode: insensitive` matches `maria`/`MARIA`,
  treats `100%_Special` literally, matches IDs.

## Untested deployment gates (go/no-go requires these)

- Production endpoint type, supported major, TLS trust chain and connection
  budget recorded; runtime/migration/backup roles created with least privilege
  (runtime: DML/sequences only, no superuser/DDL/creation).
- `pg_dump` taken and restored into a **separate rehearsal database** with
  row-count/report comparison; external `AUTH_SECRET` rotated; smoke checks
  (QR/manual/timeout-only/report/print/import) signed off by a named operator.
- Rollback rule: before new PG writes, return to the frozen setup; after new
  writes, rollback is incident recovery/reconciliation, never a silent URL
  switch. No zero-downtime/dual-write promise.

## Non-goals (unchanged)

No indefinite SQLite+PG support, no new product features, no Prisma/framework
major upgrade, no forced cloud/vendor, no distributed system, no source-data
deletion, no claim that review equals rehearsal.

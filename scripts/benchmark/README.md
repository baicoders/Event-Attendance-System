# Bulk import benchmark & test fixtures

Fixtures and harnesses for verifying that the student bulk import handles a full
2,000+ student roster reliably (issue
[#38](https://github.com/mjfelecio/Event-Attendance-System/issues/38)).

## Files

- `generate-roster.ts` — deterministic generator (fixed seed) that writes a
  ~2,000-student roster. Values only use the seeded group slug vocabulary, so the
  output works against any freshly-seeded database.
- `roster-2000.csv` — the CSV an operator would upload (matches
  `public/templates/student_import_template.csv`).
- `roster-2000.json` — the header-keyed payload the importer sends after parsing
  the CSV (matches react-papaparse `header: true`).
- `direct-transaction.ts` — standalone probe that replicates the route's
  `prisma.$transaction([...upserts])` against a scratch PostgreSQL database
  with query logging and a stopwatch. No HTTP, no Next.js.
- `http-import-benchmark.ts` — reviewed preview/commit benchmark runner. Provisions
  a migrated disposable PostgreSQL database with `TEST_DATABASE_URL`, starts the
  production app, verifies mixed/unchanged/blocked/atomic semantics, and measures
  2,000 and 5,005 rows. Never uses `DATABASE_URL` as its test target.

## Regenerate the fixtures

```bash
pnpm benchmark:roster
```

Idempotent — re-running reproduces the committed files byte-for-byte.

## Scratch database

Both harnesses below need a scratch PostgreSQL database carrying the seeded
group vocabulary. Never point them at the dev or event database.

```bash
# 1. Start local PostgreSQL 17
docker compose up -d db

# 2. Create a disposable database and apply the real migrations
export SCRATCH="postgresql://postgres:postgres@127.0.0.1:5433/test_benchmark"
psql "postgresql://postgres:postgres@127.0.0.1:5433/postgres" -c "CREATE DATABASE test_benchmark;"
DATABASE_URL="$SCRATCH" DIRECT_URL="$SCRATCH" pnpm db:deploy

# 3. Seed the group vocabulary, then clear the roster-sized tables
#    (seed is fully destructive — safe here because the target is disposable)
DATABASE_URL="$SCRATCH" DIRECT_URL="$SCRATCH" pnpm db:seed
psql "$SCRATCH" -c 'DELETE FROM "Record"; DELETE FROM "Event"; DELETE FROM "Student";'
```

Both `DATABASE_URL` and `DIRECT_URL` must point at the scratch database:
migrations and the seed resolve `DIRECT_URL` first and would otherwise hit the
database from `.env`. Drop the scratch database when done:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:5433/postgres" -c "DROP DATABASE test_benchmark;"
```

## Direct probe (no server)

Point it at the scratch database:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/test_benchmark" pnpm benchmark:probe
```

It prints the transaction duration, SQL statement count, and whether any
timeout fired. It logs every statement; pipe through `2>&1 | grep -v
'^prisma:query'` for a summary only.

## Reviewed end-to-end benchmark

```bash
pnpm build
pnpm benchmark:import
```

`TEST_DATABASE_URL` must point at the dedicated PostgreSQL test control database
with CREATEDB privilege. The harness creates and drops a unique `test_*` database,
uses fixture ADMIN accounts and Groups, and starts the built app on an allocated
local port. No production data or passwords are needed.

Evidence includes UTF-8 CSV and complete request bytes, preview/commit duration,
app/fixture RSS change, and attendance latency while the import holds the roster
lock. Both 2,000 and 5,005 rows remain importable; the UI threshold is advisory.
The retained direct probe measures historical raw Prisma transaction overhead;
it does not establish the reviewed import contract.

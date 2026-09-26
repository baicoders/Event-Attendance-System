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
- `http-import-benchmark.ts` — end-to-end harness: logs in, POSTs the roster to
  the real `/api/bulk-import/students`, then inspects the database to verify the
  outcome. Requires the app already running against the same PostgreSQL database.

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

## End-to-end harness (server required)

```bash
# 1. Start the app against the scratch DB (production build recommended)
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/test_benchmark" pnpm start

# 2. In another terminal, run the harness against the same database
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/test_benchmark" pnpm benchmark:import [fresh|rerun|invalid|all]
```

`BASE_URL` (default `http://localhost:3000`) and `ADMIN_EMAIL`/`ADMIN_PASSWORD`
(default `admin@gmail.com` / `password`) are also configurable.

Scenarios:

- `fresh` — POST the full roster to an empty Student table.
- `rerun` — POST the same roster again; must not create duplicates.
- `invalid` — POST the roster with one bad group slug; the whole batch must be
  rejected and nothing changed.
- `all` — fresh, then rerun, then invalid (default).

`test_benchmark` is a scratch database, never the dev or event database. It
holds no special files — just drop it when done.

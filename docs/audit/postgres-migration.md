# SQLite → PostgreSQL Migration Assessment

> **Implemented (issue #51).** The migration assessed below has landed:
> `provider = "postgresql"`, a single squashed PG baseline migration (the old
> SQLite history is archived under `prisma/migrations-sqlite-archive/`),
> `PrismaPg` over a `pg` pool at runtime and in the seed, the guarded-write
> protocol with Repeatable Read snapshots, and case-insensitive name search.
> The rest of this file is the **historical pre-migration assessment**,
> preserved as written — see
> `docs/releases/issue-51-postgres-migration.md` for cutover evidence.

Scope: identify what will and won't carry over cleanly if this app moves to Postgres
later. **Nothing here is a beta blocker** — per the audit brief, theoretical
scalability is explicitly out of scope for the one-week release decision. This is a
forward-looking assessment only, to save time when that migration is eventually
planned.

---

## Bottom line

The **application code** is essentially portable — Prisma's query builder abstracts
almost everything, there's no raw SQL, and enums/relations map directly to Postgres
equivalents. The **migration history** is not portable at all — it's 13 files of SQLite
DDL that cannot be replayed against Postgres. The move is: squash to a fresh baseline
migration generated against a Postgres datasource, migrate data separately, swap one
adapter package. This is a contained, well-understood piece of work, not a rewrite.

---

## What transfers cleanly

- **No raw SQL anywhere.** No `$queryRaw`, `$executeRaw`, or SQLite-specific SQL
  functions in any route handler or utility reviewed. Every query goes through the
  Prisma Client query builder, which generates the correct dialect for whatever
  datasource is configured.
- **All enums are real Prisma `enum` declarations** (`UserRole`, `UserStatus`,
  `EventStatus`, `AttendanceMethod`, `YearLevel`, `SchoolLevel`, `EventCategory`) —
  these map directly to native Postgres `ENUM` types with no application-code changes.
- **IDs are `cuid()` strings**, not SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` —
  Postgres has no trouble with string primary keys, and there's no autoincrement
  behavior anywhere to worry about re-seeding sequence counters for.
- **`DateTime` fields carry no SQLite-only semantics** — no reliance on SQLite's
  flexible/dynamic typing for dates, no string-formatted date comparisons found.
- **SQLite coupling in application code is exactly two files**:
  `globals/libs/prisma.ts` and `prisma/seed.ts`, both only for constructing the
  `PrismaBetterSqlite3` adapter. Swapping to `@prisma/adapter-pg` (or the plain
  Postgres connection string form) touches only these two files.
- **Cascading/restrict behavior is expressed in the Prisma schema**
  (`onDelete: Restrict`, `onDelete: SetNull`, implicit `Cascade` on many-to-many join
  tables) — these are dialect-independent Prisma schema directives, not raw SQL, and
  will regenerate correctly for Postgres.

---

## What actually blocks a direct migration

### 1. Every migration file is SQLite-specific DDL

```
$ grep -rl "PRAGMA defer_foreign_keys" prisma/migrations/
20260408082631_remove_section_as_static_field/migration.sql
20260720235052_add_record_audit_actors_and_roster_indexes/migration.sql
20260401092434_remove_contact_number_in_student/migration.sql
20260219071858_remove_attendance_status_and_make_time_in_optional/migration.sql
20260219014225_add_is_timeout_column_to_events/migration.sql
20260117013118_add_timeout_time_in_to_record/migration.sql
20251010175148_student/migration.sql
20260128152609_user_status/migration.sql
```

8 of the 13 migrations use SQLite's table-rebuild pattern
(`PRAGMA defer_foreign_keys=ON` → `PRAGMA foreign_keys=OFF` → create new table → copy
data → drop old → rename → `PRAGMA foreign_keys=ON`) because SQLite can't do most
`ALTER TABLE` operations directly. This is 100% SQLite-only syntax — Postgres would
reject every one of these files outright. `prisma migrate deploy` cannot be pointed at
a Postgres database with this migration history.

**Migration risk:** none of these files can be replayed. The only viable path is
`prisma migrate diff` (or simply `prisma db push` once) against a fresh Postgres
database using the *current* `schema.prisma` as the source of truth, generating one new
baseline migration. Existing data must be migrated separately (export from SQLite,
transform, import to Postgres) — schema history and data history are two different
problems here.

### 2. `migration_lock.toml` pins the provider

```toml
provider = "sqlite"
```

Prisma refuses to apply migrations from a history locked to a different provider than
the configured datasource. This file must be regenerated (or the migrations directory
reset) as part of the cutover — expected and low-risk, just noting it so it isn't a
surprise mid-migration.

### 3. The driver adapter and its dependencies need swapping

`globals/libs/prisma.ts`:
```ts
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
...
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
```

This needs to become `@prisma/adapter-pg` (or Prisma's built-in Postgres support
without a driver adapter, depending on how the project wants to run it), with a
Postgres connection string in `DATABASE_URL` instead of a `file:` path. `prisma/seed.ts`
has the identical adapter construction and needs the same change. Once done,
`better-sqlite3`, `@types/better-sqlite3`, and the `pnpm-workspace.yaml`
`onlyBuiltDependencies` entry for it can be removed — they're native-module build
dependencies that Postgres doesn't need.

### 4. Case-sensitivity: currently a non-issue, but will matter if server-side search is ever added

SQLite's `LIKE` is case-insensitive by default; Postgres's is case-sensitive (Postgres
uses `ILIKE` for case-insensitive matching, or needs `citext`/lowercasing). **Today this
doesn't matter** — grep confirms no query anywhere uses `contains` or `startsWith`; all
text search (student name search, event filtering) happens client-side in the browser
against an already-fetched array (`globals/utils/fuzzySearch.ts`). This becomes
relevant only if/when server-side search is added post-migration — worth a note in
whatever ticket adds that feature, not an action item now.

### 5. SQLite's single-writer lock vs. Postgres's MVCC concurrency

The application's compare-and-set pattern
(`updateMany(... WHERE column IS NULL)`) was explicitly designed *because* SQLite
serializes writers and the team wanted to avoid holding long transactions
(`architecture.md` §12, §18). This pattern is not SQLite-specific — it works
identically and correctly under Postgres's MVCC model, and would continue to be the
right pattern to keep (it's what makes concurrent scans safe regardless of database).
Moving to Postgres *removes* the write-serialization ceiling but doesn't require
changing this logic — it's a portable design decision, not a workaround to undo.

### 6. The bulk-import transaction ([`DATA-01`](./data-integrity.md#data-01)) behaves differently but not necessarily better

Prisma's default transaction `timeout`/`maxWait` apply identically regardless of
database. Postgres's MVCC concurrency would likely make each individual `upsert`
faster than SQLite's serialized writes, which *may* reduce (but does not eliminate) the
risk of hitting the transaction timeout at 2,000+ rows — this should not be treated as
"Postgres fixes it." The fix recommended in `data-integrity.md` (explicit timeout
override, or chunked/interactive transaction) is dialect-independent and should be done
regardless of which database is in play.

---

## Recommended order of operations, when this migration is actually planned

1. Fix `DATA-01`'s transaction timeout issue first, under whichever database is current
   at the time — it's dialect-independent and shouldn't be deferred to "after the
   Postgres move."
2. Stand up a Postgres instance; point `prisma.config.ts`'s datasource at it.
3. Generate one fresh baseline migration from the current `schema.prisma` against that
   Postgres database (`prisma migrate dev` or `prisma db push` for the initial schema);
   discard/replace the SQLite migration history — it cannot be replayed and there's no
   value trying to.
4. Swap `@prisma/adapter-better-sqlite3` → `@prisma/adapter-pg` in
   `globals/libs/prisma.ts` and `prisma/seed.ts`; remove the SQLite native-module
   dependencies.
5. Write a one-time data migration script (SQLite → Postgres) for existing production
   data, if any exists at that point that needs to carry over. Test it against a copy,
   not the live file.
6. Re-run the full smoke-test list from `release-readiness.md` against the Postgres
   deployment before cutting over.

None of this needs to happen before the beta. It's recorded here so it's a planned
project next time, not a rediscovery.

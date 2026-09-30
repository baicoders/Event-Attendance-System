# Reviewed student masterlist import

Only usable ADMIN accounts can open `/students/import`, preview or commit. Deploy
its UI and API together. Older direct clients receive `410 REVIEW_REQUIRED` from
`POST /api/bulk-import/students`; that endpoint performs no roster writes.

Upload canonical UTF-8 CSV with exactly these eleven headers (order may vary):

```text
id,lastName,firstName,middleName,schoolLevel,yearLevel,section,house,program,department,strand
```

IDs remain eleven-character text, preserving leading zeros and alphanumeric IDs.
Names and IDs trim according to the existing Student schema; Group slugs trim and
lowercase according to the existing Group resolver. Optional blank cells normalize
to empty/null. Enum values are never repaired. BOM, CRLF and quoted multiline CSV
retain physical source row identity. Missing/duplicate/unexpected headers, malformed
CSV and empty files require source replacement. Duplicate IDs become row blockers.

The canonical CSV owns student fields. Fix ordinary errors in the CSV and replace
it. Unknown Groups block import; an ADMIN can explicitly create one through the
existing Group form/API with the CSV slug and fixed category, then re-preview.
That independent configuration change persists even if import is abandoned.
Normal management remains available at `/settings#groups`.

Preview returns CREATE / UPDATE / UNCHANGED / BLOCKED, exact field changes and
category/slug reference counts. It performs zero Student writes. Existing invalid
or ambiguous memberships block a full replacement rather than disappearing silently.
Only IDs in the CSV are affected; absent students and their attendance are untouched.
Membership changes can affect eligibility and reports derived from the current roster.

The technical maximum is **10 MiB (10,485,760 bytes) each** for the actual UTF-8 file
and complete HTTP request. JSON escaping, filename and token metadata count toward
the request boundary, so a file near the maximum may need splitting even when its
file bytes fit. Both boundaries are enforced client and server; the streaming server
body reader also measures received bytes independently of Content-Length. **There
is no row-count limit.** At 2,000 rows the UI shows an advisory and Continue anyway.

The v1 request sends `{v, fileName, sourceHash, csv}`. Commit adds `previewToken`.
Sending source lets the server independently repeat parser/header validation and
SHA-256 verification. The normalized ordered rows and physical row identities are
hashed separately. The compact purpose-specific HMAC token binds ADMIN identity,
filename/source/input, every current Student content version (including absence),
complete memberships, referenced Group IDs/slugs/categories/display names, and a
10-minute expiry. Preview reads use one PostgreSQL RepeatableRead snapshot.

Commit parses/hashes before entering a single ReadCommitted transaction. It locks
the actor row, confirms current role/status/credential generation, takes the exclusive
roster advisory lock, and re-reads Students and Groups. It also locks relevant Group
rows FOR SHARE in deterministic order because cosmetic renames do not use the roster
lock. A changed review returns 409 with zero writes. Only CREATE and UPDATE rows are
written, so UNCHANGED timestamps stay intact. Transaction budgets remain 120 seconds
with a 30-second pool wait; there are no jobs, queues or independently committed chunks.

An explicit rejection is distinguishable from an uncertain outcome. A callback that
fails before COMMIT rolls back and returns IMPORT_REJECTED. A missing, malformed or
lost commit acknowledgement is **Outcome unknown**; the tab retains the submitted
source and never auto-retries. Check the current roster before starting another review.
Durable resolution and exact-command replay are the separate #100 extension.

Verification (all database fixtures create unique disposable `test_*` databases;
TEST_DATABASE_URL is mandatory and never falls back to the school/application DB):

```bash
pnpm build
pnpm test:student-import
node --import tsx scripts/test-student-import.mjs --large --browser
node scripts/test-student-bulk.mjs --browser --large
pnpm test:operator-api
node --conditions=react-server --import tsx --test $(rg --files -g '*.test.ts')
pnpm exec tsc --noEmit
pnpm lint
```

The import fixture audits actual Student writes, independent PostgreSQL locks,
stale Students/Groups, rollback, withheld mid-import state and concurrent attendance.
Large measurements and browser screenshots are recorded in the issue PR's evidence.
No schema migration or historical import backfill is introduced by #99.

Measured on disposable PostgreSQL 17.11 (2026-09-30), with a production Next build:

| CSV rows | CSV bytes | Commit request bytes | Preview | Commit |
| --- | ---: | ---: | ---: | ---: |
| 2,000 | 162,985 | 165,693 | 318 ms | 8,847 ms |
| 5,005 | 409,395 | 415,108 | 254 ms | 19,757 ms |

The exclusive roster lock spans the complete commit. Existing attendance transactions
have a four-second budget: scans waiting behind these imports rejected with confirmed
rollback and no Record changes, then succeeded on explicit retry after import. Schedule
large imports outside active scanning periods. These measurements establish advisory
behavior and atomicity on the fixture host; they are not a production capacity promise.
The application RSS deltas were approximately 46.3 MiB and 5.6 MiB respectively;
these process snapshots include garbage collection and are not peak-memory bounds.

The expanded browser fixture covers actual post-commit response loss, native keyboard
file selection/confirmation, late Group creation and preview responses, logout, normal
Settings Group creation/rename, and 375px layouts. The independent review's late Group
callback finding was reproduced before the fix and passes after binding callbacks to
their originating file and generation.

Repository lint retains seven errors and twelve warnings in untouched baseline code.
The clean main baseline had twelve errors and twelve warnings; removal of the old
importer removes five existing errors. Changed import files pass ESLint. Two existing
regression fixtures were made deterministic: history evaluation uses its fixture date,
and the bulk browser waits safely while document.body is absent during navigation.

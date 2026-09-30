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

The v1 request sends `{v, fileName, sourceHash, csv}`. Commit adds `previewToken` and one client UUID `commandId`.
Sending source lets the server independently repeat parser/header validation and
SHA-256 verification. The normalized ordered rows and physical row identities are
hashed separately. The compact purpose-specific HMAC token binds ADMIN identity,
filename/source/input, every current Student content version (including absence),
complete memberships, referenced Group IDs/slugs/categories/display names, and a
10-minute expiry. Preview reads use one PostgreSQL RepeatableRead snapshot.

Commit parses/hashes before entering a single ReadCommitted transaction. It locks
the actor row, confirms current role/status/credential generation, then takes the
actor/command advisory lock. It checks for an existing immutable receipt before any
roster work. First execution takes the exclusive roster advisory lock and re-reads
Students and Groups. It also locks relevant Group
rows FOR SHARE in deterministic order because cosmetic renames do not use the roster
lock. A changed review returns 409 with zero writes. Only CREATE and UPDATE rows are
written, so UNCHANGED timestamps stay intact. Transaction budgets remain 120 seconds
with a 30-second pool wait; there are no jobs, queues or independently committed chunks.

An explicit rejection is distinguishable from an uncertain outcome. A callback that
fails before COMMIT rolls back and returns IMPORT_REJECTED. A missing, malformed or
lost commit acknowledgement is **Outcome unknown**; the tab retains the submitted
command body and UUID and never auto-retries. **Check result** reads only the current
actor's command reference; a missing receipt does not prove rollback while the original
request may still be running. **Retry same reviewed import** sends the exact frozen
body, UUID and preview identity. An existing exact receipt returns `replayed: true`
without taking the roster lock or reading/writing Students or Groups, even after token
expiry or later roster changes. A valid different command under the same actor/UUID
returns `409 IMPORT_COMMAND_REUSED`. Tampered or wrong-actor tokens are always rejected.
Another administrator using the same UUID has an independent command namespace.

First execution still requires a fresh review. Material changes, strict receipt
construction, receipt insertion and validation of the persisted receipt all share one
transaction. Any construction/insertion/validation failure rolls everything back.
The complete serialized receipt and retained result also have a 10 MiB technical
bound (PostgreSQL canonical JSONB text is checked separately); a request whose result
exceeds it is rejected atomically and needs a smaller source file. This is a resource
boundary, with no row-count cap.

`StudentImportBatch` stores server ID, actor/UUID, historical actor name, display
filename, exact-source/normalized-input/request SHA-256 hashes, counts, versioned JSONB,
and creation/commit observation times. CREATE retains the normalized created projection;
UPDATE retains a label and exact diffs; UNCHANGED retains only CSV row/ID/status.
No raw CSV, preview token, browser metadata, credentials or parser state is retained.
Times are server observations before COMMIT, not an assertion of PostgreSQL's exact
commit instant. Receipts are retained indefinitely; there is no delete/purge API.

Recent ADMIN history uses at most 20 metadata rows with `(committedAt, id)` keyset
pagination; it never selects result JSONB. Normal history detail uses server receipt ID
and is available to current usable ADMINs. Command resolution uses actor+UUID only,
so guessing a command UUID cannot fetch another administrator's receipt. All reads
recheck current authorization and use `Cache-Control: private, no-store`. Detail is
historical evidence: current Student values may have changed. Group creation during
review remains a separate configuration action and is not attributed to the receipt.

Apply the additive receipt migration before deploying the coordinated UI/API build.
It does not alter Student/attendance data or backfill earlier imports. Whole-database
PostgreSQL backups include receipts and their indexes. **Disable imports before rolling
back to a build that can import without receipts**; prefer a forward fix. Otherwise
replay/audit guarantees would silently disappear.

Verification (all database fixtures create unique disposable `test_*` databases;
TEST_DATABASE_URL is mandatory and never falls back to the school/application DB):

```bash
pnpm build
pnpm test:student-import
pnpm test:student-import-durability
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

Baseline #99 measurements before receipt persistence, on disposable PostgreSQL 17.11
(2026-09-30), with a production Next build:

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


Full #100 reviewed-plus-receipt measurements on the same disposable PostgreSQL17 host:

| Rows | Commit request bytes (including UUID) | Preview | Commit | Observed DB transaction | Receipt JSONB text / stored bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 165,744 | 294 ms | 9,205 ms | 9,132 ms | 641,804 / 33,143 |
| 5,005 | 415,159 | 255 ms | 17,594 ms | 17,509 ms | 1,609,414 / 82,303 |

Database transaction observation samples the actual backend's xact_start until it
leaves that transaction, at 25 ms intervals. JSONB stored bytes reflect PostgreSQL
compression; JSONB text is the uncompressed database representation. Receipt wire
bytes were 584,392 and 1,464,857. CSV bytes were 162,985 and 409,395; preview requests
were 165,109 and 414,524. Application RSS deltas were 38,612,992 and 65,105,920 bytes
(approximately 36.8 and 62.1 MiB); fixture-process deltas were -17,977,344 and 3,629,056.
These are process snapshots, not peak memory measurements.

Four concurrent attendance requests in each run waited approximately 9.09/17.48
seconds and returned the existing confirmed-rollback 503 response with zero Record
changes. PostgreSQL's pending advisory-lock query waits for release even after the
attendance transaction's four-second budget has elapsed. Explicit post-commit retries
succeeded in 27–124 ms and 43–66 ms. No attendance semantics or budgets were changed.
There remains no row-count cap; import budgets and byte limits stay explicit.

The final receipt fixture verifies exact concurrent command serialization, old replay
after a supported Student edit and Group rename, expired exact replay with Student/
Group operations forbidden by an instrumented client, receipt insertion/runtime
validation rollback, and metadata pagination over identical timestamps. Fresh upgrade
and real whole-database PostgreSQL17 restore preserve existing data and all receipt
fields, hashes, JSONB and indexes. Unit fixtures accept exactly the result byte bound,
reject the next byte and multibyte amplification, and account for complete-receipt
metadata overhead.


The #100 production browser fixture verifies actual response loss after commit,
Check result and frozen-body retry with PostgreSQL audit checkpoints proving zero
repeated Student writes/receipts. It also aborts before receipt, checks the honest
missing/in-flight wording, and executes that same UUID once on explicit retry.
History/detail filters, 20-row pagination, historical warnings, desktop/375px layouts,
late result after logout/account switch and late detail after logout pass. Native
keyboard file activation waits for the authenticated view and asserts actual focus;
this avoids dispatching a key against an element replaced during page startup.

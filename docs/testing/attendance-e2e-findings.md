# Attendance E2E findings — 25 October 2026

The suite targets the school deployment: a local production build, PostgreSQL,
Caddy HTTPS, mobile Chrome emulation for attendance, and desktop administration.
The fixture contains 2,000 synthetic students and five separate operator accounts.
No deployed-site data or real student attendance was changed.

## Follow-up fixes

The three reported issues have been addressed:

- Manual-entry status now reads all stored eligible records, including time-out-only
  evidence, using `includeWithoutTimeIn=true`. Those records still do not count as
  checked in. The status query has a separate cache key under the existing
  invalidation prefix, without polling an entire absent roster.
- The correction sheet keeps controls disabled through confirmation, save, and
  evidence refresh, including exact-command retries. The saved message appears
  after that refresh. A delayed-history browser regression reproduces the former
  race deterministically, and cancellation is checked for accidental writes/locks.
- The decoder is copied from the scanner's exact installed dependency and served
  locally. The fresh-browser QR regression requires a successful local WASM
  response and zero external requests while recording and repeating a real scan.

All three targeted browser cases and the full 20-scenario suite passed. Follow-up
verification is recorded below. Original evidence is retained as the baseline.

## Original confirmed findings

### 1. A time-out-only student still offers “Record time out”

**Regression:** `03-timeout-and-missing-timein`.

Reproduce on the normal attendance page:

1. Select an approved event and switch it to time-out mode.
2. Record time-out for an eligible student who has no time-in.
3. Choose “Next student,” then search for the same student again.
4. The row still offers an enabled “Record time out” action instead of the
   disabled “Already timed out” action used for other completed records.

The database has the correct time-out and an empty time-in. The row-status lookup
in `ManualAttendanceSection` uses the present-only event-records query, which omits
records without time-in. Consequently it interprets this existing record as absent.
This is misleading UI; the server's write-once guards protect the saved timestamp.
The original regression is retained and now checks both the normal and focused
operator routes, as well as exclusion from the checked-in table.

### 2. Cold QR fallback decoding requires an external CDN

**Regression:** `10-no-internet-camera`.

Original reproduction in a fresh browser:

1. Keep access to the local Caddy HTTPS application and local database.
2. Block external internet access and open the scanner.
3. Present a valid QR card. Camera capture opens, but decoding cannot initialize
   and no attendance confirmation appears.

The decoder requests:

`https://fastly.jsdelivr.net/npm/zxing-wasm@2.2.2/dist/reader/zxing_reader.wasm`

The same QR images decode and save successfully with that request permitted.
Fresh login and manual attendance also work with external requests blocked.
The blocked WASM fetch and browser error are recorded in the diagnostics.

The initial run used Linux Chrome under Android emulation. Follow-up source
inspection found that installed `@yudiel/react-qr-scanner` 2.4.1 imports the
`barcode-detector` ponyfill directly; browser-native detection alone does not
bypass that decoder in this version. The follow-up fix serves the same matching
WASM from the laptop, removing the runtime CDN requirement.

### 3. Immediate follow-up admin action can be silently ignored

**Regression:** `15-admin-correct-void-restore` (intermittent; reproduced in run 2).

1. Correct a record and confirm it.
2. Once “Attendance change saved” appears, choose “Void,” enter a reason, and
   select “Review and void” while the history refresh is still pending.
3. The enabled button does nothing: the expected confirmation dialog never opens.
   After the refresh finishes, another click can proceed.

The correction sheet announces success before awaiting `history.refetch()`, but
holds `submitting.current` until that read completes. The UI enables the next
submission because mutation pending has ended; `submit()` then silently returns
while the separate submitting guard is still true. No void request is sent.

The run-2 trace independently confirms the sequence (trace monotonic milliseconds):

- CORRECT POST: 237765.374, duration 277.143, HTTP 200.
- History GET: 238051.538, duration 835.606, HTTP 200.
- “Review and void” click: 238268.470, during that pending GET.
- No void POST or confirmation dialog followed the click.

This is a UI timing issue, not a lost correction or damaged record. The first
correction remains saved. Reproduce more readily by slowing the history read in
browser developer tools and making the next action promptly after the saved
message. The normal correct/void/restore sequence, including before/after audit
snapshots, passed in run 1. The regression now deliberately holds the history read and checks that
follow-up controls remain disabled until evidence is ready.

## Verification record

### Original baseline

Tested application baseline: `1dcd909a4a3f` (product source unchanged).
Failed regressions are deliberately retained and the command returns exit status 1.

| Fresh-database run | Browser results | Local artifacts |
|---|---|---|
| 1 | 18 passed, 2 confirmed failures | `test-results/attendance-e2e/2026-10-25T03-33-58-306Z-240352/` |
| 2 | 17 passed, 3 confirmed failures | `test-results/attendance-e2e/2026-10-25T03-39-48-464Z-253021/` |

Both runs completed all 20 scenarios with no infrastructure failure. Scenarios
03 and 10 failed in both runs; run 2 additionally exposed the intermittent
follow-up-action race in scenario 15. The other 17 scenarios passed in both.
Earlier exploratory runs exposed harness startup/readiness issues on this busy
host; those runs are not counted as repeatability evidence. Supporting command
logs are in `test-results/attendance-e2e/supporting-checks/`.

Supporting checks already completed:

- Production build passed; TypeScript type-check passed.
- Existing attendance suites: 26 operator, 17 progress, and 27 correction/manual
  tests passed (70 total).
- Existing operator, progress, and attendance-correction HTTP integration scripts
  passed, including authorization, mode races, and concurrent writes.
- New database safety, cleanup, and failure-reporting regression checks passed.
- ESLint passed on new JavaScript test files. Repository-wide lint still reports
  five errors in unchanged files: `StepIndicator.tsx` (one explicit-any error),
  `getDynamicFilters.ts` (two explicit-any errors), and `DataTableStates.tsx`
  (two unescaped-apostrophe errors), plus nine warnings.

A fresh reviewer checked the harness. Follow-up changes strengthened crash and
cleanup reporting, CSV timestamps and printed totals, no-write details viewing,
and before/after audit-history assertions. These changes affect tests only.

### Follow-up verification

| Check | Result | Local evidence |
|---|---|---|
| Targeted cases 03, 10, 15 | 3/3 passed | `test-results/attendance-e2e/2026-10-25T04-19-17-753Z-305243/` |
| Complete attendance flow | 20/20 passed, exit 0 | `test-results/attendance-e2e/2026-10-25T04-31-34-216Z-328292/` |
| External browser requests in the complete run | 0 | Complete run `report.json` diagnostics |
| Existing attendance unit/database checks | 70 passed | Follow-up supporting logs |
| Fixture, reporting, cleanup and decoder checks | 6 passed | Complete run + decoder asset SHA/compile check |
| Production build, type-check, changed-file ESLint | Passed | Follow-up supporting logs |
| Stored-record API view | Passed | `includeWithoutTimeIn` rows, absent status, and conflicting flags |

The full run verifies the physical-operator workflow through simulated cameras
and mobile browser contexts. The mode-conflict regression now recovers through
“Acknowledge result” and “Review mode and continue,” and all actual writes are
still checked against independent PostgreSQL evidence.

An independent review found no introduced blockers. Two pre-existing correction
edge cases were noted outside these reproduced fixes: a failed post-save history
read can leave cached evidence with optimistic success wording, and switching
students while an earlier save completes can reuse the sheet's local state.
These are deferred review observations, not claims covered by this verification.

## What remains a physical-device check

The reusable suite does not operate your phone, certificate store, or school
router. Follow the [Android checklist](attendance-e2e.md#physical-android-check-at-school)
for actual rear-camera scanning, trusted certificates, lighting, screen lock,
background/resume, and Wi-Fi reconnection. No offline attendance queue is promised
when a phone cannot reach the laptop.

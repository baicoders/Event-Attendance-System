# Student attendance history

Staff open **Attendance history** from a student row. The panel also exports
`StudentAttendanceHistoryPanel({ studentId, enabled, variant })` for an embedded
student page. `variant="recent"` requests the same recorded view with five rows.

The read-only endpoint is
`GET /api/students/{id}/attendance-history?view=recorded|current-roster&from=YYYY-MM-DD&to=YYYY-MM-DD&outcome=all|attended|late|missing&search=title&page=1&pageSize=25`.
The default is recorded participation for 90 inclusive calendar dates ending
today in **Asia/Manila**. `from` and `to` filter the **event start date**, not
the scan date. The maximum range is 366 dates, search is at most 100 characters,
and page sizes are 5, 10, 25, 50, or 100. Invalid filters return 400. More than
1,000 approved candidate events returns 422 `HISTORY_RANGE_TOO_LARGE`; the API
never sends a truncated ratio. A shrinking result set clamps the requested page
to the last available page.

Recorded participation includes surviving records on approved events, even if
the student's current groups no longer match. Current-roster comparison includes
approved events in the date range that match the student's **current** audience.
Its rate includes only events whose start and end are both before the start of
today in Asia/Manila. A time-in counts as attendance, including a late arrival
or a missing time-out. Missing time-in counts as current-roster absence only for
that retrospective denominator. The system has no historical enrollment or
audience snapshots; this rate is not a verified lifetime attendance rate.

The endpoint uses one bounded read transaction and fetches only this student's
records for the candidate events. It returns `Cache-Control: private, no-store`.
Client query keys include the principal ID and protected data is removed on
logout, account change, or 401/403. Record, student, group, and event mutations
invalidate the history prefix.

## Verification

Run pure rules with:

```sh
node --import tsx --test globals/schemas/studentHistory.test.ts globals/utils/studentHistoryProjection.test.ts
```

Build, then run the disposable HTTP fixture. It creates a temporary SQLite
database, applies migrations, starts the built app on an unused local port,
tests auth and visibility, and removes the database afterwards:

```sh
npm run build
node scripts/test-student-history.mjs
node scripts/test-student-history.mjs --large
node scripts/test-student-history.mjs --browser
```

The large mode adds 2,000 students and 1,000 candidate events, measures a warm
25-row request with four concurrent history requests and concurrent scans, and
asserts that event 1,001 gives 422. Latency depends on the machine; the runner
prints actual payload and latency values rather than embedding a fixed claim.
The browser mode uses installed Chrome at a 375 px viewport, opens and closes
the Sheet with keyboard input, checks the comparison warning, and writes
`/tmp/student-history-mobile.png` for visual review.

On the 2026-09-26 local run against the current main integration, the large
fixture returned a 9,666-byte 25-row payload. With 20 history reads at
concurrency four and five simultaneous scans, history latency was p50 192.5 ms
and p95 376.3 ms; the slowest scan was 464.5 ms. Query count was not instrumented in this run. The Chrome fixture
passed Enter/Escape interaction and the 375 px Sheet width check; its screenshot
was visually reviewed after the warning heading was changed to wrap.

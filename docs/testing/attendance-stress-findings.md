# Event rehearsal findings

## Recommendation

Use **focused operator mode (`/attendance/operator`) on all five phones** and run
the production Next app, Caddy and PostgreSQL with unrelated development workloads
closed. The complete operator baseline handled 3,000 check-ins in 30 minutes with
zero failures, p95 0.63 seconds and p99 1.09 seconds. This is useful evidence that
the server can support the event's five-operator workload under lighter host load.
Attendee count is transaction volume; it does not mean 3,000 simultaneous clients.

Keep the laptop's admin on the paginated progress page. Complete roster imports
before check-in, keep the laptop powered and awake, and check trusted HTTPS and
camera access on the actual phones. The largest remaining application improvement
is server-side pagination of the regular attendance lists; focused operator mode
already avoids most of that background traffic.

## Evidence and limits

The rehearsal tools and the two attendance query optimizations are implemented.
The optimized production build, short HTTPS load run, 20 browser scenarios and
phone-mode server smoke test passed. The full timings have background-workload
confounding, so they do not establish a controlled before/after speedup. No further
runs are scheduled, as requested after the background overlap was confirmed.

The long runs overlapped Expo development and additional Playwright browsers.
The user confirmed these workloads caused the slowdown. Retained failures are
observations of that shared-host workload; they do not establish a performance
regression from the query changes. The interrupted optimized run was stopped
gracefully and its disposable database was removed.

Use the [rehearsal runbook](attendance-stress-test.md) to repeat the full profile
with the background workload expected at the event, then test the actual five
phones and Wi-Fi. Loopback automation does not measure radio contention, camera
decoding or physical-phone browser behavior.

## Implemented changes

Successful attendance writes reuse actor, event and student labels already read
inside the guarded transaction when writing the audit entry. Duplicate scans
return the existing locked record directly. Authorization, locks, recording-mode
checks, transaction budgets, audit snapshots and first-timestamp preservation
remain covered by the attendance regression suite.

| Additional database reads | Before | After |
| --- | ---: | ---: |
| Audit-label lookups per successful write | 3 | 0 |
| Record reread per duplicate scan | 1 | 0 |

These reductions are verified by real PostgreSQL query-count tests, including
renamed audit labels and repeated time-outs. Wall-clock speedup is not inferred
from runs with different background activity.

The runner adds disposable databases with real migrations, isolated production
builds, verified Caddy HTTPS, five independent operator sessions, mixed QR/manual
entry, screen-specific reads and polls, live admin progress, fixed offered
arrivals, backlog reporting, CPU/memory evidence, and record/audit reconciliation.
It protects against idle sleep when supported and rejects host clock/suspend
interruptions. Cancellation handles forked processes and waits for cleanup.

Phone mode uses the existing Caddy address and refuses an occupied app port. It
offers a near-full event with 2,900 synthetic records/audits plus 100 fresh QR
cards, and a separate empty event. It verifies that the proxy reaches its own
synthetic administrator before displaying test credentials.

## Completed measurements

Host: Intel Core i5-8350U, approximately 11.4 GiB RAM, PostgreSQL 17.11. The load
generator shares the laptop with the app, database, proxy and other applications.
Each screen received 3,000 offered check-ins over 30 minutes and 3,000 departures
over ten minutes, with five operators and one admin viewing 50-row progress.

The completed **contended baseline** is retained at
[report.json](../../test-results/attendance-load/baseline-full-2026-10-27T12-16-59-250Z-260162/report.json).

| Screen / phase | Successful operations | Actual minutes | p95 ms | p99 ms | Missed arrival slots |
| --- | ---: | ---: | ---: | ---: | ---: |
| Operator check-in | 3,000 / 3,000 | 30.01 | 628.74 | 1,085.70 | 0 |
| Operator departure | 3,000 / 3,000 | 10.00 | 949.84 | 1,558.57 | 166 |
| Regular check-in | 2,980 / 3,000 | 30.03 | 2,148.21 | 7,124.54 | 197 |
| Regular departure | 2,997 / 3,000 | 30.87 | 4,699.63 | 6,146.01 | 2,988 |

Operator check-in met the latency/rate targets in this observation, with no
request failures or data discrepancies. Regular check-in had 20 failed operations
and 34 failed background reads; reconciliation found exactly 2,980 records and
2,980 matching audits. Departure reconciliation also exposes the missing earlier
time-ins. These failed attempts are not evidence of silently lost successful
writes. The overall profile verdict is **failed**.

The optimized [short run](../../test-results/attendance-load/improved-full-2026-10-27T14-01-34-025Z-340063/report.json)
completed 100 check-ins and 100 departures per screen, with no request or
reconciliation failures. Its roster was 3,000, but its attendance lists were only
partially populated; it does not establish full-event capacity. The subsequent
[interrupted full run](../../test-results/attendance-load/improved-full-2026-10-27T14-10-31-224Z-354255/report.json)
is incomplete and cannot be compared as a successful full profile.

Host pressure was substantial during failures: baseline swap use peaked near
8.27 GB, available memory fell near 1.01 GB, and host load later exceeded 30.
A separate [pressure sample](../../test-results/attendance-load/improved-full-2026-10-27T14-10-31-224Z-354255/host-pressure.txt)
recorded 66% disk I/O wait and 23 blocked processes. These host conditions must
be controlled before attributing timing differences to application changes.

The archived long runs used workload hash
`7644c8abfffd993793804a2633e396368454fef64c5349b78ac7a98dd6a27d56`.
Their `maxBacklog` field counted schedule-slot lateness and could overstate actual
queued arrivals after the arrival window closed. The delivered runner corrects
this reporting issue, with regression coverage; latency, missed slots, failures
and profile verdicts above are unaffected. Its workload hash consequently differs,
so the comparison command correctly requires fresh matching runs.

## Remaining performance opportunities

1. Use focused operator mode for the event rehearsal. In the completed baseline,
   check-in attendance-list responses totaled about **214 MB / 330 requests** in
   operator mode versus **4.13 GB / 5,995 requests** in regular mode. This is server
   response-body volume, not measured Wi-Fi traffic. Operator mode keeps growing
   lists inactive while manual entry is closed.
2. Paginate attendance lists on the server and fetch only the active view. Preserve
   current eligibility, review-only and timeout-only behavior. Regular departure
   transferred about 8.51 GB of list responses in this run. This requires a UI/API
   contract change and is not included in the small write-query patch.
3. Filter/paginate manual student search on the server. Its complete 3,000-student
   response measured about 2.47 MB. Returning only needed fields would also reduce
   database decoding, JSON work and phone parsing.
4. Finish imports and group-membership edits before opening check-in; their
   exclusive roster locks intentionally serialize against attendance. Keep the
   event laptop on power and avoid unrelated development/browser workloads during
   the representative rehearsal. Increasing the database pool is not a substitute
   for reducing full-list work and host contention.

## Validation

- 79 attendance database/domain regressions passed, including three query-count
  and audit-label tests.
- 24 rehearsal/helper tests passed, including bounded backlog, safe port refusal,
  verified HTTPS, no automatic write replay and cancellation cleanup.
- Optimized production build and all four short load phases passed.
- All 20 [desktop/mobile browser scenarios](../../test-results/attendance-e2e/2026-10-27T14-07-02-668Z-347556/report.json)
  passed, including five concurrent operators, identifiers, uncertain responses,
  stale modes, corrections, progress, export/print and camera-permission recovery.
- Phone-mode server smoke passed: near-full count/audit consistency, fresh scan,
  duplicate preservation, empty-event timeout-only recording, evidence capture
  and graceful cleanup. This was automation, **not physical-device testing**.
- Changed-file ESLint, Python compilation and whitespace checks passed. Full
  repository lint reports five pre-existing errors in `StepIndicator.tsx`,
  `getDynamicFilters.ts` and `DataTableStates.tsx`; those files were not changed.

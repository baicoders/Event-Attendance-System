# USWAG 2026 operating guide

## Implemented

Custom Groups is a separate sidebar page (mobile: account menu). Active users can view; administrators can create/rename groups, search existing students, add/remove membership, and edit optional positions. A database uniqueness constraint permits one custom membership per student independently of academic memberships. `Group.category = CUSTOM` explicitly distinguishes custom groups from existing system categories; no academic joins were rebuilt.

Calendar creation/editing offers **Custom Groups** and the existing Included Groups selector. Eligibility is the union of live memberships in those groups. Roster, QR lookup, manual check-in, progress, reports, and correction eligibility use the existing central predicate. Removing a member does not touch their attendance records or audit history. Current-roster reports omit former members; existing attendance review and student history retain recorded attendance outside the current scope.

Report → Export → Printable attendance sheet provides checkbox column selection, including USN/LRN, custom group, position, status and time-in. Position is shown on the report table too. Empty positions display an em dash. The grouping selector offers no grouping, academic section, or custom group, with group headings and subtotals. The Show Late counter toggle hides only that printed counter; attendance calculations and student statuses are unchanged. The footer credits Programmers Guild. The Noted by field can be edited in the print controls; click Apply before printing. Print options live in the URL; order is fixed and calculations/filtering remain unchanged.

## Local database and migrations

The existing `.env` points to a remote service. An ignored `.env.local` now overrides Next.js runtime connections to the existing local database. Prisma CLI reads `.env`, so always supply explicit local overrides:

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev' \
DIRECT_URL='postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev' \
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm dev
```

The additive custom migration is `20261023000300_custom_groups`. On this local database, two already-pending main migrations (student identifiers and import v2) were also deployed. Backup: `/tmp/event-attendance-pre-custom-groups.dump`. Verification after deployment confirmed all original 105 student fields, 361 academic memberships, 30 groups and 29 library visits unchanged. Never use reset, seed.ts, or db push to prepare this event.

## Participant preparation

The user will import `attendance_data_review_bundle/students_import_ready.csv` through the existing student import flow. That file and the workbook are supplied data and remain untracked. No participants were invented or automatically created.

Initial workbook dry-run: expected 95, matched 0, missing 95, ambiguous 0, membership conflicts 0, applied 0. The existing 105 local students are not the workbook participants. Private report: `/tmp/uswag-reconciliation-gpLs74/report.json`.

After the student import, follow [the seeding instructions](../scripts/uswag/README.md). Default dry-run:

```bash
node --import tsx scripts/uswag/seed.ts \
  --database-url 'postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev'
```

Review the generated private report, especially assignments, missing/ambiguous rows, conflicts and per-group counts. Approve actual assignments before running:

```bash
node --import tsx scripts/uswag/seed.ts \
  --database-url 'postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev' \
  --apply --approval-report /tmp/uswag-reconciliation-EXAMPLE/report.json
```

Expected group counts: SSC13, SSLG27, CS14, BA11, YHS13, CCJ12, House Lords/Ladies5 (95 total). Exact normalized matches only; omitted middle names/compatible initials still require uniqueness. Unmatched/ambiguous students need identity review; no fuzzy auto-selection. The script never changes Students, academic links or attendance. Fresh repeated dry-run/apply skips identical memberships. Changed workbook/database plan requires a new reviewed dry-run.

## Create and run USWAG 2026

1. Sign in as an active administrator. Import the real student CSV, then reconcile/apply approved workbook assignments as above.
2. Open Custom Groups and confirm all seven group counts and positions. Resolve every missing or ambiguous participant using verified identifiers; confirm the eligible total is 95.
3. Calendar → create event → title `USWAG 2026 — Lead, Serve and Inspire`. Select **Custom Groups**, select all seven groups, set the actual date/time and location. Check the audience preview and save.
4. Submit the draft for review, then approve it as administrator. Organizers can submit their own draft; an administrator approves it.
5. Attendance → select USWAG. Scan a real participant QR and confirm the returned name. Manual attendance uses the same eligibility check. Test one eligible and one ineligible student before opening registration.
6. If collecting time-outs, switch the event to time-out mode deliberately; operators should verify the current mode before scanning.
7. Reports → select USWAG → verify totals and positions. Export/print attendance sheet, select needed columns, choose absentees/grouping/signature as needed, and inspect browser print preview.
8. Use existing attendance corrections for mistakes. Membership changes take effect immediately; previously recorded attendance remains in the history even when a student leaves the audience.

## Limits and event-day prerequisites

The actual roster import, approved participant assignment, actual event schedule, and real camera/QR hardware check remain operator actions. No real USWAG check-ins were written during implementation. Positions and group labels reflect current memberships, not a historical snapshot. Multiple custom memberships, bulk membership upload UI, archival/deletion and print presets are outside this MVP. Keep the local database backup outside `/tmp` if it must survive a reboot/cleanup.

## Verification evidence

- Production build and TypeScript check passed after the changes. Focused lint passes.
- Membership tests exercise duplicate and concurrent assignment, organizer/stale-session rejection, position updates, academic link preservation, multiple-group roster union, QR/manual admission/rejection, live removal and attendance/audit preservation.
- Workbook/reconciliation tests cover the 95 source rows, normalization/initial handling, ambiguity, duplicates, conflicts, idempotency and local-only endpoint checks.
- Printing tests cover URL selections, fixed order, aligned headings/cells, missing-value placeholders, custom position projection and unchanged totals.
- Repository-wide lint currently reports six existing errors in `StepIndicator.tsx`, `getDynamicFilters.ts`, `DataTableStates.tsx`, and `queryBuilder.ts` (explicit any/unescaped apostrophes). Those unrelated files were not changed. There are also existing warnings.

Final regression run: 241 tests passed with explicit local database configuration, plus 3 server-rendered print table tests passed separately (244 total). The first broad run encountered a missing `DATABASE_URL` in the report test process; rerunning with the explicit local configuration resolved it. No test assertion remained failing.

The disposable API + headless Chrome smoke (`node scripts/test-custom-groups.mjs`) passed: browser create/rename/search/add/position/reload, admin authorization, membership conflict, event creation/edit category validation, multi-group union, SCANNED/MANUAL acceptance and rejection, live removal preserving attendance/audit/academic memberships, and print checkbox headings/cells plus PDF generation. Artifacts: `/tmp/uswag-print-smoke.pdf`, `/tmp/uswag-print-smoke.png`, `/tmp/custom-groups-smoke.png`. The fixture database, server and Chrome were cleaned afterward. This exercises the real browser and production server; a physical camera/QR hardware check remains an event-day prerequisite.

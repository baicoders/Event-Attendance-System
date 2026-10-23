# Custom Groups and USWAG implementation plan

User specification: attached implementation goal, 95 workbook participants, live membership eligibility, existing local database preserved. Work on feat/custom-groups-uswag in the existing checkout to retain local runtime context.

## Design decisions
Reuse Group and EventCategory: add CUSTOM category, which explicitly distinguishes custom groups from all existing academic/system categories. Preserve the implicit academic Student.groups relation. Add CustomGroupMembership with compound studentId/groupId identity, unique studentId (MVP one custom group), optional position, and foreign keys. Removing the unique constraint later permits multiple custom memberships. This avoids rebuilding academic joins or maintaining duplicate custom membership state.

All custom management writes are ADMIN-only like Settings group management, use the existing roster exclusive lock, and never mutate attendance. Both QR and manual recording use the central buildEventStudentFilter, updated for CUSTOM. Reports remain based on current eligible roster; historical records and correction/audit history remain accessible through existing review mechanisms.

## Tasks and verification
1. Add additive migration and membership service. Test unique/conflicting membership, authorization, position updates, removal, and unchanged academic groups in a disposable migrated PostgreSQL database.
2. Add custom group APIs and management page/sidebar/mobile menu. Reuse existing design tokens, authenticated requests, student search. Verify create, rename, search/add, position save, and removal in browser.
3. Extend event category and central eligibility predicate. Verify multiple selected groups yield unique eligible students; QR/manual accept members and reject nonmembers; live changes retain attendance and audit history. Verify existing system event behavior.
4. Add standard-library XLSX reader and local-only seeding CLI. Strict name normalization only, unique exact/explicit initials matching, no approximate auto-selection. Default dry run, explicit --apply, rerun safely, report missing/ambiguous/conflicts. Run workbook reconciliation; ask for approval of concrete assignments before applying.
5. Add selectable print columns separately, including identifiers, custom group, position, status, and times. Preserve existing options and report calculations. Verify rendered print HTML/browser output and placeholder positions.
6. Typecheck/lint/build, focused unit/integration regressions, and local browser smoke. Inspect diff and produce focused Conventional Commits. Document migration, exact USWAG operating steps, reconciliation and remaining actions.

## Review focus
Concurrent add to two groups must fail at DB level; custom memberships must survive academic student edits/imports; selected event group categories must be validated server-side; removal must preserve recorded attendance; missing/ambiguous spreadsheet identities must never be guessed; local-only scripts must reject remote endpoints; print column selection must affect both headings and cells without changing totals.

## Progress
- Inspected schema, centralized eligibility, guarded writes, Settings group management, report/print infrastructure.
- Workbook present, 95 participants; local DB baseline 105 students / 30 groups / 361 academic links / 0 records.
- Local DB backed up to /tmp/event-attendance-pre-custom-groups.dump. .env is remote: all local operations use explicit local URL.
- Completed core and reporting in separate commits. Local additive migrations applied; all existing student fields/academic links/library rows verified preserved.
- User will import the supplied ready CSV later; current dry-run0 matched/95 missing, no assignments applied.
-241 regression tests and3 SSR print tests passed; production build/typecheck and focused lint passed. Existing repository lint has6 unrelated errors.
- Disposable production API/Chrome smoke passed, including custom event POST/PATCH, scanned/manual eligibility, membership preservation, and real PDF. Operating guide and safe seeding instructions provided.

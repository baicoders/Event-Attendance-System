# USWAG setup verification — 2026-10-25

## Hosted target and environment selection follow-up

The approved setup now selects a shell-provided `DATABASE_URL` first, otherwise
`.env`. A stale `.env.local` no longer redirects setup to the development database.
An explicit `USWAG_SETUP_ENV_FILE` can select a different file. Hosted setup uses
the existing verified-TLS configuration; reset remains strictly local-only.
Console output identifies the selected host/database and source before connecting,
and completion JSON includes the actual target without credentials.

Five environment regressions passed, including stale-local override, inline shell
selection, explicit alternate file, insecure/redirected URL rejection and hosted
reset refusal. The original loader failed the three applicable precedence tests;
the corrected loader passed all five. The combined unit/database-configuration
suite passed 68 tests, with typecheck, changed-file lint and production build also
passing. Independent review passed 10 environment/reset checks with no findings.

Both bare and advanced CLI apply paths passed against disposable local databases.
An initial concurrent advanced-CLI run returned `APPLY_ROLLED_BACK`; its isolated
rerun passed with unchanged implementation. A hosted connection probe used a
read-only transaction and verified TLS, database identity and schema presence.
No hosted setup or data writes were executed during this follow-up.

## Complete baseline follow-up

The operator-approved local setup now also creates four active hashed-password
test accounts and the approved October 26, 2026 Asia/Manila all-day event. Its
`uswag:reset` wrapper resets the validated local target and rebuilds this baseline;
the earlier verification below documents the original roster-only implementation.

Final follow-up verification passed **49 unit tests, 10 disposable roster scenarios
and 2 complete-baseline scenarios (61 total)**. The representative complete fixture
was `test_uswag_baseline_mvnikvok_856b4240_azmv` on local PostgreSQL 17.11. Real HTTP
checks verified all four logins, attendance recording by three organizers, eight
successful logins across initial setup and reset, exact seven-group eligibility,
and the approved one-day event with correct creator/reviewer attribution.

The actual Prisma migration reset completed, followed by successful reseeding of
94 students, 74 groups, 94 memberships, four accounts and one approved event. It
cleared test attendance while retaining all printed USN QR identifiers. A separate
injected event-insert failure rolled back account, group and student creation.
Normal repeat setup preserved timestamps, existing passwords, capture mode and
attendance. Remote, maintenance and redirected reset targets were rejected in
guard tests; migration and runtime URLs were forced to the same validated target.

Typecheck, changed-file ESLint, isolated production build and independent review
passed. The existing unrelated unused `_req` build warning remains. Material review
findings about final-audience extras and noncanonical account emails were fixed
and regression-tested. Prisma's AI reset guard initially stopped the destructive
test; the operator explicitly authorized only disposable synthetic reset testing,
and the successful run passed that consent solely through the test environment.
The user's configured development database was neither reset nor seeded.

Scope: the dedicated `pnpm uswag:setup` CLI. All database execution used synthetic
identities in disposable migrated PostgreSQL databases. The populated application
database was not inspected or changed. No deployment, event approval or main merge
was performed.

## Environment and results

- Node 22.19.0, pnpm 11.4.0, PostgreSQL 17.11 on explicit local loopback port 5433.
- Maintenance template: explicit `TEST_DATABASE_URL` ending `/postgres`; the test
  wrapper rejects nonlocal endpoints before provisioning. Each database has a
  generated `test_uswag_*` name, receives the real migrations, and is dropped.
- Representative final database: `test_uswag_new_mvnf9fjb_3bae6b70_8zup`.
- `TEST_DATABASE_URL=<explicit-local-maintenance-url> pnpm test:uswag`: **37 unit /
  parser / CLI / report tests and 9 database scenarios passed (46 total)**.
- Existing student-import regression: **75 pure tests**, **10 server tests**, and
  **19 real HTTP fixture checks passed**, including atomic receipts, actor
  revocation, group/roster locking, and process-kill recovery.
- `pnpm exec tsc --noEmit`: passed.
- ESLint on all changed TypeScript/JavaScript tests and implementation: passed.
- `pnpm build`: passed. Its existing unused `_req` warning in
  `app/api/groups/route.ts` remains outside this change.
- `git diff --check`: passed. Private approved identifiers were scanned against
  changed/public files: zero matches. No CSV, workbook, handoff archive, private
  report or real student identity is committed.

The initial importer regression attempt passed all 75 pure tests, then could not
initialize two server test modules because this clean worktree had no
`DATABASE_URL`. The affected server checks were rerun successfully with an explicit
unused local runtime URL; their actual fixtures still used disposable databases.
The HTTP fixture then completed all 19 checks successfully.

## Verified synthetic plan and completion

The all-new scenario first obtained a read-only plan and verified zero database
changes, then ran reviewed apply in one transaction. Its private synthetic
completion report is `/tmp/uswag-integration-vJgXmU/report-2.json`.

| Result | Count |
| --- | ---: |
| Source workbook rows | 95 |
| Approved unique USNs | 94 |
| Held attendees without a Student | 1 |
| Academic / permanent house definitions | 67 |
| Custom officer groups | 7 |
| Groups created in an empty fixture | 74 |
| Students created | 94 |
| Officer memberships with workbook positions | 94 |
| Apply blockers in the explicitly approved synthetic fixture | 0 |

Approved officer membership totals were **13 / 26 / 14 / 11 / 13 / 12 / 5**. The
completion report's student/group/membership IDs were checked against actual
database rows. A subsequent fresh reviewed apply preserved all IDs, positions,
timestamps and row counts. The mixed fixture created 47 students while preserving
47 existing QR identities, existing attendance, omitted LRN/middle-name/house
values and unrelated YEAR/custom memberships. Other-organization conflicts remain
blockers under the existing one-custom-group constraint.

The nine database scenarios cover combined apply/idempotence/stale review, the
actual package CLI dry-run/apply, pending approvals causing zero writes, database
failure rollback, mixed identities, authorized draft creation and exact roster /
printed-position reads, terminated sessions, a proxy dropping a successful COMMIT
response, and lock waiting followed by stale-plan rejection. The lost-response
test verifies both `outcome: unknown-commit` and `COMMIT_OUTCOME_UNKNOWN`, then
confirms the database's actual committed state with a fresh read-only plan.

Without event details the completion correctly reports `missing-inputs`. The
explicit-event fixture created an owned DRAFT, reused it on a second run, and
verified 94 eligible students and exact positions. An APPROVED state was created
only as synthetic fixture data to check readiness; the CLI never approves events.

## Private handoff audit and outstanding operator inputs

File-only inspection confirmed all four supplied provenance checksums, 95 source
rows, 94 unique approved USNs, one held source row, both explicitly approved
display aliases, and exact source row/name/group/position bindings. These were
validation checks, not imports or populated-database queries.

Comparing required identifiers against the demo seed's actual source definitions
(without executing the destructive seed) reproduced **50 missing of 67**: 36
SECTION, 6 PROGRAM and 8 STRAND; zero DEPARTMENT/HOUSE gaps. All handoff demo flags
agreed. This is not a claim about the populated database's contents.

The real handoff's **62 non-house definitions remain pending**, including the
**15 explicit semantic-review items**. Only source-bound explicit approvals can
unblock writes. HT/HRT, WADT/WAD, OMT and Grade 11 pathway semantics are not guessed.
The one unresolved attendee remains held. Actual database contents, live remote
TLS, operator authorization, event schedule/owner and production readiness have
not been verified by these synthetic tests.

## Independent review

A fresh reviewer inspected the complete implementation and independently passed
26 selected non-database tests. Findings addressed with regressions: extra members
in projected draft audiences; creation idempotence; actual IDs in completion
reports; report path symlink exclusion; atomic recovery-report replacement; error
report discoverability; and consistent unknown-commit error codes. Final reviewer
verdict: approved subject to the database checks, which subsequently passed.
No outstanding Critical, Important or Minor findings were reported.

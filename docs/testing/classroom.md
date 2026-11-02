# Classroom verification

Implementation branch: `feat/classroom-teacher-module`, baseline `3135d3204c71c960fd6dfb2bef765a8a87a1f171`.

Use an explicit `TEST_DATABASE_URL` maintenance endpoint. All integration fixtures create uniquely named `test_*` databases, apply migrations, verify database identity and clean up. Never use a school database. The HTTP harness uses the current production build (`pnpm build` first); `CLASSROOM_TEST_DEV=true` opts into a separate build/config directory for development diagnostics.

## Access foundation (Task 1)

- `pnpm test:classroom:unit`: six access-policy cases.
- `node --import tsx --test globals/utils/credentials.test.ts`: eight credential cases including pending teacher password replacement.
- `pnpm test:classroom:db`: six PostgreSQL application/command cases, including concurrent reviews, independent Class suspension, audit immutability, rollback and a lock-observed suspension/write race.
- `node scripts/test-classroom-access-migration.mjs`: apply the old migrations, seed legacy Events/Student/Record data, apply M1, and compare data/permissions. No automatic teacher grants.
- `pnpm test:classroom:api`: real login, applicant status, approval, forged admin action, signup and global disable checks.
- Existing `pnpm test:operator`: 31 baseline cases passed.
- Existing account recovery unit and HTTP checks passed, including reset/replacement races, pending organizer denial, legacy passwords and invalid old cookies.
- `pnpm build`: passed with the existing unused `_req` warning in `app/api/groups/route.ts`; touched access code lint is clean.

Local verification used PostgreSQL 14.24. Host I/O load caused a transient recovery HTTP failure; rerun with captured server logs passed. The dedicated throwaway cluster was later configured with fsync/synchronous_commit/full_page_writes off to reduce test fixture checkpoint stalls. These tests establish SQL transaction, uniqueness and locking behavior, not crash durability or hosted performance. Production database version, durable backup/restore and real HTTPS phone-camera verification remain release gates.

No production migration, deployment, push or merge has occurred. At that milestone, Tasks2–11 remained required before a teacher release.

## Capability boundary and transaction safety (Task 2)

Final evidence:

- Access/origin/streamed-body units: 13/13.
- Classroom PostgreSQL tests: 11/11 (applications, command hashing/replay, scope, revocation, shared rate limits).
- Existing Events attendance/corrections/student workflow database checks: 32/32.
- Existing report/export projection tests: 7/7. Run with `node --import dotenv/config --conditions=react-server --import tsx --test globals/utils/eventReport.test.ts features/reports/utils/eventExport.test.ts` so the server-only loader has an explicit local test environment.
- HTTP sweep: 60 legacy endpoint methods deny teacher-only access and unauthenticated access; organizer bulk/delete denial, direct print and cross-origin checks pass.
- Existing operator, progress, bulk-student and account-recovery HTTP suites pass. Bulk operation fixtures now use administrators; unrelated administrators still cannot consume another administrator's preview token.
- Production build, `tsc --noEmit`, touched ESLint and whitespace checks pass (existing groups `_req` warning remains in the full build).

The Origin regression was reproduced with a real NextRequest: loopback URL normalization differs from the browser Host. Fallback validation uses the validated Host plus protocol; configured `APP_ORIGINS` always takes precedence. No forwarded host is trusted. Node API test clients explicitly supply normal browser Origin; clients that cannot do so obtain `/api/auth/csrf` and send the double-submit cookie/header token.

New `RequestRateLimit` rows are shared across app instances and keyed by SHA-256, not raw email/IP labels. Expired rows are pruned in bounded batches. The test artifact directories are excluded from TypeScript discovery and production output tracing.

## Dedicated workspace experience (Task 3)

- Workspace destination/preference and existing access units: 19/19.
- Existing-user Events application database checks: 2/2; a teacher requests Events via the existing organizer queue without changing Class access.
- Classroom access/boundary HTTP, existing account recovery HTTP and existing operator31/31 pass.
- `node --import tsx scripts/test-classroom-workspaces.mjs` verifies actual browser flows at375px: selector/network recovery, server Events-shell rejection, applicant isolation, saved application details, approval, explicit Class entry, dual workspace switching, independent suspension, and no horizontal overflow.
- Final full browser run used `CLASSROOM_TEST_DEV=true` after an accessibility-label-only correction; the production build before that correction passed. Development assertions allow30s for first-route compilation on the shared host. Production-build rerun remains in integration verification.
- The browser test caught missing explicit submit types (the shared Button defaults to button); both new application forms now submit. The administrator status filter has an explicit accessible name.
- Final touched ESLint and whitespace checks passed. No hosted deployment or real-phone camera claim is made by this desktop browser test.

## Shared student identity and teacher corrections (Task 4)

M2 and writer protocol: [shared student identity](../implementation/classroom-student-identity.md). Backend foundation commit:5122607.

Final evidence:

- PostgreSQL student/profile/QR/verification, Events edit, group-deletion and custom-membership tests:29/29. Covers concurrent teachers, no-op revisions, raw imports and group writes, immutable history, audit-failure rollback, safe aliases, retirement/tombstones, stable history cursors, explicit teacher repair of ambiguous academic assignments and invalid-profile verification rejection.
- `node scripts/test-classroom-identity-migration.mjs`: read-only pre-M2 audit, atomic upgrade, historical receipt quarantine, cross-namespace collisions, preserved Events/Record/Student IDs, no inferred verification, and refusal to turn a quarantined internal-only value into a new USN/LRN claim.
- `CLASSROOM_TEST_BROWSER=true node --import tsx scripts/test-classroom-students-api.mjs`: current production build at375px; shared-directory privacy, optimistic conflicts, preserved draft and concurrent surname, explicit QR aliases/retirement, versioned verification, server-acknowledged saves, lost-ack exact replay with one audit, restricted imports/bulk endpoints and fresh suspension checks.
- Existing identifier browser/API checks decode actual USN/LRN/printed/fallback QR images and verify canonical manual Events records. Existing student detail mobile/API, administrator bulk, custom groups/printing/PDF/live eligibility, operator31/31 and import suite pass. The import HTTP suite includes19 scenarios, durable replay, revocation barriers and an actual server-kill rollback/retry.
- Existing receipt migration and whole-database backup/restore checks pass with the local server and installed dump/restore tools; complete Classroom backup/restore evidence remains in the release milestone.
- Workspace/access/body/origin units19/19; final production build, TypeScript, Prisma schema validation, touched ESLint and whitespace checks pass.

Regression fixtures now preserve history-backed students and use separate identities instead of deleting audited records. Material-write counters exclude profileRevision-only bookkeeping while replay/no-op checks still demand zero additional writes. Manual Events actions use canonical Student.id; raw scanner actions continue accepting existing ID/USN/LRN codes. UI tests locate the displayed identifier and still assert canonical database FKs.

The375px check exposed a full-width field label plus4px outer margin; shared FormInput now preserves indentation with inner padding. A clean build recovered from an incremental Turbopack graph panic; generated artifacts were preserved under ignored test storage. Browser cleanup now waits for the owned Chrome process before removing its temporary profile. No production data, migration, deployment, push or merge occurred. Tasks5–11 and external release gates remain required before launch.

## Classes and persistent combined-section rosters (Task 5)

- `node --import tsx --test features/classroom/utils/composeRoster.test.ts`:3/3. Stable-ID union, exclusion precedence, independent classes, full fingerprint and academic eligibility.
- `node --conditions=react-server --import tsx --test features/classroom/server/classes.db.test.ts`:9/9 on disposable PostgreSQL. Combined sections/two irregulars/exclusion,40 repeated reads, separate config/roster revisions, concurrent edits, invalid section SQL guards, admin assistance/transfer, replay after transfer, later student archival, JSONB no-op settings, shared catalog corrections/archive.
- `CLASSROOM_TEST_BROWSER=true node --import tsx scripts/test-classroom-rosters-api.mjs`: production build API and375px browser pass. Inline subject creation, combined roster, persistent exceptions/reload, schedule/grace, exact same-key retry after losing a committed creation response, permission boundaries, protected section deletion, full fingerprints after central changes, ownership and archive.
- Production build, TypeScript, touched ESLint and whitespace checks pass. An earlier build received SIGTERM after compilation; the complete retry passed. Existing groups `_req` lint warning remains.

`pnpm test:classroom:rosters` runs the roster unit/database/API subsets; add `CLASSROOM_TEST_BROWSER=true` for mobile browser verification. No teacher-facing session/start claims are made at this intermediate milestone; lifecycle, onboarding and reports are still required before release.

## Resumable teacher onboarding (Task 6)

Implementation contract: [classes, rosters and setup](../implementation/classroom-classes.md).

- `pnpm test:classroom:unit`:26/26, including next-step recovery, completed-user behavior,16KiB UTF-8 draft bounds and unreadable-success acknowledgment handling.
- `node --conditions=react-server --import tsx --test --test-concurrency=1 features/classroom/server/onboarding.db.test.ts features/classroom/server/classes.db.test.ts`:15/15. Competing devices, revision conflicts, atomic class/progress association, duplicate creation replay, current roster/settings acknowledgments, empty roster, archived/transferred setup recovery and private receipt denial.
- `CLASSROOM_TEST_BROWSER=true node --import tsx scripts/test-classroom-onboarding-api.mjs`: final production build API and375px browser pass. Welcome malformed200 retry produces one audit; draft survives reload; a committed first-class POST with a lost response resumes to its existing roster after reload; roster/settings/tutorial/Ready resume; camera denial has manual practice; completion returns to My Classes and help is repeatable. Tutorial/setup makes zero real attendance API calls.
- Initial development browser run also passed. Final production build includes the later UTF-8 bound; API rejects oversized drafts without saving them. Build/types/lint/whitespace pass; existing groups `_req` warning remains.

`pnpm test:classroom:onboarding` runs the focused suite; add `CLASSROOM_TEST_BROWSER=true` for browser coverage. The Ready action currently completes setup and opens My Classes. Real Start/first-mark/finalize guidance is explicitly completed in Task9 with actual session APIs. This milestone does not satisfy the real-teacher/HTTPS-phone launch gates by itself.

## Session snapshots and lifecycle (Task 7)

Contract: [sessions](../implementation/classroom-sessions.md). Timestamp prerequisite: [UTC wire sessions and historical release gate](../implementation/classroom-time.md), commit82f7886. No historical Events values were rewritten.

- `pnpm test:classroom:unit`:29/29, including exact grace boundary, zero grace, offset/term/future validation and Manila schedule suggestions.
- Session database suites:18/18 (`sessionConstraints.db.test.ts`4, `sessions.db.test.ts`9, `sessionConcurrency.db.test.ts`5). Original immutability/materialization, no absence on preview, Unmarked start, atomic finalize/cancel, multiple same-day meetings, policy amendment, current-directory fingerprint mismatch,40 persistent meetings, halfway enrollment, audit-failure rollback, exact concurrent receipts and genuine PostgreSQL lock barriers.
- Capacity:1,001-member start fails before session/receipt writes; the full1,000-member boundary starts/materializes/finalizes without truncation. Local start plus page100 read≈1,624ms; finalize≈1,838ms. This disposable cluster has durability settings disabled; these are local observations, not hosted/p95/durability claims.
- `node --import tsx scripts/test-classroom-sessions-api.mjs`: current production build passes private preview/start/session/roster/lifecycle, ownership denials, replay after finalization, historic roster preservation, policy amendment, archive and fresh suspension checks.
- Existing Class applications/commands/rate-limit/classes/onboarding DB regression25/25; existing Events attendance/corrections/student workflow29/29; DB configuration15/15; physical instant round-trip1/1 with a deliberately non-UTC disposable database default.
- Final production build, TypeScript, scoped lint and whitespace checks pass. pg8.23 emits a queued-query deprecation during Prisma relation/transaction work; the locked supported driver passes. No adapter internals were changed.

`pnpm test:classroom:sessions` runs the focused policy/database/API suite. Real QR/manual marking, phone session UI, reports, administrative monitoring and external release gates remain later milestones.

## Reliable attendance commands (Task 8)

Contract: [Classroom attendance](../implementation/classroom-attendance.md).

- `pnpm test:classroom:unit`:32/32, including route/body identity mismatch and invalid-QR byte validation.
- `node --conditions=react-server --import tsx --test --test-concurrency=1 features/classroom/server/attendance.db.test.ts features/classroom/server/scanConcurrency.db.test.ts`:22/22. Existing ID/USN/LRN/alias cards, immutable duplicates/replays, manual correction/version/notes, explicit enrollment scopes, exclusion confirmation, finalized admission/re-inclusion, original snapshot retention, numeric retired-ID manual fallback and audit-failure rollback.
- Real separate-client PostgreSQL barriers prove independent-student overlap, same-pair uniqueness, manual conflicts, both finalize orderings, cancel, admission/finalize, policy amendment and restrictive suspension/ownership/password-reset commits. No common session counter is updated by ordinary marks.
- `node --import tsx scripts/test-classroom-attendance-api.mjs`: current production build passes QR/manual/enrollment/receipt behavior, role/ownership/bulk denials, real administrator attribution, independent Events access after dual-user Class suspension, shared scan limits and receipt recovery while limited.
- Final build, TypeScript, scoped ESLint and whitespace checks pass. Existing pg queued-query deprecation remains captured; no adapter internals changed.

`pnpm test:classroom:attendance` runs the focused database/API suite. Phone capture/manual interaction, reload recovery descriptors, reports and administrative monitoring remain required before release. No production data, migration or deployment occurred.

## Phone attendance and first real meeting (Task9)

Contract: [Mobile attendance](../implementation/classroom-mobile-attendance.md).

- `pnpm test:classroom:unit`:50/50, including valid/invalid wire envelopes, same-key uncertain save recovery, actor/session disposal, decoder duplicate gating, receipt lookup without resubmission, malformed/retry429 behavior, monotonic row revisions and truthful older-save feedback,100-row pagination, explicit Manila inputs and track cleanup after late permissions/play failure.
- Command settlement database4/4; classes9/9 and sessions10/10, including bounded class list summaries, derived first-attendance guidance and current-owner metadata independent of frozen original-teacher snapshots.
- `pnpm test:classroom:attendance`:22 database tests plus production API pass after mobile integration. This rechecks locking races, QR/manual/enrollment/receipt contracts, rate limits and authorization boundaries.
- `pnpm test:classroom:mobile`: disposable production PostgreSQL/app and375px browser;35/100/101/220 rosters, preserved search/filter/scroll, all outcomes, optional excuse notes, reasoned overrides, Start/mark lost-response reload recovery, actual USN/LRN/internal-ID QR frames/local WASM, duplicate/unknown/outside-roster choices, camera-denied manual fallback, finalization/cancellation/finalized corrections, keyboard names and200% zoom. Database assertions prove one meeting per Start, one first-mark audit despite lost acknowledgment, and session-only visitor enrollment.
- `CLASSROOM_TEST_BROWSER=true node --import tsx scripts/test-classroom-onboarding-api.mjs`: newly approved teacher completes/resumes first-class setup, follows Ready to Start preview, generates no attendance before explicitly starting, saves first real manual attendance and finalizes. Repeated setup/help does not restart onboarding.
- Existing Events `pnpm test:operator`:31/31; `MANUAL_BROWSER_TEST=1 pnpm test:operator-api` production HTTP/manual/operator browser passes. Updated fixture gives students explicit USNs and tests stale COLLEGE eligibility through a versioned individual correction, respecting the new administrator-only deletion policy.
- Existing Events HTTPS/local-decoder full E2E20/20 plus harness6/6 passes. Report: `test-results/attendance-e2e/2026-11-02T11-20-31-422Z-626781/report.json`. Five operators,2,000 synthetic students, QR identities, rejected scans, network loss/replay, stale mode, reports, permissions and camera-denied recovery are included; physicalDevicesTested=false.

The initial375px/200% no-overflow check was insufficient: visual inspection found overlapping bottom-tab labels. A separate bounds assertion now checks adjacent links and their label/indicator bounds; opt-in Class compact navigation passes it in the final production browser run. The default Events navigation stays unchanged.

Physical deployed-HTTPS iOS/Android camera/background/rotation and actual teacher/screen-reader trials remain release gates. Local fsync-off timings are functional evidence, not hosted capacity or durability certification. No production database or deployment is involved.

## Canonical reports and monitoring (Task10)

Contract: [Historical reports and monitoring](../implementation/classroom-reporting.md).

- Pure projection6/6 and CSV2/2; full Class unit suite58/58.75.0%, N/A, sum-before-rounding, multiple same-day meetings, exclusions/not-enrolled, immutable per-meeting labels, leading-zero/formula/UTF8 handling and incomplete finalized data errors.
- Report database8/8: current profile/section edits preserve snapshots/version; student-term privacy; paginated rows keep whole-selection totals; version mismatch after correction; audited matching print; midway eligibility; active/canceled exclusion; fresh credentials; real PostgreSQL ownership-transfer and membership-revocation barriers.
- Monitoring database6/6: administrator-only/fresh credentials, mixed-source/timestamp cursor ties, real before/after actor/QR disposition, version-bound verification, nested excuse redaction, repeat-correction prompts without automatic access changes, and actual UTF8 response limits. The old code-unit guard was observed RED before byte-limit GREEN.
- Concurrent monitoring index migrations M5a–f apply on fresh disposable databases using real Prisma deploy. They contain one concurrent-index statement per migration, not a transaction-wrapped batch.
- `CLASSROOM_TEST_BROWSER=true node --import tsx scripts/test-classroom-reports-api.mjs`: production JSON/page/CSV/print/PDF and375px report/session/student/day/admin flows; exact versions,75% arithmetic, ownership and suspension/organizer/pending denials, default note omission and private student-term intersections. Separately authorized corrections reject stale downloads with REPORT_CHANGED. A separately authorized correction rejects the old CSV without downloading; explicit refresh clears the error and prepares the new version/rate.
- Existing Events report/CSV/print unit suite15/15; `node --import tsx scripts/test-event-export-regression.mjs` owns a unique disposable database, app and Chrome CDP instance to run the original export HTTP/browser fixtures and80-group print stress. Existing presets/cohorts/groups/permissions/summary/sheet/CSV/picker checks pass. Legacy synthetic students now carry explicit USNs instead of relying on an internal ID as a display number.

`pnpm test:classroom:reports` runs the focused unit/DB/API suite; add CLASSROOM_TEST_BROWSER=true for its phone/PDF checks. `pnpm test:events:reports` runs the safe Events regression wrapper and unit suite. No production migration, deployment or real-device assertion is made.

## Final integration and release rehearsal (Task11)

Run a production build first, then `pnpm test:classroom:regression`. The serial runner records each command, exit status, duration and full log under an ignored unique `.superpowers/classroom-regression/` directory. Every HTTP fixture owns a migrated disposable database; none may fall back to the configured application database. `CLASSROOM_REGRESSION_ONLY` selects named suites for explicit reruns; retained failed results remain evidence rather than being silently rewritten. Do not rebuild shared `.next` during HTTP/browser tests.

Run `pnpm test:classroom:unit` and `pnpm test:classroom:db` separately. Final integration expanded units to64 and Class/auth database cases to84. The DB set includes40 actual meetings with persistent exceptions/midterm enrollment,1000-member snapshot/finalization, independent-client race barriers, revision conflicts, ownership/revocation, reports and monitoring. Student identity DB/migration tests are included in the aggregate student suite. Mobile checks now include URL preference reload, page3/220 students and lower-row failed-save same-UUID recovery.

`pnpm test:classroom:release` requires loopback TEST_DATABASE_URL ending `/postgres`, version-matched PostgreSQL tools and test provisioning privileges. It materializes the baseline from git3135, injects failures only into copied migrations and owns every database/role it removes. Evidence includes all public-table hashes after backup restore, Events invariants, failed M2 rollback/resume, invalid concurrent-index recovery, historical QR quarantine and interrupted/idempotent backfill. A real nonowner, non-superuser runtime role executes core attendance and is denied audit mutation/TRUNCATE/DDL/registry retarget. Private archive/log paths must remain unshared. This is functional recovery evidence on local PostgreSQL14.24/Node22.23.4, not hosted17 certification or crash durability: the local cluster has fsync disabled.

`pnpm test:classroom:flagoff` verifies Class business denial with Events access preserved and admin teacher queue available. Set CLASSROOM_ROLLBACK_SOURCE to a separately built, inspected compatible source/artifact directory to run the same smoke with a rollback candidate against latest migrations. Never use originalmain3135 as that candidate; it lacks foundational authorization/registry/UTC changes. Keep schema/history when rolling back the application.

A full repository lint run still reports five errors in unchanged legacy files: StudentFormDrawer/StepIndicator (any), getDynamicFilters (two any), and DataTableStates (two unescaped apostrophes). They are baseline debt, not a green full-lint claim. Production build and changed-file lint are tracked separately. pg8.23's queued-query deprecation remains; no driver internals were patched.

The [external acceptance record](classroom-release-acceptance.md) explicitly records physical devices, school HTTPS/mobile networks, unfamiliar-teacher trials, hosted performance/timezone/backup and release authorization as outstanding until real evidence exists. Do not promote local fake-camera, PDF, bounds or synthetic throughput results into physical-device/usability claims.

The sanitized, committed [migration rehearsal record](classroom-migration-rehearsal.json) preserves checks/results without private dumps, identifiers or connection strings. Original per-command logs and synthetic archives remain ignored local evidence.

Final Task11 evidence is committed in [the regression record](classroom-regression-evidence.json): all29 named regression groups have passing runs, including explicit reruns with original failures retained. Class units64/64, refreshed Class/auth DB84/84, Events operator32/32, explicit legacy utilities69/69 plus React rendering13/13, setup54+10+2, verified backup, real TLS11/11 and production HTTP/mobile/report/print/export fixtures pass. The final Caddy HTTPS browser suite passes20/20 (plus6 harness tests), including unchanged permission-denial recovery after the shared camera error adapter fix. Local fake-camera HTTPS is still not an actual-device certification.

Optional legacy student detail and bulk browser flows also pass with their `--browser` switches. Bulk fixtures explicitly supply USNs rather than assuming internal IDs are display numbers. The historical identifier migration test now applies the real pre-migration prefix to an empty owned database; it does not dismantle the latest registry's protective dependencies. Prisma's guarded test reset ran only after the user's specific consent for the disposable synthetic test target; no reusable consent is stored in scripts or configuration.

Final [whole-branch review and verified fixes](classroom-review.md): two Important mobile findings reproduced and fixed in one TDD pass; no Critical/Minor findings or re-review. Full post-fix mobile/onboarding/report suites and64 units pass. Physical release gates remain outstanding.

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

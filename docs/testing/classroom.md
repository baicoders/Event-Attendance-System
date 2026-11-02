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

No production migration, deployment, push or merge has occurred. Tasks 2–11 remain required before a teacher release.

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

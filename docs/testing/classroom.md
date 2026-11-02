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

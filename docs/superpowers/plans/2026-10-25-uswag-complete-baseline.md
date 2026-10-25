# Complete USWAG local baseline

User-approved extension of the existing single-command setup: one active admin,
three active organizers using the selected USWAG test logins, the approved all-day
October 26, 2026 Asia/Manila event, and all existing approved roster prerequisites.

- [x] Pure account/event planning with conflict blockers and final audience checks.
- [x] Atomic user creation, roster application and DRAFT/PENDING/APPROVED lifecycle.
- [x] Idempotent reuse preserving existing passwords, attendance and capture mode.
- [x] Local reset target validation, matching runtime/migration URLs and reseeding.
- [x] Synthetic four-account HTTP login and three-organizer recording checks.
- [x] Complete disposable Prisma reset and verify restored logins/USN QR continuity.
- [x] Final tests, typecheck, build and independent review.

The reset tests target generated `test_uswag_*` databases only. The user's configured
development database is not reset or seeded during implementation. Prisma's AI
guard required a fresh explicit confirmation for its destructive CLI reset test;
the user explicitly confirmed "Yes, test disposable reset only". The final test
used that exact consent only in the disposable test process environment.

Results: 49 unit tests, 10 existing disposable roster scenarios, and 2 complete
baseline scenarios passed (61 total). The complete scenario verified eight HTTP
logins across setup/reset, recording by all three organizers, preservation on
ordinary setup, cleared attendance after reset and unchanged printed USNs. An
injected event failure verified rollback of accounts, groups and students together.
Typecheck, changed-file ESLint, isolated production build and independent review
passed. Review findings about final audience scope and email casing were fixed
with regressions. No real development database was reset or seeded.

# Issue 48 PostgreSQL attendance ledger plan

**Goal:** Preserve material attendance changes and let authorized event managers correct, void, restore, and review evidence without overwriting concurrent work.

**Baseline:** Issue #51's merged PostgreSQL migration and guarded-write protocol. Keep `Record` as the current projection. Preserve timeout-only evidence and all current recording contracts.

1. Add an additive PostgreSQL migration: `Record.revision` defaults to zero; `AttendanceChange` has a BigInt key, JSONB versioned snapshots, restrictive event/student links, and actor-scoped command receipts. Verify fresh deployment and a populated baseline upgrade.
2. Extend normal POST and legacy PATCH under the shared roster/event/pair lock protocol. Each material write updates the projection and appends one change in its transaction. No-op scans add none.
3. Add CORRECT, VOID, and RESTORE commands with reason, exact incarnation/revision targets, pair-owned latest-VOID restoration, current authorization/eligibility, and replay. Use the command lock before pair work. Retry only a classified transaction rollback.
4. Add coherent RepeatableRead review/history APIs with bounded pages and decimal-string IDs. Retain event/student parents while history exists, including after a void.
5. Add the manager review directory and Sheet; replace both destructive controls, confirm official changes, preserve drafts after conflict/unknown result, and invalidate affected query keys.
6. Run independent-connection PostgreSQL race/rollback tests, migration SQL fixtures, authenticated API and browser checks, typecheck, lint, build, and a bounded contention probe. Record release and rollback constraints in the deployment notes.

**Decision:** A committed database transaction is the only source of a success receipt. History snapshots are server-generated and never used as the current attendance projection.

# USWAG Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One reviewed, additive, transactional command for all approved USWAG prerequisites.

**Architecture:** Validate source-bound private inputs, derive a deterministic plan
using shared student-import rules, then rebuild and apply under the existing roster
lock in one PostgreSQL transaction. Reports stay private; stdout contains counts.

**Tech Stack:** TypeScript, node-postgres, existing Python workbook parser, Node tests.

**Spec:** `docs/superpowers/specs/2026-10-25-uswag-setup-design.md` (approved).

## Global Constraints

- One `pnpm uswag:setup` command; dry-run default, reviewed explicit apply.
- Exactly 94 approved USNs, 95 workbook rows, one held attendee; no name resolution.
- Academic decisions remain strict apply blockers until explicitly approved.
- Preserve unrelated data; no populated database access, deployment, main merge.
- Private files/reports never committed; synthetic tests only.

## Review Focus

- Swapped source identifiers must fail provenance verification before any DB access.
- Existing custom memberships and permanent houses must never be replaced.
- Approval fingerprints must detect source and database changes, including groups.
- Interrupted or uncertain commits must never be reported as successful rollbacks.
- Reused officer groups may have extra members; report event readiness honestly.

### Task 1: Private input validation

**Files:** `scripts/uswag/setup-input.ts`, `setup-input.test.ts`, `setup-fixture.test-support.ts`.
**Interfaces:** `loadSetupInput(directory, approvalsPath?) => SetupInput`; exports
`SetupInput`, `GroupDefinition`, approved rows with `sourceRow`, `group`, `position`,
`student: CanonicalRow`, `hashes`, `blockers`, `held`. Group definitions retain
explicit reviewed approval, no inferred label aliases.

- [ ] Write synthetic workbook/bundle fixture and failing tests: 95/94/1, seven
  counts, provenance, two aliases, exact row bindings, malformed/duplicate/swapped
  USNs, 67 references, pending decisions and source-bound approval file.
- [ ] Run tests to establish missing functionality, implement validator using
  original bundle formats and existing workbook parser, rerun until green.
- [ ] Commit input validator and its synthetic tests.

### Task 2: Deterministic combined planning

**Files:** `scripts/uswag/setup-plan.ts`, `setup-plan.test.ts`.
**Interfaces:** `buildSetupPlan(input: SetupInput, state: SetupState, eventOptions?)`.
State includes groups, students with academic joins, custom memberships, events,
and owner records. Plan includes group/student/membership operations, blockers,
held rows, counts and event readiness. Reuse `classifyStudentImport` while requiring
exact USN selection and preserving additive academic joins.

- [ ] Write failing tests for all-new/existing/mixed, blank fields, identifiers,
  conflicting academic/custom values, seven counts, unchanged timestamps and extras.
- [ ] Implement pure planner, event candidate discovery/readiness and optional
  authorized owned DRAFT plan. No implicit event lifecycle changes.
- [ ] Run pure suite and commit planner.

### Task 3: Reviewed transactional CLI

**Files:** `scripts/uswag/setup.ts`, `setup-db.ts`, `test-uswag-setup.mjs`, `package.json`.
**Interfaces:** explicit target env-name option, source directory, optional approval
file and event JSON; read-only default, `--apply --approval-report --backup-confirmed`.

- [ ] Write failing disposable PostgreSQL tests for complete combined writes,
  replay no-ops, stale approvals, conflicts, locks, interruption and rollback.
- [ ] Implement validated target/peer verification, private reports, full-state
  fingerprint, roster and table locks, additive writes and honest commit outcomes.
- [ ] Test all-new/existing/mixed, production constraints, event eligibility and
  printed membership positions. Reproduce 67/50 demo vocabulary counts safely.
- [ ] Add command, run tests and commit.

### Task 4: Operator runbook and review

**Files:** `docs/uswag-setup.md`, `scripts/uswag/README.md`, verification evidence doc.

- [ ] Document one dry-run and matching apply command, private inputs, backup,
  approval file format, event inputs, blockers and recovery from unknown outcomes.
- [ ] Run focused tests, existing import tests, typecheck, changed-file lint, build.
- [ ] Independent whole-branch review; address material findings with regression tests.
- [ ] Commit docs/evidence and open one reviewable PR; never merge/deploy/apply real DB.

## Ledger

- User explicitly approved the design and requested implementation without further
  design approval. Minor implementation choices are delegated to the implementer.
- Live branches inspected; GitHub reported no open PRs. Base includes locally
  merged attendance fixes; PR scope must exclude unrelated ahead-of-origin commits.
- Complete handoff provenance hashes verified; 15 academic semantic blockers remain.
- Initial worktree tests could not start before dependency installation (missing tsx).

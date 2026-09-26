---
name: release-verification
description: How to verify a change is actually done in the Event Attendance System — there is no automated test suite, the beta deployment is one-week/single-laptop, and known P0/P1 issues must not be assumed fixed without checking. Use before claiming a fix/feature is complete, when asked if the app is "ready," or when touching anything on the release-blocker list.
---

# Release Verification

## There is no automated test suite

`package.json` has no `test` script and no test runner is installed — only
`dev`/`build`/`start`/`lint`/`db:*`. **"Type checking and lint pass" is not evidence a
feature works.** For anything touching the attendance-recording path (scan, timeout
mode, manual entry), the auth flow, or bulk import, you must actually run the app and
exercise the flow — see the Skill instructions in your system prompt on testing UI
changes in a browser before reporting a task complete. If you cannot run/exercise a
change, say so explicitly rather than claiming it works.

## Known, tracked issues — check before you "discover" or "fix" one

`docs/audit/findings.md` is the indexed list (P0–P4, with confidence levels) of every
issue found in the most recent full audit, cross-referenced into
`security.md`/`data-integrity.md`/`operability.md`. Before reporting a bug as newly
found, or before "fixing" something proactively, check whether it's already there —
it may have a documented, deliberate rationale (e.g. `DATA-06`'s live eligibility
computation is by design, not a bug) or an already-scoped fix direction you'd otherwise
duplicate or contradict.

**The actionable work queue lives in GitHub Issues (#37–#52), not in the docs.**
`docs/audit/` is the detailed technical record; each finding there links to its issue.
Umbrella tracking issue for the beta: **#52**. Before starting work, check the issue
(`gh issue view <n>`) for current status and any discussion that postdates the docs —
and check open PRs too, since in-flight work may already cover it (OPS-09, for example,
is fixed by PR #36 and was deliberately never filed as an issue).

**Do not mark a P0/P1 finding as resolved without verifying the underlying condition
changed.** These are the current P0 release blockers as of the last audit pass — treat
them as still open until you've confirmed otherwise by reading the current code AND, for
the ones marked LIKELY (runtime-dependent), actually reproducing the fix:

| ID | Issue | Where |
|---|---|---|
| SEC-01 | `Secure` cookie flag drops sessions on LAN HTTP in production builds | `globals/utils/auth.ts` |
| SEC-02 | QR camera requires a secure context, unavailable on LAN HTTP | `features/attendance/components/ScannerCamera.tsx` |
| DATA-01 | ~~Bulk import transaction has no timeout override, likely fails at 2,000+ rows~~ **RESOLVED** — interactive form with explicit `timeout: 120s`/`maxWait: 30s` + exclusive roster lock | `app/api/bulk-import/students/route.ts` |
| DATA-02 | No way to add a missing `Group` without a destructive reseed | `prisma/seed.ts`, `app/api/groups/` |

Full context, fix directions, and the four P1 "should-fix" items are in
`docs/audit/release-readiness.md` and `docs/audit/remediation-plan.md` (Phase 0). If
your task is to address one of these, read the specific finding doc first — each has a
scoped, considered fix direction; don't invent an alternative without a reason.

## What "done" means for a change in this repo

1. The change matches the conventions in `docs/conventions.md` for its layer (API
   route shape, Zod placement, TanStack Query hook pattern, etc.) — or, if it
   deliberately deviates, that's called out, not silent.
2. For anything UI-reachable: actually run it (`pnpm dev`, or the project's configured
   dev-server preview) and exercise the golden path *and* at least one edge case (e.g.
   for attendance: a duplicate scan; for a form: the validation-failure path).
3. For anything server-side touching authorization, Prisma, or the bulk-import path:
   re-check against the `auth-and-authorization` / `prisma-and-database` skills for
   invariants that must hold (guarded-write protocol with advisory + row locks,
   the four auth primitives, `@@unique([eventId, studentId])`).
4. If the change is meant to resolve a tracked finding, the finding's ID should be
   referenced in your summary to the user so it's traceable back to
   `docs/audit/findings.md`.

## The deployment context that should shape every "is this good enough" judgment

Single laptop, single PostgreSQL 17 database, LAN-only, 2–5 concurrent users, 2,000+ students,
one-week beta window, operators who did not build this system and may not have the
developer available during the event. A fix that's "good enough for this beta" and a
fix that's "architecturally correct long-term" are sometimes different scopes — when
they diverge, `docs/audit/remediation-plan.md`'s phase structure (Phase 0 = this week,
Phase 1–3 = backlog) tells you which one is being asked for. Don't silently expand a
requested Phase-0-sized fix into a Phase-2/3-sized refactor, and don't apply a
Phase-0-sized patch where the finding doc explicitly says the real fix is a schema
change (e.g. `DATA-06`'s eligibility snapshotting).

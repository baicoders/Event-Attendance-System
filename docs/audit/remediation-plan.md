# Remediation Plan

Organized into four phases. **Phase 0 is the only phase relevant to this week.**
Phases 1–3 are backlog by definition — per the audit brief, every recommended change
that is not a release blocker is explicitly called out below as a backlog task, not
something to implement during this audit pass (no code was changed to produce this
document).

> **Work queue:** every actionable item below is tracked as a GitHub Issue
> (#37–#52), linked inline. This document explains *why* and *in what order*; the
> issues are where the work is claimed and closed. Umbrella:
> [#52](https://github.com/mjfelecio/Event-Attendance-System/issues/52).

---

## Phase 0 — Must fix before beta (this week)

Ordered by dependency, not just severity — HTTPS unblocks the manual verification for
everything else, so it should happen first.

1. **Resolve the production-build/LAN deployment problem** — [SEC-01](./security.md#sec-01),
   [SEC-02](./security.md#sec-02), SEC-11 → **[#37](https://github.com/mjfelecio/Event-Attendance-System/issues/37)**.
   Decide on and stand up an HTTPS path for the LAN deployment (local CA via `mkcert`
   trusted on each staff device, or a reverse proxy that terminates TLS), or explicitly
   decide to run in a mode that doesn't set the `Secure` cookie flag and accept QR
   scanning is host-laptop-only. Set `AUTH_SECRET` (≥16 chars) for any production build.
   Either deployment decision is viable; *not deciding* is the actual risk. Rehearse the
   chosen path on a real second device before the event.
2. **Fix the bulk-import transaction** — [DATA-01](./data-integrity.md#data-01) →
   **[#38](https://github.com/mjfelecio/Event-Attendance-System/issues/38)**.
   **DONE 2026-08-20:** benchmarking showed the 5s timeout never fires for the
   synchronous better-sqlite3 adapter (a 2,000-row import commits in ~10s through
   the API), but the 2s `maxWait` can fail a second concurrent import with P2028.
   `globals/libs/prisma.ts` now sets
   `transactionOptions: { timeout: 120_000, maxWait: 30_000 }`, P2028 maps to a
   clear retry-safe message, and the fix plus a reusable 2,000-row fixture/harness
   (`scripts/benchmark/`) were verified against the production build.
3. **Resolve the group-vocabulary gap** — [DATA-02](./data-integrity.md#data-02) →
   **[#39](https://github.com/mjfelecio/Event-Attendance-System/issues/39)**.
   **DONE 2026-08-17, in code after all:** groups are now created, renamed, and deleted
   from **Settings → Groups**, so no reseed is involved. Two operational steps remain:
   reconcile the real school's sections/departments/programs/strands/houses against
   Settings → Groups *before* any real data entry begins (the seed ships only 4 sections
   and 4 of 13 programs), and make sure someone on-site has read
   [`../deployment/operator-runbook.md`](../deployment/operator-runbook.md) §2 for the
   Prisma Studio fallback.
4. **Prepare the four should-fix mitigations as runbook items**, even if no code
   changes: back up the SQLite file periodically during the event
   ([DATA-04](./data-integrity.md#data-04) →
   [#41](https://github.com/mjfelecio/Event-Attendance-System/issues/41)), disable
   laptop sleep and keep the server process supervised or at least watched
   ([OPS-08](./operability.md#ops-08) →
   [#42](https://github.com/mjfelecio/Event-Attendance-System/issues/42)), raise or
   plan around the signup rate limit ([SEC-05](./security.md#sec-05) →
   [#43](https://github.com/mjfelecio/Event-Attendance-System/issues/43)), and brief
   admins not to change category/groups on approved events that already have attendance
   ([SEC-03](./security.md#sec-03) →
   [#40](https://github.com/mjfelecio/Event-Attendance-System/issues/40)).
5. **Run the manual verification list and smoke tests** in
   [`release-readiness.md`](./release-readiness.md) end-to-end on real hardware, on the
   real event Wi-Fi, before the event. Checklist mirrored in
   [#52](https://github.com/mjfelecio/Event-Attendance-System/issues/52).

Nothing else in this document should be attempted this week — nothing else materially
threatens the beta, and every hour spent on Phase 1+ items is an hour not spent
verifying Phase 0.

---

## Phase 1 — Important post-beta fixes

Backlog. Implement after the beta, informed by whatever actually happened during the
week.

- Guard against editing `category`/`includedGroups` on an approved event that already
  has attendance records ([SEC-03](./security.md#sec-03) /
  [DATA-05](./data-integrity.md#data-05) →
  [#40](https://github.com/mjfelecio/Event-Attendance-System/issues/40)) — either block
  the specific fields or require an explicit confirmation naming the consequence.
  **DONE 2026-09-20** — shared `getEventAudienceChangeError` guard on both edit routes:
  an audience change on an approved event with `attendanceCount > 0` returns
  `409 AUDIENCE_CHANGE_HAS_RECORDS` unless the caller acknowledges; the `EventDrawer`
  confirms with the record count before re-sending with the flag. Benign edits and
  calendar drag/resize pass through unchanged.
- Add a pre-delete attendance-record check (and correct error message) to
  `DELETE /api/students/[id]`, mirroring the existing event-delete guard
  ([DATA-03](./data-integrity.md#data-03) / [OPS-07](./operability.md#ops-07) →
  [#44](https://github.com/mjfelecio/Event-Attendance-System/issues/44)).
- ~~Build a minimal self-service password reset flow, a group-management screen, and
  basic user management — the durable replacement for Phase 0's Prisma Studio runbook~~
  ([OPS-05](./operability.md#ops-05) / [OPS-06](./operability.md#ops-06) /
  [DATA-02](./data-integrity.md#data-02) →
  [#46](https://github.com/mjfelecio/Event-Attendance-System/issues/46)).
  **DONE 2026-08-17** — shipped as the `/settings` operator console (Account, Groups,
  Users, System). Password recovery is admin-issued temporary passwords rather than a
  self-service token flow: there is no mail path on a LAN laptop. **Deactivating or
  re-activating an already-`ACTIVE` user, and changing a user's role, were left out**
  and remain runbook-only
  ([`../deployment/operator-runbook.md`](../deployment/operator-runbook.md) §4).
- Add real process supervision for the server (`pm2` or an OS service) instead of the
  Phase 0 manual mitigation ([OPS-08](./operability.md#ops-08) →
  [#42](https://github.com/mjfelecio/Event-Attendance-System/issues/42)).
- Add a real backup mechanism (scheduled file copy, or an in-app export-everything
  endpoint) instead of the Phase 0 manual copy ([DATA-04](./data-integrity.md#data-04) →
  [#41](https://github.com/mjfelecio/Event-Attendance-System/issues/41)).
- Widen or remove the signup rate-limit's dependency on `X-Forwarded-For`
  ([SEC-05](./security.md#sec-05) →
  [#43](https://github.com/mjfelecio/Event-Attendance-System/issues/43)) — e.g., raise
  the limit permanently, or accept a session-based signal instead.

**Explicitly flagged for backlog, not this-week implementation**, per the audit
instructions: every item above.

---

## Phase 2 — Technical debt

Backlog. Lower urgency than Phase 1; mostly consistency and quality-of-life fixes with
no meaningful user-facing risk.

- Add a durable audit trail for record deletion (a table, or at minimum log-to-file
  instead of console-only) and the missing `res.count > 0` check in `POST /api/records`'s
  fill-timein branch ([DATA-10](./data-integrity.md#data-10),
  [DATA-11](./data-integrity.md#data-11) →
  [#48](https://github.com/mjfelecio/Event-Attendance-System/issues/48)).
- Validation-schema pass: `.trim()` on name/ID fields, sensible `.max()` bounds,
  student-ID format validation if a real format exists, and duplicate-ID detection
  within a bulk-import batch ([DATA-07](./data-integrity.md#data-07),
  [DATA-08](./data-integrity.md#data-08), [SEC-09](./security.md#sec-09),
  [SEC-10](./security.md#sec-10) →
  [#47](https://github.com/mjfelecio/Event-Attendance-System/issues/47)).
- Add `requireAuth()` to the three currently-unauthenticated `GET` routes for
  consistency ([SEC-06](./security.md#sec-06) →
  [#49](https://github.com/mjfelecio/Event-Attendance-System/issues/49)).
- Attendance UI polish: a done-state on the Time In button in normal mode, and a
  per-event scan debounce key ([OPS-10](./operability.md#ops-10),
  [OPS-12](./operability.md#ops-12) →
  [#50](https://github.com/mjfelecio/Event-Attendance-System/issues/50)).
- Consolidate the duplicated event-authorization logic across
  `POST /api/events` / `PATCH /api/events/[eventId]` / the print page's hand-rolled
  copy (carried forward from the architecture pass, `architecture.md` §17.9) — a
  larger refactor, appropriately deferred.
- Clean up the dead/stale code inventoried in `architecture.md` §19
  (`eventValidation.ts`, `useFetchGroupsForStudent`, the `categoryGroups.ts` leftovers,
  the incorrect README seed credentials) — no functional risk, purely a maintainability
  cleanup. (`mapStudentToRow.ts` and `useStudentTableControls.ts` were removed in the
  manage-list → students rename.)

---

## Phase 3 — Future improvements

Backlog, longer-horizon. These are the items that require actual architectural change,
not just a patch — correctly out of scope for "fix before beta" per the audit's release
context.

- **Historical eligibility snapshots** ([DATA-06](./data-integrity.md#data-06) →
  [#45](https://github.com/mjfelecio/Event-Attendance-System/issues/45)) — stop
  recomputing event eligibility live from the current roster; snapshot the eligible set
  at event approval or event start. This is a schema change (a new table or a
  materialized snapshot column) and a meaningful behavior change to how reports work —
  needs its own design discussion, not a quick fix. The near-term deliverable on that
  issue is *documenting* the behavior for report readers, not changing it.
- **PostgreSQL migration** ([`postgres-migration.md`](./postgres-migration.md) →
  [#51](https://github.com/mjfelecio/Event-Attendance-System/issues/51)) — squash
  the SQLite migration history to a fresh Postgres baseline, swap the driver adapter,
  migrate data. Fully deferred; theoretical scale is explicitly out of scope for this
  beta per the audit brief, and the issue is labelled to say so explicitly.
- **Server-side pagination and search** — `architecture.md` §17.6–7 already documents
  this as a known constraint; the shared `DataTable` component already has a `manual`
  mode built for exactly this, unused on `main`. Worth doing once student counts or
  concurrent usage grow meaningfully beyond this beta's scale.
- **A real admin console** covering everything currently only reachable via direct
  database access — group management, user management (list/deactivate active
  organizers, not just review pending ones), and system health/config visibility. This
  is the long-term answer to [OPS-06](./operability.md#ops-06)'s "no operator console"
  finding.
- **Horizontal scaling readiness** (shared rate-limit store, connection pooling) — not
  relevant at the stated 2–5 concurrent users; only worth revisiting if usage
  substantially grows beyond this deployment model.

# Findings — Master List

Audit pass against `main` at commit `a3896e8`, read-only (no code changed). Companion
reading: [`architecture.md`](../architecture.md), [`domain-model.md`](../domain-model.md).

> **Reconciliation pass (2026-08-16).** Every P0/P1 finding below was re-verified
> against the actual source, and actionable findings were filed as GitHub Issues
> (#37–#52). **This document is the detailed technical record; the GitHub Issues are
> the actionable work queue.** Findings were grouped where they represent one coherent
> piece of work, so several rows below map to a shared issue. One new finding (SEC-11)
> was discovered during reconciliation. Issue numbers appear in the `Issue` column.

Every finding has a stable ID (`SEC-nn`, `DATA-nn`, `OPS-nn`) reused verbatim in
[`security.md`](./security.md), [`data-integrity.md`](./data-integrity.md), and
[`operability.md`](./operability.md), which give each one fuller treatment. This
document is the flat index: severity, one-line problem, location, and status.

**Confidence key** — CONFIRMED: the code demonstrably allows the problem, verified by
reading the exact logic. LIKELY: the implementation strongly suggests the problem but
it depends on a runtime condition (data volume, network topology) not exercised in this
static pass. POSSIBLE: a suspicious pattern exists but reachability through the app's
current write paths is unclear or improbable.

Severity follows the brief's calibration: **P0/P1 are reserved for issues that
materially affect this specific one-week beta** — not theoretical scale, not
enterprise hardening. Three root causes account for every P0.

---

## P0 — Release blockers

| ID | Category | Title | Confidence | Issue |
|---|---|---|---|---|
| [SEC-01](./security.md#sec-01) | Security / Deployment | `Secure` cookie flag drops sessions on LAN HTTP in production builds | CONFIRMED (code) / LIKELY (manifests as described) | [#37](https://github.com/mjfelecio/Event-Attendance-System/issues/37) |
| [SEC-02](./security.md#sec-02) | Security / Deployment | QR camera cannot open on any non-`localhost` device over HTTP | CONFIRMED (platform spec) / LIKELY | [#37](https://github.com/mjfelecio/Event-Attendance-System/issues/37) |
| SEC-11 *(new)* | Security / Deployment | `AUTH_SECRET` is unset and throws in production builds, surfacing as a misleading `500 "Database error occurred."` | CONFIRMED | [#37](https://github.com/mjfelecio/Event-Attendance-System/issues/37) |
| [DATA-01](./data-integrity.md#data-01) | Data integrity | ~~Bulk student import has no custom transaction timeout; likely fails outright at 2,000+ rows~~ **RESOLVED 2026-08-20** — explicit `transactionOptions` set; verified at full roster size | CONFIRMED (code) / LIKELY (scale) | [#38](https://github.com/mjfelecio/Event-Attendance-System/issues/38) |
| [DATA-02](./data-integrity.md#data-02) | Data integrity / Operability | ~~No way to add a missing `Group` (section/department/etc.) without a fully destructive reseed or a direct DB edit~~ **RESOLVED 2026-08-17** — Settings → Groups | CONFIRMED | [#39](https://github.com/mjfelecio/Event-Attendance-System/issues/39) |

All five trace back to three root causes: **(1)** the app is being run over plain HTTP
on a LAN in a production build, which two independent browser platform rules punish and
which additionally trips the unset-`AUTH_SECRET` guard; **(2)** the only bulk
roster-loading path was never load-tested at the stated scale; **(3)** there is no
supported way to extend the school's group vocabulary once seeded. None require a
redesign to fix — see [`remediation-plan.md`](./remediation-plan.md) Phase 0.

**SEC-11 (added during the 2026-08-16 reconciliation pass).** `getAuthSecret()`
(`globals/utils/auth.ts:34-45`) throws when `AUTH_SECRET` is unset or under 16
characters and `NODE_ENV === "production"`. The repository's `.env` defines only
`DATABASE_URL`. Because the thrown value is a plain `Error` — not an `AuthError` or
`ZodError` — `respondWithError` falls through to `handlePrismaError`, whose `default`
branch returns **`500 "Database error occurred."`**. A missing configuration variable
therefore presents to the operator as a database failure. Filed with SEC-01/SEC-02 in
[#37](https://github.com/mjfelecio/Event-Attendance-System/issues/37) because all three
are triggered by the same action (switching to a production build) and are resolved as
one deployment task.

---

## P1 — Should fix before beta

| ID | Category | Title | Confidence | Issue |
|---|---|---|---|---|
| [SEC-03](./security.md#sec-03) / [DATA-05](./data-integrity.md#data-05) | Authorization / Data integrity | ~~Admin can silently change an APPROVED event's category/audience after attendance already exists~~ **RESOLVED 2026-09-20** — shared audience guard + explicit acknowledgement | CONFIRMED | [#40](https://github.com/mjfelecio/Event-Attendance-System/issues/40) |
| [SEC-05](./security.md#sec-05) / [OPS-03](./operability.md#ops-03) | Security / Operability | Signup rate limit is a single network-wide bucket (5 signups / 10 min, for everyone) | CONFIRMED | [#43](https://github.com/mjfelecio/Event-Attendance-System/issues/43) |
| [DATA-04](./data-integrity.md#data-04) | Data integrity | No backup strategy for the single SQLite file | CONFIRMED (absence) | [#41](https://github.com/mjfelecio/Event-Attendance-System/issues/41) |
| [DATA-12](./data-integrity.md#data-12) *(new)* | Data integrity | ~~A scoped event with zero groups matched the entire school instead of nobody~~ **FIXED 2026-08-17** | CONFIRMED | found while fixing [#39](https://github.com/mjfelecio/Event-Attendance-System/issues/39) |
| [OPS-08](./operability.md#ops-08) | Operability | No process supervision for the server — closing the terminal or laptop sleep takes down attendance for everyone | CONFIRMED (absence) | [#42](https://github.com/mjfelecio/Event-Attendance-System/issues/42) |

---

## P2 — Important backlog items

| ID | Category | Title | Confidence | Issue |
|---|---|---|---|---|
| [DATA-03](./data-integrity.md#data-03) / [OPS-07](./operability.md#ops-07) | Data integrity / Operability | Deleting a student with attendance history gives a misleading error message | CONFIRMED | [#44](https://github.com/mjfelecio/Event-Attendance-System/issues/44) |
| [DATA-06](./data-integrity.md#data-06) | Data integrity | Eligibility is always computed live — roster corrections retroactively rewrite past events' reports | CONFIRMED (by design) | [#45](https://github.com/mjfelecio/Event-Attendance-System/issues/45) |
| [OPS-05](./operability.md#ops-05) | Operability | ~~No self-service password reset — recovery is a direct DB edit~~ **RESOLVED 2026-08-17** — admin-issued temporary passwords + self-service change | CONFIRMED (absence) | [#46](https://github.com/mjfelecio/Event-Attendance-System/issues/46) |
| [OPS-06](./operability.md#ops-06) | Operability | ~~Settings page is a placeholder; almost nothing is fixable in-app~~ **LARGELY RESOLVED 2026-08-17** — `/settings` operator console; user deactivation and role changes remain runbook-only | CONFIRMED | [#46](https://github.com/mjfelecio/Event-Attendance-System/issues/46) |

---

## P3 — Minor improvements

| ID | Category | Title | Confidence | Issue |
|---|---|---|---|---|
| [SEC-06](./security.md#sec-06) | Security | Three `GET` endpoints require no authentication (low-sensitivity data) | CONFIRMED | [#49](https://github.com/mjfelecio/Event-Attendance-System/issues/49) |
| [SEC-09](./security.md#sec-09) | Security | No upper-bound length validation on text fields | CONFIRMED | [#47](https://github.com/mjfelecio/Event-Attendance-System/issues/47) |
| [DATA-07](./data-integrity.md#data-07) | Data integrity | Names/IDs are not trimmed — stray whitespace from CSV import passes validation | CONFIRMED | [#47](https://github.com/mjfelecio/Event-Attendance-System/issues/47) |
| [DATA-08](./data-integrity.md#data-08) | Data integrity | Duplicate student ID within one import batch is silently resolved to "last wins," no warning | CONFIRMED | [#47](https://github.com/mjfelecio/Event-Attendance-System/issues/47) |
| [DATA-09](./data-integrity.md#data-09) | Data integrity | "One group per category" is assumed, not enforced, by the schema | POSSIBLE (unreachable via reviewed UI paths) | *no issue — see note* |
| [DATA-10](./data-integrity.md#data-10) | Data integrity | Record deletion audit trail is console-only, lost on restart | CONFIRMED (by design) | [#48](https://github.com/mjfelecio/Event-Attendance-System/issues/48) |
| [DATA-11](./data-integrity.md#data-11) | Data integrity | `POST /api/records` "fill missing timein" branch reports `changed:true` without checking the affected-row count | CONFIRMED (code) / not reachable via current UI paths found | [#48](https://github.com/mjfelecio/Event-Attendance-System/issues/48) |
| [OPS-09](./operability.md#ops-09) | Operability | Calendar hides past dates entirely; a completed event is invisible there (only in Reports) | CONFIRMED | *addressed by open [PR #36](https://github.com/mjfelecio/Event-Attendance-System/pull/36)* |
| [OPS-10](./operability.md#ops-10) | Operability | "Time In" button in normal mode never shows a done state, even when already recorded | CONFIRMED | [#50](https://github.com/mjfelecio/Event-Attendance-System/issues/50) |
| [OPS-11](./operability.md#ops-11) | Operability | No clock-sync verification — a wrong host clock silently produces wrong timestamps | CONFIRMED (absence) | *pre-event checklist item in [#52](https://github.com/mjfelecio/Event-Attendance-System/issues/52)* |

**Deliberately not filed as issues.** `DATA-09` is POSSIBLE-confidence and unreachable
through any reviewed application write path (the student write path always sets
`groups: { set: [...] }` from five single-valued form fields); it is recorded here
rather than filed to avoid backlog noise. `OPS-11` is a 30-second pre-event check, not
code work, so it lives in the umbrella issue's verification checklist. `OPS-09` was
verified as still present in the code at `a3896e8` but is **already fixed** by the open
[PR #36](https://github.com/mjfelecio/Event-Attendance-System/pull/36), which removes
`validRange` — no issue was filed to avoid duplicating in-flight work.

---

## P4 — Optional / nice-to-have

| ID | Category | Title | Confidence | Issue |
|---|---|---|---|---|
| [SEC-07](./security.md#sec-07) | Security | Minor timing side-channel on login (email enumeration) | CONFIRMED (code) / low real-world impact | *not filed* |
| [SEC-08](./security.md#sec-08) | Security | No CSRF token (SameSite=Lax is the only mitigation) | CONFIRMED (absence), low risk for this app's request patterns | *not filed* |
| [SEC-10](./security.md#sec-10) | Security | Student ID is only length-validated, not charset-validated | CONFIRMED | folded into [#47](https://github.com/mjfelecio/Event-Attendance-System/issues/47) |
| [OPS-12](./operability.md#ops-12) | Operability | QR scan debounce is global, not per-event; a same-student scan across an event switch within 1s could be dropped | CONFIRMED (code), edge case | folded into [#50](https://github.com/mjfelecio/Event-Attendance-System/issues/50) |

SEC-10 and OPS-12 remain **P4 on their own merits** — they were not re-graded. Each was
folded into an adjacent P3 issue that already touches the same code (the validation-schema
pass and the attendance-UI pass respectively), because the marginal cost of including
them there is near zero. SEC-07 and SEC-08 were not filed at all: both are correctly
mitigated for this deployment's threat model (a private LAN with no public exposure),
and filing them would add backlog noise without adding safety.

---

## Everything already known and intentionally out of scope for P0/P1

The prior architecture pass already documented a set of accepted, deliberate
simplifications (no horizontal scaling, no server-side pagination/search, duplicated
authorization logic across `POST /api/events` / `PATCH /api/events/[eventId]` / the
print page, stale/dead code, console-only rate limiting). This audit re-verified all of
them against the current code and found no material change to their status. They are
carried forward at their existing (low) severity in the relevant specialized documents
rather than re-litigated here. See `architecture.md` §17–19 for the full list.

---

## Coverage note

This pass read every `app/api/**/route.ts` handler, every file under `globals/utils/`
and `globals/schemas/`, the full attendance/QR component tree, the calendar
create/edit/drag/resize path, the print page and its server-side authorization copy,
the reports list/table/export path, both dashboards, all 13 Prisma migrations, and the
seed script. It did not execute the application — every "LIKELY" item needs the runtime
verification listed in [`release-readiness.md`](./release-readiness.md).

## Reconciliation pass — 2026-08-16

A second pass re-verified the documentation against the actual source at `a3896e8` and
filed the actionable findings as GitHub Issues. Results:

- **All P0 and P1 findings were re-confirmed** by reading the exact code paths. None had
  been fixed in the interim, and none were found to be overstated.
- **One new P0-adjacent finding was added**: SEC-11 (`AUTH_SECRET` unset → misleading
  `500 "Database error occurred."`), folded into
  [#37](https://github.com/mjfelecio/Event-Attendance-System/issues/37).
- **One finding is already fixed in flight**: OPS-09's `validRange` removal is part of
  the open [PR #36](https://github.com/mjfelecio/Event-Attendance-System/pull/36).
- **Corrections to earlier documentation**, verified against source during this pass:
  - `buildEventStudentFilter` has **7 call sites across 5 files**, not six as previously
    stated here and in `data-integrity.md#data-06`
    (`app/api/events/[eventId]/stats/route.ts`, `app/api/records/route.ts`,
    `app/api/events/[eventId]/records/route.ts` ×2, `app/api/students/route.ts` ×2, and
    the print page).
  - The claim in `conventions.md` that no schema calls `.trim()` is **overstated**:
    `patchSchema` in `app/api/events/[eventId]/route.ts` does apply
    `z.string().trim().min(1)` to `title`. The finding still holds for `studentSchema`,
    which is the one that matters for CSV import — but the codebase is inconsistent
    here rather than uniformly missing it.
- **No secrets were found committed.** `.env` and `prisma/dev.db` are correctly
  gitignored and have never been committed (`dev.db` was untracked in commit
  `a6668b1`).
- **Zero pre-existing GitHub Issues** existed in the repository, so no duplicates were
  created. The `#N` references in historical commit messages refer to *pull requests*
  and to internal audit-item numbering inside those PR descriptions, not to issues.

---
name: project-orientation
description: Orientation for the Event Attendance System repo — deployment model, stack, directory layout, entity model, and event lifecycle. Use at the start of any non-trivial task in this repo, or whenever you need the "big picture" before touching code.
---

# Event Attendance System — Orientation

This is a school attendance-tracking app. Read this first on any non-trivial task; it
tells you where the deeper docs are and the handful of facts that shape every decision
in this codebase.

**Full docs (read these for depth, this skill is the summary):**
- [`docs/architecture.md`](../../../docs/architecture.md) — system design, request/data
  flow, concurrency model, deployment constraints, known dead code
- [`docs/domain-model.md`](../../../docs/domain-model.md) — entities, invariants,
  lifecycle rules
- [`docs/conventions.md`](../../../docs/conventions.md) — "how do I do X" for every
  layer of the codebase
- [`docs/audit/findings.md`](../../../docs/audit/findings.md) — indexed known issues
  (P0–P4); check here before "discovering" a bug that's already tracked
- [`docs/claude-skills.md`](../../../docs/claude-skills.md) — index of all skills

## The one fact that explains most design decisions

**This runs on a single laptop, on a LAN, backed by one PostgreSQL 17 database, for one week at a
time (a school event), with 2,000+ students but only 2–5 concurrent staff users.**
There is no horizontal scaling, no server cluster, no managed database. Decisions that
look under-engineered from a "normal SaaS" lens (in-process rate limiting, one bounded
`pg` pool per process, console-only logging) are deliberate for this scale, not oversights
— see `architecture.md` §15–16 for the full list of accepted simplifications. Don't
"fix" these without understanding this is the intended deployment shape.

## Stack

Next.js 15 (App Router, Turbopack) + React 19, Prisma 7 with the
`@prisma/adapter-pg` driver adapter (not the classic engine), PostgreSQL 17,
custom HMAC-signed cookie auth (no NextAuth/Clerk/etc.), TanStack Query v5 + TanStack
Table v8, react-hook-form + Zod v4, shadcn/Radix UI components, FullCalendar,
`@yudiel/react-qr-scanner` + `react-qr-code`.

## Directory layout

- `app/` — Next.js App Router routes. `(auth)` route group = unauthenticated pages;
  `(main)` = everything behind the sidebar. `app/api/**/route.ts` = all backend logic.
- `features/*/` — one directory per UI feature (`attendance`, `calendar`,
  `students`, `reports`, `auth`), each with its own `components/`, `hooks/`,
  `utils/`, `constants/`. Features do not import from each other except one narrow,
  known exception (`features/attendance/components/DataCard.tsx`, reused by reports).
- `globals/` — anything shared across features: `utils/`, `hooks/`, `schemas/`,
  `types/`, `constants/`, `contexts/`, `components/shared/` (app-level wrappers) and
  `components/shad-cn/` (vendored UI primitives — treat as third-party, don't hand-edit).
- `prisma/` — `schema.prisma`, `migrations/`, `seed.ts`.

Full detail and the "which directory does X belong in" decision rule: see
`docs/conventions.md`'s "Where should shared logic live?" section.

## The five entities (see `domain-model.md` for full detail)

`Event`, `Student`, `Record` (an attendance entry), `User` (organizer/admin),
`Group` (a section/department/program/strand/house — the vocabulary a student or event
can be scoped by). A `Record` links exactly one `Event` to one `Student`
(`@@unique([eventId, studentId])` — this is the invariant that makes duplicate
attendance structurally impossible; never work around it).

## Event lifecycle

`DRAFT → PENDING → APPROVED` (or `REJECTED`, or back to `DRAFT` on edit-after-reject).
Only `APPROVED` events are visible to non-owning organizers and can record attendance.
An admin can force-edit an `APPROVED` event's content — including one known gap (an
admin can rescope an approved event's audience even after it has attendance; see the
`auth-and-authorization` skill and `SEC-03` in `docs/audit/security.md`).

## Attendance eligibility is computed live, not snapshotted

"Is this student eligible for this event" is recomputed from the *current* roster
every time it's read (`globals/utils/buildEventStudentFilter.ts`). There is no
historical snapshot. A roster correction made today changes last week's event reports.
This is a documented, deliberate tradeoff (`DATA-06` in `docs/audit/data-integrity.md`),
not a bug — don't "fix" it by adding ad hoc snapshotting without reading that finding
and `remediation-plan.md`'s Phase 3 first (it's a real schema change, not a quick patch).

## When you're about to change something structural

Before touching `prisma/schema.prisma`, the auth cookie format, the event workflow
states, or the eligibility filter, read the relevant invariants in `domain-model.md`
and check `docs/audit/findings.md` for whether the area already has a tracked issue —
you may be about to "fix" something that's already scoped, or duplicate a known gap.

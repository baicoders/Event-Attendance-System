# Security Audit

Scope: authentication, authorization, IDOR/BOLA, trust boundaries, rate limiting,
secrets, and attendance-endpoint abuse — focused on this app's actual threat model
(a school LAN with 2,000+ students, ~7 staff accounts, no public internet exposure),
not a generic enterprise pentest checklist.

**Headline finding**: there is no authorization *bypass* anywhere in this codebase.
Every route that should check ownership, role, or event status does so, consistently,
using the same four primitives in `globals/utils/auth.ts`. The real risk in this app is
not "an organizer can reach admin endpoints" — it's that **the deployment's HTTP
transport undermines the auth model it otherwise implements correctly**, and that one
authorization *design* decision (admin can freely edit approved+recorded events) has a
real data-integrity consequence.

---

## SEC-01 — `Secure` cookie flag drops sessions on LAN HTTP {#sec-01}

**Severity:** P0 — release blocker
**Confidence:** CONFIRMED (code) / LIKELY (manifests exactly as described in this deployment)
**Location:** `globals/utils/auth.ts:89` (`setAuthSession`)

```ts
cookieStore.set(AUTH_COOKIE, serializeSession(session), {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  ...
});
```

**Problem:** `pnpm build && pnpm start` runs Next.js with `NODE_ENV=production`, which
sets `secure: true` on the auth cookie. Browsers refuse to send or store `Secure`
cookies on a connection that isn't HTTPS, with a special-case exemption only for
`localhost`. The deployment model is one laptop running the server, reached by other
devices at `http://192.168.x.x:3000` — that origin gets no exemption.

**Why it matters:** this is the exact deployment plan in the brief. If it's run as a
production build (the natural choice for "real" use over `next dev`), every device
*except the host laptop itself* will appear to log in successfully (the response sets
the cookie) and then immediately behave as logged out on the next request, because the
browser silently discarded the cookie. Organizers and admins on phones/other laptops
would be unable to stay authenticated at all.

**Reproduction:** `pnpm build && pnpm start` on the host laptop; from a second device on
the same Wi-Fi, browse to `http://<host-ip>:3000/login` and log in. Expect the login
call to succeed (200) but the very next request to come back unauthenticated.

**Recommended fix direction:** serve the app over HTTPS on the LAN (a local CA via
`mkcert` trusted on each device, or a reverse proxy like Caddy that self-signs and can
be trusted once per device) — this also unblocks SEC-02, since the QR camera has the
identical requirement. If HTTPS genuinely cannot be arranged in time, the fallback is
running in `next dev` mode (which does not force `NODE_ENV=production` and would not
set `Secure`) — but that trades away production performance/hardening and should be a
conscious, documented decision, not a silent one. Either way this needs a decision and
a rehearsal before the event, not a same-day discovery.

**Release blocker:** yes. **Backlog ticket:** yes, for the permanent HTTPS setup;
the immediate call is operational, not a code change (see `release-readiness.md`).

---

## SEC-02 — QR camera cannot open over LAN HTTP {#sec-02}

**Severity:** P0 — release blocker
**Confidence:** CONFIRMED (browser platform spec) / LIKELY (this deployment triggers it)
**Location:** `features/attendance/components/ScannerCamera.tsx` (`@yudiel/react-qr-scanner` → `navigator.mediaDevices.getUserMedia`)

**Problem:** `getUserMedia` is only available in a *secure context*. `https://` origins
and `http://localhost` qualify; `http://192.168.x.x` does not. This is enforced by every
modern browser, not by this codebase.

**Why it matters:** QR scanning is the primary attendance-recording method the app is
built around. On any device other than the host laptop itself, tapping "Open Camera"
will fail silently or with a permissions/`NotAllowedError`-style failure — the feature
simply will not work. Manual entry (`ManualAttendanceSection`) still functions as a
fallback, so attendance isn't *impossible*, but the app degrades to a much slower,
search-and-click workflow for every device except one, for 2,000+ students.

**Reproduction:** open the attendance page from a phone at `http://<host-ip>:3000`,
tap "Open Camera." Expect the browser to refuse camera access or the scanner library to
error immediately.

**Recommended fix direction:** same as SEC-01 — this is resolved by the same HTTPS
setup. If that's not feasible in time, per-device Chrome flags
(`chrome://flags/#unsafely-treat-insecure-origin-as-secure`, adding the host's origin)
are a documented, workable stopgap for a small, known set of organizer devices, but
must be set up and tested on each device in advance — not discovered at the event.

**Release blocker:** yes, unless the plan is explicitly "manual entry only," which
should be a conscious decision made this week, not a surprise on event day.
**Backlog ticket:** yes, for a durable HTTPS setup post-beta.

---

## SEC-03 — Admin can silently rescope an approved event with existing attendance {#sec-03}

**Severity:** P1 — should fix before beta
**Confidence:** CONFIRMED
**Location:** `app/api/events/route.ts:136-142` (POST update path), `app/api/events/[eventId]/route.ts:167-173` (PATCH content-edit path), `features/calendar/components/EventDrawer.tsx` (no read-only lock for admins), `features/calendar/hooks/useCalendarEvents.ts` (drag/resize uses the same save path)

**Problem:** for a non-admin, `editableStatuses` is `["DRAFT", "REJECTED"]` — approved
events are locked. For an **admin**, `editableStatuses` is *all four statuses*,
including `APPROVED`, with no additional check for whether the event already has
attendance `Record`s. The admin can change `title`, `category`, `includedGroups`,
`start`, `end` on an event that has already been scanned, through the same endpoint
used for ordinary content edits, and through calendar drag/resize (`editable` is `true`
for admins on every event, per `canEditEvent` in `features/calendar/utils/calendar.ts`).
Nothing — not the Zod schema, not `validateEventGroupIds`, not the route handler, not
the `EventDrawer` UI — checks `attendanceCount > 0` before allowing this, even though
the sibling `DELETE` handlers do check exactly that (`EVENT_HAS_RECORDS`, 409) for
deletion.

**Why it matters:** `buildEventStudentFilter` (the eligibility engine) is evaluated at
*read* time from the event's *current* `category`/`includedGroups`. If an admin changes
an approved event's category after students have been scanned, every report, stat, and
print-out for that event is silently recomputed against the new scope — students who
were actually scanned can vanish from the report (if they don't match the new
criteria), and the presence/absence and rate numbers shift with no audit trail
explaining why. This is not a hypothetical: the only interface available for "fix a
typo in an approved event's title" is the *same* full-content form that also lets the
category and groups change, with zero warning either way.

**Reproduction:** as admin, open an approved event that already has attendance records
→ change Category from e.g. `SECTION` to `HOUSE` (or add/remove a group) → Save. The
event updates with no error; `GET /api/events/[id]/stats` for that event now returns
different eligible/present counts.

**Recommended fix direction:** for events with `attendanceCount > 0`, either (a) block
changes to `category`/`includedGroups` specifically (allow title/location/description
edits to still go through), or (b) require an explicit confirmation step that names the
consequence ("This event already has N attendance records; changing its audience will
change who counts toward its report"). (a) is the more defensible default. This is a
scoped, well-understood change — not a redesign.

**Release blocker:** no (requires deliberate admin action; brief admins on this in the
interim). **Backlog ticket:** yes — recommend fixing before beta if time allows, since
the fix is small; otherwise Phase 0/1 per the remediation plan.

**RESOLVED 2026-09-20 (#40):** both event-edit routes now run the shared
`getEventAudienceChangeError` guard (`globals/utils/eventAudienceGuard.ts`). When an
`APPROVED` event's `category`/`includedGroups` actually change *and*
`attendanceCount > 0`, the request is rejected with `409` +
`AUDIENCE_CHANGE_HAS_RECORDS` unless the caller passes `acknowledgeAudienceChange:
true`. The `EventDrawer` surfaces the consequence via `useConfirm()` (naming the record
count) and only re-sends with the flag after the admin confirms; benign edits and
calendar drag/resize (which echoes the unchanged audience) pass through untouched. This
is option 2 (confirm with consequence) with a server-side fallback to option 1: without
the explicit flag, a rescope is always blocked.

---

## SEC-04 — see DATA-03 / OPS-07

Cross-referenced in [`data-integrity.md`](./data-integrity.md#data-03) and
[`operability.md`](./operability.md#ops-07) — a misleading error message on student
deletion, not an authorization gap (the "any active user may delete a student" policy
is intentional and documented).

---

## SEC-05 — Signup rate limit is a single global bucket on this deployment {#sec-05}

**Severity:** P1 — should fix before beta
**Confidence:** CONFIRMED
**Location:** `globals/utils/rateLimit.ts:41-45` (`clientKey`), `app/api/auth/signup/route.ts:25`

```ts
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
// signup route:
rateLimit(`signup:${clientKey(req)}`, 5, 10 * 60_000)
```

**Problem:** `X-Forwarded-For` is a header a *reverse proxy* adds — browsers never send
it on a direct connection. The deployment model here is devices connecting straight to
the Next.js process on the LAN, with no proxy in front. That means `clientKey(req)`
resolves to the literal string `"local"` for every device, every time. The signup rate
limit key is `signup:local` for the whole network: **5 signups total, from anyone,
every 10 minutes** — not 5 per person.

**Why it matters:** onboarding ~5 organizers is exactly the kind of thing that happens
in one sitting, walking through signup together. The 6th signup attempt within 10
minutes of the first — regardless of whose it is — gets a "Too many signup attempts"
429, which will read as the app being broken rather than a rate limit.

(The equivalent login-limiter key, `login:local:<email>`, is less affected because the
email is part of the key — it still isolates per-account, just without the IP
component. That's a much smaller gap and isn't flagged as a separate item.)

**Reproduction:** from any five browsers/devices on the LAN, submit six signups within
10 minutes. The sixth — even from a device that has never signed up before — gets 429.

**Recommended fix direction:** either raise the signup limit to account for a whole
staff's worth of onboarding in one sitting (e.g., 20 per 10 minutes), or accept the
current limit and instruct whoever runs onboarding to space out signups by more than 10
minutes if there are more than 5. The safer, still-small fix is raising the limit — it
costs nothing given this app has no public internet exposure to actually abuse it.

**Release blocker:** no (workaround: space out onboarding). **Backlog ticket:** yes.

---

## SEC-06 — Three unauthenticated `GET` endpoints {#sec-06}

**Severity:** P3
**Confidence:** CONFIRMED
**Location:** `app/api/groups/route.ts`, `app/api/groups/byCategory/[category]/route.ts`, `app/api/stats/student-counts/route.ts`

**Problem:** none of these three call `requireAuth()`. Anyone who can reach the
server's port — any device on the LAN — can list every department/program/strand/
house/section name and slug, and aggregate student counts by category, without logging
in.

**Why it matters:** no PII is exposed (names, slugs, and counts only — no student
records). Given the app is LAN-only with no public exposure, the practical risk is low.
Noted for completeness and consistency (every other data-bearing route requires auth).

**Recommended fix direction:** add `requireAuth()` to all three for consistency. Low
priority.

**Release blocker:** no. **Backlog ticket:** yes, low priority.

---

## SEC-07 — Minor timing side-channel on login {#sec-07}

**Severity:** P4
**Confidence:** CONFIRMED (code) — real-world exploitability is very low
**Location:** `app/api/auth/login/route.ts:31`

```ts
if (!user || !(await verifyPassword(password, user.password))) {
```

**Problem:** short-circuit evaluation means `verifyPassword` (an scrypt computation,
deliberately slow) is skipped entirely when the email doesn't exist. A response-timing
comparison between "unknown email" (fast) and "known email, wrong password" (slow)
could theoretically be used to enumerate registered emails.

**Why it matters:** for a small school user base on a private LAN with no adversarial
population realistically running timing attacks against colleagues' login pages, this
is very low real-world risk. Included for completeness per the audit's security focus
areas.

**Recommended fix direction:** run a dummy `verifyPassword` call (or equivalent
constant-time delay) on the "user not found" path. Trivial change, not urgent.

**Release blocker:** no. **Backlog ticket:** optional.

---

## SEC-08 — No CSRF token {#sec-08}

**Severity:** P4
**Confidence:** CONFIRMED (absence) — mitigated by `SameSite=Lax`
**Location:** `globals/utils/auth.ts` (cookie config)

**Problem:** the app relies solely on `sameSite: "lax"` for CSRF protection; there is no
per-request CSRF token. `SameSite=Lax` blocks cross-site `fetch`/XHR with credentials
(which is how every mutation in this app is made) and blocks cross-site form
`POST`s, covering the realistic attack surface here. It does not protect top-level
cross-site GET navigations, but this app has no state-changing `GET` routes.

**Why it matters:** low risk given the mutation pattern (fetch-based JSON APIs, not
classic form posts) and the LAN-only threat model. Flagged for completeness only.

**Recommended fix direction:** none needed for this beta. If the app is ever exposed
beyond the LAN, revisit.

**Release blocker:** no. **Backlog ticket:** no.

---

## SEC-09 — No upper-bound length validation on text fields {#sec-09}

**Severity:** P3
**Confidence:** CONFIRMED
**Location:** `globals/schemas/studentSchema.ts`, `globals/schemas/index.ts` (`eventSchema`), `app/api/events/[eventId]/route.ts` (`patchSchema`)

**Problem:** every `z.string()` field (event title, location, description, student
names) has a `.min(1)` but no `.max(...)`. Nothing stops an oversized value (a
multi-megabyte description, for instance) from being accepted and stored in SQLite,
which has no inherent column-length limit.

**Why it matters:** low likelihood of a deliberate attack given the LAN-only, small
known-user-base context; more relevant as a data-quality/accidental-paste guard (e.g.
someone pastes a whole spreadsheet into a description field). Not something that will
surface during the beta under normal use.

**Recommended fix direction:** add reasonable `.max()` bounds (e.g., 200 for
title/location, 2000 for description, 100 for names) to the shared schemas.

**Release blocker:** no. **Backlog ticket:** yes, low priority.

---

## SEC-10 — Student ID is only length-validated {#sec-10}

**Severity:** P4
**Confidence:** CONFIRMED
**Location:** `globals/schemas/studentSchema.ts:7-10`

**Problem:** `id: z.string().min(1).length(11)` — any 11-character string passes,
letters or digits, no format/checksum check.

**Why it matters:** increases the chance that a typo during manual entry or CSV import
(one character off, still 11 characters) silently creates a near-duplicate student
record instead of being caught as invalid, per the broader duplicate-record risk
covered in `data-integrity.md`.

**Recommended fix direction:** if the school's IDs follow a known format (e.g.,
all-numeric, or a fixed prefix), encode that in the schema. Low priority absent a known
format to validate against.

**Release blocker:** no. **Backlog ticket:** optional.

---

## Explicitly checked and found sound

To keep this document honest about what was *not* found, not just what was:

- **IDOR/BOLA on events/records/students:** every read and write that should scope to
  ownership or visibility does so server-side (`assertEventOwnership`,
  `assertEventVisibility`, `assertEventStatus`), independent of what the client shows or
  hides. Manipulating route parameters or request bodies to reach another organizer's
  DRAFT event, or to approve/reject as a non-admin, is rejected with 403/404/409 at the
  handler, not just hidden in the UI.
- **Role escalation:** there is no path to create an `ADMIN` account through the app
  (signup always writes `ORGANIZER`/`PENDING`), and role/status are re-read from the
  database on every request (`getFreshAuthSession`), not trusted from the cookie —
  demoting or rejecting a user takes effect on their very next request.
- **Cookie tampering:** the session cookie is HMAC-SHA256 signed with
  `timingSafeEqual` comparison, and the embedded expiry is checked server-side
  independent of the browser's `Max-Age`. A forged or replayed-past-expiry cookie is
  rejected.
- **SQL injection:** no raw SQL anywhere in the codebase; every query goes through the
  Prisma query builder.
- **Attendance endpoint abuse (double-scan, replay):** the compare-and-set pattern
  (`updateMany` conditioned on the target column being `NULL`) plus the
  `@@unique([eventId, studentId])` constraint make duplicate/concurrent scans converge
  correctly — verified in `data-integrity.md`.

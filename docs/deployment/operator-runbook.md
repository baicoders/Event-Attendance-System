# Operator Runbook

**For whoever is on-site during the event.** Every procedure here is a fallback
for when the app itself can't be reached — a broken build, a page that won't
load, a login nobody can get past. Each section names the in-app screen that
normally does the job, so try that first.

You need a terminal in the project folder for everything below. Prisma Studio is
a database editor in a browser tab:

```bash
pnpm db:studio        # opens http://localhost:5555
```

> **Never run `pnpm db:seed` on the event database.** The seed deletes every
> record, event, student, group, and user before inserting demo data. It is
> guarded against `NODE_ENV=production`, but that guard is the only thing
> standing between a mistyped command and losing the week's attendance.

For attendance corrections, use **Attendance → Review / correct attendance**.
It records a reason and durable before/after history. Direct edits to `Record`
in Prisma Studio bypass that history; use them only as reviewed incident recovery
with writers stopped. See [attendance correction release notes](attendance-corrections.md).

---

## 1. Back up the database

**Do this before anything else in this document, and every few hours during the
event.** The system of record is the PostgreSQL database `DATABASE_URL` points
at — not a file on the laptop. Back it up with `pg_dump`, using the
administrative connection string (`DIRECT_URL` when set, otherwise
`DATABASE_URL`). These are standard PostgreSQL tools and work the same whether
the database is self-hosted or managed.

```bash
mkdir -p backups
pg_dump --format=custom --file="backups/eas-$(date +%Y%m%d-%H%M).dump" "$DIRECT_URL"
```

`pg_dump` reads consistently without stopping the server, but prefer a quiet
moment anyway.

There is no in-app equivalent. This one is always manual.

### Restore — into a rehearsal database, never over the live one

Never restore a dump over the live event database during the event. Prove a
backup works by restoring it into a separate database:

```bash
# 1. Create an empty rehearsal database on the same server
psql "$DIRECT_URL" -c "CREATE DATABASE eas_rehearsal;"

# 2. Restore into it: the same connection string with only
#    the database name changed to eas_rehearsal
pg_restore --dbname="<DIRECT_URL-with-eas_rehearsal>" "backups/eas-<timestamp>.dump"

# 3. Compare row counts against the live database
psql "<DIRECT_URL-with-eas_rehearsal>" -c 'SELECT (SELECT COUNT(*) FROM "Student") AS students, (SELECT COUNT(*) FROM "Record") AS records, (SELECT COUNT(*) FROM "Event") AS events;'
```

Only promote a rehearsal database to live outside event hours, with the server
stopped, after taking a fresh `pg_dump` of the live database first. Drop the
rehearsal database when done (`DROP DATABASE eas_rehearsal;`).

### Before reopening service: verify, rotate, smoke-check

1. **Role** — confirm which role the app connects as and that it reaches the
   expected database:

   ```bash
   psql "$DATABASE_URL" -c "SELECT current_user, current_database();"
   ```

   The runtime role must not be a superuser and must differ from the
   migration/owner role behind `DIRECT_URL`. Migrations must never run through
   a transaction pooler — `DIRECT_URL` is always the direct endpoint.
2. **TLS** — if the database is reached over a network (another host or a
   managed service), the connection string must verify certificates
   (`sslmode=verify-full`). Never accept `sslmode=disable` to "fix" a
   connection failure. Connections to the local machine do not need TLS.
3. **Pool** — the app opens up to 8 connections per process. Confirm the
   database (or pooler, if one sits in front of it) allows at least that many
   for the runtime role.
4. **Session secret** — if a restored backup reinstates old credentials, or the
   secret may have leaked, set a new `AUTH_SECRET` (≥16 random characters) and
   restart. Every session cookie is invalidated; everyone signs in again.
5. **Smoke checks** — Settings → System shows the expected database name and
   PostgreSQL version and reports `AUTH_SECRET` as configured; sign in as an
   admin and as an organizer; open the attendance page for an approved event
   and confirm records load.

---

## 2. Add a missing section, department, house, program, or strand

**Normally: Settings → Groups → Add group.**

This is the failure that stops a roster import dead. The importer rejects the
*entire* file if one value is unknown:

```
Unknown group(s): BSIT-3A. Fix and retry.
```

### In the app (preferred)

1. Sign in as an admin → **Settings** → **Groups** → **Add group**.
2. Name it (`BSIT-3A`), check the slug (`bsit-3a`), pick the category
   (`SECTION`).
3. Re-run the import. No restart, no waiting.

### Via Prisma Studio (fallback)

1. `pnpm db:studio` → **Group** → **Add record**.
2. Fill in three fields; leave `id`, `createdAt`, and `updatedAt` alone:

   | Field | What to put |
   |---|---|
   | `name` | What people call it — `BSIT-3A`, `Computer Studies` |
   | `slug` | **Exactly what the CSV column contains.** Lowercase, numbers, hyphens: `bsit-3a` |
   | `category` | One of `SECTION`, `DEPARTMENT`, `HOUSE`, `PROGRAM`, `STRAND`, `YEAR` |

3. Save, then re-run the import.

**The slug is the part that matters.** The importer matches a student's CSV value
against `Group.slug`, not against the name. Two live examples of why they differ:

- Strands are slugified from their *code*: the "Computer System Servicing" strand
  has the slug `css`.
- Seeded programs are lowercase: `BSIT` is stored as `bsit`.

`category` must also match the column. A house slug in the section column is
rejected with a "Group category mismatch" error.

### Before onboarding day

Only four sections are seeded (`BSCS-2A`, `BSIT-2B`, `STEM-11A`, `STEM-12B`) and
only four of the thirteen programs. **Reconcile the real school's sections,
departments, programs, strands, and houses against Settings → Groups before
anyone imports a real roster**, and add what's missing. It takes minutes up
front and prevents the import failure entirely.

---

## 3. Reset a forgotten password

**Normally: Settings → Users → Reset password.** The admin reviews the target
(name and email, role/status labels, current revision), enters their own
password, confirms, and is shown a one-time temporary password to hand over.
The old password and existing sign-ins stop working at commit; the user must
pick their own password before reaching any app data or report. If the reset
response is lost, the value cannot be recovered — confirm a **new** reset,
which invalidates the first one.

Resetting your own row is rejected: use the Change password form instead, so
the only active admin session is never invalidated mid-delivery. Resetting a
pending/rejected account does not approve it — login still requires approval.

### Local fallback — no admin can sign in

Run with the application and other database writers stopped, after a backup
(§1). Never type a password into the database directly.

```bash
pnpm account:recover -- --email maria@example.edu
```

Type the target email when asked. The command prints a generated temporary
password once — hand it over, then have the holder pick their own at sign-in.
Role and status are never changed. Restoring a backup later restores old
credentials too: rotate `AUTH_SECRET` before reopening service.

---

## 4. Unblock a user who can't sign in

Check the `User` row's `status` in Prisma Studio.

| Message they see | `status` | Fix |
|---|---|---|
| "Account pending admin approval." | `PENDING` | An admin approves them on the **Dashboard**. Fallback: set `status` to `ACTIVE`. |
| "Your registration was rejected…" | `REJECTED` | Set `status` to `ACTIVE` and clear `rejectionReason`. |
| "Too many login attempts." | — | Wait five minutes, or restart the server — the limit is in memory. |
| "Invalid credentials." | — | Reset their password (§3). |

To make someone an admin, set `role` to `ADMIN`. Permission changes take effect
on their next request; they may need to reload the page.

**There is no in-app screen for any of this yet** — Settings → Users is a
directory plus password reset, and the Dashboard only reviews *pending*
organizers. Once a user is ACTIVE, this runbook is the only route.

---

## 5. A whole 2,000-row import fails

- **"Unknown group(s): …"** — a missing group. See §2.
- **"Group category mismatch"** — a value is in the wrong column (a house name
  in the section column). Fix the CSV.
- **"Database error occurred." on a very large file** — unexpected now: a full
  2,000-student import runs in a single transaction and can take up to a minute
  (keep the tab open). If it instead says **"The database transaction did not
  complete and was rolled back. Retrying the operation is safe."**, just retry —
  imports upsert, so a re-run never creates duplicates.

---

## 6. Nothing loads at all / "Database error occurred." on every page

Most often `AUTH_SECRET` is unset in a production build. The error message says
"database", but the cause is configuration.

1. Check `Settings → System` if you can still reach it — it reports whether
   `AUTH_SECRET` is set and long enough, and which database is in use.
2. Otherwise, in `.env`:

   ```
   AUTH_SECRET="a-long-random-string-at-least-16-characters"
   ```

3. Restart the server. Everyone must sign in again — changing the secret
   invalidates every existing session cookie.

---

## 7. Check the server clock

**Settings → System** shows the server's current time. Compare it against a
phone before the event. A wrong host clock silently writes wrong attendance
timestamps, and there is no way to tell after the fact.

---

## Related documentation

- [`lan-https.md`](./lan-https.md) — the LAN HTTPS deployment
- [`../audit/release-readiness.md`](../audit/release-readiness.md) — pre-event checklist
- [`../domain-model.md`](../domain-model.md) — what groups, events, and records mean

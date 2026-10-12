# Event Attendance System

Web app for managing school events and tracking student attendance at ACLC
College of Ormoc City. Organizers create events (scoped to departments,
houses, strands, programs, sections, or year levels), submit them for admin
approval, and record attendance by QR scan or manual entry with time-in /
time-out tracking.

## Stack

- Next.js (App Router) + TypeScript
- Prisma ORM over PostgreSQL 17 (`@prisma/adapter-pg` + `pg`, one bounded pool per process)
- TanStack Query + Table, shadcn/ui, FullCalendar

## Setup

```bash
# 1. Install dependencies (pnpm via corepack)
corepack pnpm install

# 2. Start PostgreSQL 17 (Docker) or point at any PostgreSQL 17 (UTF-8, UTC):
docker compose up -d db

# 3. Environment - copy .env.example to .env and set values:
#    DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev"
#    DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev"
#    TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
#    AUTH_SECRET="<random string, 16+ chars - sign-in cookies are HMAC-signed with this>"
#    Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Create the database
corepack pnpm db:migrate    # or: pnpm db:push for a quick sync

# 5. (Optional) Seed sample data - WIPES all tables
corepack pnpm db:seed

# 6. Run
corepack pnpm dev
```

The app refuses to boot without PostgreSQL `DATABASE_URL`/`DIRECT_URL`, and refuses to boot in
production without a real `AUTH_SECRET`. SQLite/file: URLs are refused everywhere.

## Seeded test accounts

`db:seed` clears every table and creates (dev only - it refuses to run with
`NODE_ENV=production` unless `SEED_FORCE=1`):

| Email | Password | Role |
|---|---|---|
| `admin@gmail.com` | `adminama123` | Admin |
| `organizer@example.com` | `password` | Organizer (active) |

Plus sample students, events, and attendance records.

## Key concepts

- **Roles**: organizers sign up → admin approves → they can create events.
  Admins review events and organizer accounts.
- **Event lifecycle**: `DRAFT → PENDING → APPROVED / REJECTED`. Editing a
  rejected event returns it to draft for resubmission. Only approved events
  accept attendance.
- **Group vocabulary**: departments, programs, strands, and houses are
  defined once in `globals/constants/groups.ts` - forms, event scoping,
  and the seed all derive from it. Section names live on student rows.
- **Scan rules**: one scan each for time-in and time-out (first wins);
  time-out can be recorded without time-in, leaving time-in empty. Events
  toggle between time-in and time-out recording modes.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev / production build / serve |
| `pnpm db:migrate` | Apply migrations (dev) |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:seed` | Reset and seed the database (destructive) |
| `pnpm db:studio` | Browse the database |
| `pnpm account:recover -- --email <email>` | Local no-admin password recovery (interactive, host only) |
| `pnpm test:account-recovery` | Credential-version unit tests + disposable HTTP/concurrency fixture |

## Deployment notes

- Set PostgreSQL `DATABASE_URL` (runtime/pooled role) + `DIRECT_URL` (migration/direct role) and a strong `AUTH_SECRET`; run `prisma migrate deploy` (never `migrate dev`/`db push`/`migrate reset` against staging/production). Remote runtime and migration connections require TLS and verify the server certificate and hostname.
- If the provider's root CA is absent from the machine's trust store, set `DATABASE_SSL_CA_BASE64` to the base64 encoding of the complete PEM certificate file, including its BEGIN/END lines. Wrapped base64 with CR/LF is accepted; one line is easier to paste into Vercel secrets. Redeploy after setting it. Runtime and seed pools apply the CA directly while preserving client certificates and direct TLS negotiation. Prisma Migrate writes a private temporary CA file and uses the pinned engine's `sslmode=require&sslaccept=strict&sslcert=<path>` settings.
- SSL parameter meanings differ: `pg` uses `sslrootcert` for the server CA and `sslcert`/`sslkey` for PEM client credentials; Prisma Migrate uses `sslcert` for the server CA and `sslidentity`/`sslpassword` for a PKCS12 client identity. The shared helper prepares each driver's settings separately; do not pass a generated migration URL to a `pg` pool.
- Run `pnpm test:db-config` for configuration checks, or `pnpm test:db-tls` for real TLS and mTLS connections through `pg` and the installed Prisma engine. The latter requires Docker and OpenSSL, creates its own PostgreSQL 17 container and certificates, applies migrations there, and deletes the container afterward.
- PostgreSQL is the single source of truth - verify `pg_dump`/`pg_restore` into a separate rehearsal database before cutover. The old SQLite history is archived under `prisma/migrations-sqlite-archive/` (forensic only, never replayed).
- Data initialization is one explicit mode: FRESH_START (empty target + approved roster import) or PRESERVE_SOURCE (frozen source, validated transfer, reconciled counts/hashes). Never delete the source artifact by assumption; never migrate demo/faker data or known passwords.
- Rate limiting is in-memory (single instance); use a shared store if you
  ever scale horizontally.
- Password recovery is admin-assisted: Settings → Users → Reset password
  (admin reauth + reviewed revision, one-time temporary password, forced
  replacement, old sessions revoked). No email or public reset endpoint.
- Deploying this revokes every existing session cookie once (new credential
  version field): everyone signs in again. Deploy outside attendance capture.
- Restoring a database backup restores old credentials/versions too: rotate
  `AUTH_SECRET` and force sign-in before reopening service. Rolling back to a
  build that ignores credential versions would revive old cookies — rotate the
  secret before running such an older build.

## Library Attendance (compliance MVP)

Apply the additive migration with `pnpm db:deploy`, then `pnpm db:generate` and rebuild the application. No library seed or scheduler is required. Active organizers (librarians) and admins open **Library Attendance** in the sidebar, or follow the Library Attendance link on the mobile Attendance screen.

- Open Camera and scan an existing student QR, or use **Manual Search → Record scan**. Scans start or end a visit session, allow repeat visits, and use the server's Asia/Manila date. The same visitor has a **10-second cooldown across devices**. Acknowledgement enables the next scan. If the connection fails, refresh and check saved history before scanning intentionally again; never blindly retry an uncertain toggle.
- Active organizers (librarians) and admins can **Register Employee** with a unique **11-character ID**, first/last name and optional middle name, then view/print the existing QR card. For an existing directory identity, use **Manual Search → Classify as Employee** and confirm. Colliding IDs are never overwritten. Membership in the reserved `employees` group (`Employees`, category `SECTION`) determines employee classification and excludes the identity from ordinary event audiences. The migration provisions the group; registration also provisions it idempotently. Ordinary student forms/imports cannot assign or strip this reserved membership, and group maintenance cannot delete it.
- Use **Add Student** on the Library page to open the existing student registration form. Enter the real academic details and existing groups, save, then view/print the QR card. Library registration only creates new identities: an existing student or employee ID is rejected without changing that person. Use Manual Search for existing visitors.
- **Daily**, **Weekly** (Monday–Sunday) and **Monthly** history filter by entry date. Filter Students/Employees and search name/ID; CSV exports all matching rows in Manila time, including correction metadata. Visit type is snapshotted on entry: changing group membership affects subsequent visits only.
- Closing time is **5:00 PM Asia/Manila every day, including weekends**. Before then, today's open visits count as Currently Inside. At/after closing, they require review; prior-day visits never count as inside. Refresh updates the displayed counts. There is **no automatic closure**. **Close Forgotten Visits → Confirm Close** sets eligible open visits to 5 PM on each entry date and records the librarian and correction time. Already completed visits are preserved. Entries after 5 PM are excluded; use **Review visit end** to enter a valid confirmed timestamp. Reports label these exits **Closed by librarian**, rather than suggesting an observed QR departure.

For an October 14 showcase: migrate, log in, start a test student visit, acknowledge, wait 10 seconds and end the visit, then wait and start another visit. Register a test employee and use its printed QR. Show weekly/monthly filters and the confirmed forgotten-visit workflow. Camera access requires HTTPS or localhost and browser permission; Manual Search works without a camera.

Optional historical examples, **local development only** (requires one existing test student):

```bash
NODE_ENV=development pnpm library:demo --confirm-demo
```

This non-destructive, repeatable script adds visits across previous days, weeks and months, including employees, repeated sessions, missing exits, after-hours entries and librarian closures. It never runs the full destructive seed. Every generated visit has `isDemo=true`: ordinary reports/counts exclude them. Select **View simulated demonstration data only** to inspect/export or correct these examples; the UI labels them SIMULATED and disables live scanning. Use a development database, not the school database.

Verification: `pnpm test:library`, `pnpm test:library-api` (after build), `pnpm test:operator`, `pnpm lint`, `pnpm build`. Database tests require `TEST_DATABASE_URL` pointing to a PostgreSQL maintenance database and create/drop only disposable `test_*` databases. `LIBRARY_BROWSER_TEST=1 pnpm test:library-api` also checks desktop/mobile flows with the existing Python Playwright setup.

Intentional debt: employees share `Student`, with `COLLEGE`/`YEAR_1` placeholders isolated to registration and never shown on library screens; closing time and timezone are fixed; correction actor IDs are scalar snapshots; reports use current names and entry-time visitor-type snapshots. There are no employee CRUD pages, queues or generalized attendance infrastructure. Existing event `Record` data and schema are unchanged.

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

- Set PostgreSQL `DATABASE_URL` (runtime/pooled role) + `DIRECT_URL` (migration/direct role) and a strong `AUTH_SECRET`; run `prisma migrate deploy` (never `migrate dev`/`db push`/`migrate reset` against staging/production).
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

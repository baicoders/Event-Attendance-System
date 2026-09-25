# Event Attendance System

Web app for managing school events and tracking student attendance at ACLC
College of Ormoc City. Organizers create events (scoped to departments,
houses, strands, programs, sections, or year levels), submit them for admin
approval, and record attendance by QR scan or manual entry with time-in /
time-out tracking.

## Stack

- Next.js (App Router) + TypeScript
- Prisma ORM over SQLite (`better-sqlite3` driver adapter)
- TanStack Query + Table, shadcn/ui, FullCalendar

## Setup

```bash
# 1. Install dependencies (pnpm via corepack)
corepack pnpm install

# 2. Environment - create .env in the project root:
#    DATABASE_URL="file:./dev.db"
#    AUTH_SECRET="<random string, 16+ chars - sign-in cookies are HMAC-signed with this>"
#    Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Create the database
corepack pnpm db:migrate    # or: pnpm db:push for a quick sync

# 4. (Optional) Seed sample data - WIPES all tables
corepack pnpm db:seed

# 5. Run
corepack pnpm dev
```

The app refuses to boot without `DATABASE_URL`, and refuses to boot in
production without a real `AUTH_SECRET`.

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

## Deployment notes

- Set `DATABASE_URL` and a strong `AUTH_SECRET`; run `prisma migrate deploy`.
- The SQLite file is the single source of truth - back it up.
- Rate limiting is in-memory (single instance); use a shared store if you
  ever scale horizontally.
- No password-reset flow exists yet; an admin must edit the database to
  recover an account.

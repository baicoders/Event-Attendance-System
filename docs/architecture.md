# Architecture

Current Classroom implementation, November 2026. Code, migrations and tests take precedence. [Historical architecture](archive/pre-classroom/architecture.md) is retained for background only.

## Platform and boundaries

One Next.js App Router application serves deployed HTTPS clients. Teachers use the public site on their phones; they never operate a server. The actual hosting, pooling, backup worker and database topology must be inspected before release. Local test PostgreSQL is not evidence of hosted capacity.

Events and Class share User credentials and the central Student directory. Events retains its calendar, organizer approval, event approval, arrival/departure and existing report workflows. Class has separate membership, navigation, teacher onboarding, Class offerings, persistent roster configuration, attendance sessions and historical reports. Class never writes Event/Record to represent lessons.

Pinned application versions: Next.js 15.5.20, React 19.1.0, Prisma 7.10.0 with PrismaPg/pg 8.23, TypeScript 5.9, Query 5.87, Table 8.21, Zod 4.1 and Tailwind 4.1. See pnpm-lock.yaml for exact transitive versions. Node 22 was used for verification. PostgreSQL is required; there is no SQLite or in-memory fallback.

## Source ownership

- `app/(main)` is the Events shell; `app/(classroom)` is the focused Class shell; `app/(auth)` owns entry, `(classroom-access)` applications, `(classroom-admin)` administrative Class screens and `(account)` identity settings; `app/(print)` owns server-authenticated bare print pages.
- `app/api/classroom` exposes Class services; `app/api/admin/classroom` exposes administration. Existing Events routes retain their URLs.
- `features/classroom/{server,schemas,types,utils,hooks,components}` owns Class contracts and UI.
- `features/students/server` and `globals/utils/studentIdentity.ts` own shared student identity/history. There are no per-teacher Student duplicates.
- `globals/utils/auth.ts`, `features/auth/server` and `middleware.ts` enforce fresh identity/capabilities, origin protection and private caching. Middleware is not a substitute for per-resource authorization.
- `globals/libs/dbConfig.ts` owns PostgreSQL TLS/startup UTC configuration; runtime Prisma uses the shared pool. Direct maintenance credentials are separate from runtime credentials.

## Request and transaction flow

Client forms use Zod, Query and the shared API envelope. Every server path validates independently. Workspace preferences never grant access. `requireAuth` intentionally means Events access for legacy callers; applicant/account paths use identity-only guards; Class and admin routes use explicit guards.

Class commands use UUID command IDs, normalized request hashes and durable receipts. Reads and writes lock/recheck the current User, credential version and Class entitlement. Owned resources are checked again inside the transaction; unrelated teachers receive no class data. Revocation, ownership transfer and password reset participate in the same locking protocol.

Lock ordering is User → Class membership → command receipt → shared roster lock when needed → catalog/Class → Session → session/student pair. Resource sets are sorted. Session row SHARE locks let independent marks overlap; finalization takes UPDATE. One confirmed rollback may be retried; uncertain outcomes are reconciled by the original receipt/key. See [attendance](implementation/classroom-attendance.md) and [sessions](implementation/classroom-sessions.md).

API envelopes are `{success:true,data}` or `{success:false,message,code?,details?}`. The client distinguishes a valid error from an unacknowledged/malformed response. No attendance success appears before server acknowledgment. Shared PostgreSQL request counters protect multiple processes; receipt reads remain available for recovery.

## Identity and history

Student.id is stable internal identity. Printed raw internal IDs, USNs and LRNs resolve through the permanent StudentQrCode reservation registry, including safe aliases. Retired, conflicting and ambiguous values fail closed. No old code may later identify another student. Manual actions carry canonical internal IDs rather than passing those through QR lookup.

All student writers, including imports/raw joins, follow the roster lock, revision, trigger capture and immutable profile-history protocol. Verification binds both revision and content hash. Corrected data invalidates older verification. See [identity protocol](implementation/classroom-student-identity.md).

Class roster = union(selected SECTION members, INCLUDE exceptions) minus EXCLUDE exceptions, deduplicated by Student.id. Exceptions persist per class and do not change official sections. Start atomically freezes eligible students, labels, provenance, class labels and attendance policy. Later directory/roster edits affect future meetings. Explicit historical membership changes and attendance corrections require audited reasons.

## Capture, reports and clients

Shared QrCamera owns browser media/cleanup and serial decoding through pinned barcode-detector 3.0.6 with locally shipped WASM. Events and Class supply separate business handlers. HTTPS and explicit camera permission are required. Camera failure has a manual fallback.

The Class mobile roster uses server search/filter/pages of 100 students and 48 px actions. Search/filter/page/mode preferences survive reload through an allowlisted URL. Unacknowledged commands retain their original UUID/payload in tab sessionStorage; explicit retry reconciles receipts first. This is not offline queuing. Identity/workspace changes stop capture and clear private cache/descriptors.

Class reports use FINALIZED session snapshots and one projector for JSON/CSV/print. Present+Late divided by Present+Late+Absent; Excused excluded; zero denominator=N/A. Report versions reject stale export/print preparations. Events reports retain their existing current-eligibility convention; this change does not retrofit Events snapshots.

## Operations and limits

Class business access is feature-flagged; administrator application/monitoring access remains available during disable. Runtime credentials must be non-owner/non-superuser with append-only audit grants. Migration/backup maintenance credentials are operational secrets, never browser inputs. Immutable triggers/grants do not protect against a privileged DBA.

Backups use the existing verified PostgreSQL archive workflow, not database files in the repository. [Release runbook](deployment/classroom.md) covers additive migrations, invalid concurrent-index recovery, registry inventory, compatible application rollback and restore. [UTC findings](implementation/classroom-time.md) require a hosted historical timestamp audit before rollout; never apply a blanket eight-hour correction.

The local Node/tsx, real PostgreSQL concurrency, production HTTP, browser, print and HTTPS decoder suites are documented in [Class testing](testing/classroom.md). Physical iOS/Android and unfamiliar-teacher trials remain separate release evidence.

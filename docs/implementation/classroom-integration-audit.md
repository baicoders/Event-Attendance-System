# Classroom Integration: Legacy Capability Inventory

Approved plan: [Classroom attendance](../superpowers/plans/2026-11-02-classroom-attendance-teacher-module.md).

Baseline main and remote rechecked at 3135d3204c71c960fd6dfb2bef765a8a87a1f171 on 2026-11-02. Implementation branch: feat/classroom-teacher-module. No production access or rollout has occurred.

`requireAuth` remains Events-only. New teacher-only identities never receive these capabilities implicitly. Bulk central membership changes, imports and destructive student operations become administrator-only. Individual Events student creation/edit remains available to Events organizers with new integrity guards.

| Existing endpoint | Required capability |
|---|---|
| `GET /api/admin/backups/jobs/[jobId]` | Administrator |
| `GET /api/admin/backups/jobs` | Administrator |
| `POST /api/admin/backups` | Administrator |
| `GET /api/admin/backups/status` | Administrator |
| `PATCH /api/admin/organizers/[organizerId]` | Administrator |
| `GET /api/admin/organizers` | Administrator |
| `GET /api/admin/system` | Administrator |
| `PATCH /api/admin/users/[userId]/password` | Administrator |
| `GET /api/admin/users` | Administrator |
| `POST /api/auth/change-password` | Identity only |
| `POST /api/auth/login` | Public credential action |
| `POST /api/auth/logout` | Identity only |
| `GET /api/auth/logout` | Identity only |
| `GET /api/auth/session` | Identity only |
| `POST /api/auth/signup` | Public credential action |
| `POST /api/bulk-import/students` | Administrator |
| `PATCH /api/custom-groups/[groupId]/members/[studentId]` | Events access |
| `DELETE /api/custom-groups/[groupId]/members/[studentId]` | Events access |
| `POST /api/custom-groups/[groupId]/members` | Events access |
| `GET /api/custom-groups/[groupId]` | Events access |
| `PATCH /api/custom-groups/[groupId]` | Events access |
| `GET /api/custom-groups` | Events access |
| `POST /api/custom-groups` | Events access |
| `GET /api/custom-groups/students` | Events access |
| `POST /api/events/[eventId]/attendance-corrections` | Events access |
| `GET /api/events/[eventId]/attendance-history` | Events access |
| `GET /api/events/[eventId]/attendance-review` | Events access |
| `GET /api/events/[eventId]/progress` | Events access |
| `GET /api/events/[eventId]/records` | Events access |
| `GET /api/events/[eventId]` | Events access |
| `PATCH /api/events/[eventId]` | Events access |
| `DELETE /api/events/[eventId]` | Events access |
| `GET /api/events/[eventId]/stats` | Events access |
| `POST /api/events/[eventId]/timeout` | Events access |
| `POST /api/events/audience-preview` | Events access |
| `GET /api/events` | Events access |
| `POST /api/events` | Events access |
| `DELETE /api/events` | Events access |
| `PATCH /api/groups/[groupId]` | Administrator |
| `DELETE /api/groups/[groupId]` | Administrator |
| `GET /api/groups/byCategory/[category]` | Events access |
| `GET /api/groups/manage` | Events access |
| `GET /api/groups` | Events access |
| `POST /api/groups` | Administrator |
| `DELETE /api/records/[recordId]` | Events access |
| `PATCH /api/records/[recordId]` | Events access |
| `POST /api/records` | Events access |
| `GET /api/records` | Events access |
| `GET /api/reports/events/[eventId]/export` | Events access |
| `GET /api/reports/events/[eventId]` | Events access |
| `GET /api/reports/overview` | Events access |
| `GET /api/stats/student-counts` | Events access |
| `GET /api/students/[id]/attendance-history` | Events access |
| `GET /api/students/[id]` | Events access |
| `PATCH /api/students/[id]` | Events access |
| `DELETE /api/students/[id]` | Administrator (restricted deletion) |
| `POST /api/students/bulk/commit` | Administrator |
| `POST /api/students/bulk/preview` | Administrator |
| `POST /api/students/export-selected` | Events access (never teacher directory export) |
| `GET /api/students/imports/[id]` | Administrator |
| `GET /api/students/imports/commands/[commandId]` | Administrator |
| `POST /api/students/imports/commit` | Administrator |
| `POST /api/students/imports/preview` | Administrator |
| `GET /api/students/imports` | Administrator |
| `POST /api/students` | Events access |
| `GET /api/students` | Events access |

Server pages/loaders: `(print)/reports/events/[id]/print/page.tsx`, `eventReport.ts`, `studentHistory.ts`, Events attendance/correction/review/progress loaders all require Events capability in addition to their existing visibility rules. `(main)` is the Events shell; Class has a separate server-guarded shell. Identity-only account/password/application pages must be outside both business shells.

Central writers requiring the roster/identity/history protocol: `studentCreate.ts`, `studentEdit.ts`, student DELETE, bulk membership commit, Group reassignment/deletion, custom membership mutation, `features/students/import/{server,writeBatches}.ts`, `prisma/seed.ts`, `scripts/uswag/{setup,reset}.ts`, and any fixture/recovery/import maintenance tools. Test fixtures may write directly only to disposable databases; operator scripts must not bypass registry authority after activation. Raw SQL and implicit join-table writes need the same guards as Prisma scalar edits.

Deployment evidence: source contains PrismaPg, DIRECT_URL migration selection, verified remote TLS, backup spool tooling and deployed-web assets. Actual hosted PostgreSQL version, number of app instances, proxy trust, persistent backup job/storage and staging device access cannot be inferred from source. These remain production-release gates, not prerequisites for isolated implementation. Local verification uses an isolated PostgreSQL 14.24 cluster on loopback port 55491; no school data is loaded.

Documentation reconciliation: current schema/migrations supersede old SQLite/LAN assumptions; event audit and shared report loading already exist. Classroom preserves Events' existing current-audience reporting semantics while using historical session eligibility for Class. Update architecture/domain/conventions alongside each implemented milestone; teacher instructions exclusively describe the deployed HTTPS website.

## Task 2 compatibility changes

- Central student DELETE and bulk section/house replacement require administrator access. Events organizers retain individual create/edit and exports; the Events list hides destructive/bulk controls from organizers.
- Cookie-authenticated mutations require a matching configured Origin, same-origin Fetch Metadata, or a CSRF double-submit token. `GET /api/auth/csrf` issues the fallback token. Node test clients explicitly model browser Origin; browser camera/form users need no extra step.
- Login/signup/password/admin-reset limits share PostgreSQL buckets across instances. Proxy client headers are ignored unless `TRUST_PROXY_HEADERS=true` is explicitly configured behind a sanitizing trusted proxy. Set `APP_ORIGINS` to the public HTTPS origin(s).
- User accountState and Events role are rechecked in existing guarded attendance, imports, shared directory and administrative mutations. New commands always reauthorize before replay.

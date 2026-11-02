# Shared student identity and correction protocol

M2 is additive, runs atomically in an explicit PostgreSQL transaction, and must be reviewed before a hosted migration. It does not change Student primary keys, Events, Record or AttendanceChange results. Current students receive a labeled version-zero profile baseline and no inferred verification. The union of exact current ID/USN/LRN strings is reserved; cross-person collisions become QUARANTINED with candidate evidence. Existing import receipt identifiers are inventoried too: historical-only values and disagreements with current owners are quarantined, never silently promoted to an alias. Never guess an owner or release a reservation.

`resolveStudentQrCode` is authoritative for raw camera/typed codes. Blocked values never fall through to another namespace. `findStudentByCanonicalId` is for an already-selected entity, including manual attendance. Retiring a legacy numeric ID that was also an old USN blocks that printed QR, while keeping every stable FK and canonical manual action usable.

Individual identifier replacement requires KEEP_ALIAS_CONFIRMED (printed cards were checked to belong to the same person) or REPRINT_REQUIRED. A value still used by a current USN/LRN cannot be retired. Permanent aliases remain same-owner; retired/quarantined values cannot be resurrected or assigned to anyone else. Unconfirmed raw replacements default to retirement; keeping old cards requires explicit transaction context as well as the individual editor choice. Import review blocks historical/blocked values and binds current reservations in its preview fingerprint. Existing immutable import command receipts still replay their original results.

## Writer requirements

1. Lock fresh actor User/membership before command/roster locks. Central identity/group writers take roster EXCLUSIVE. Student/registry locks come later; registry values are reserved in sorted order.
2. Set transaction-local `school.student_write` through `setStudentWriteContext`, identifying actor, source, reason and optional command UUID. Existing Events guards and reviewed import/bulk/maintenance entry points set attribution. Direct test SQL is labeled SYSTEM; production maintenance must supply context.
3. Make all scalar and membership writes in the same transaction. M2 triggers reserve codes and capture the first original profile across scalar updates, raw import SQL, implicit Group joins, group deletion and academic slug/category changes.
4. Call `flushStudentProfileChanges` once, after all student changes and before constructing a versioned DTO or durable receipt. Deferred capture at COMMIT is also a safety net for raw writers. A changed student receives exactly one revision and immutable complete before/after snapshots per transaction. No-op changes do not advance the revision. Any later write to that same profile after explicit flush is rejected; finish all changes first.
5. Audit insertion failure rolls back profile, registry and command changes. Profile history and verification assertions cannot be updated or deleted. The staging table empties at commit.

House/custom memberships and cosmetic Group display labels do not affect classroom verification content. The verification hash covers identity/academic scalar fields plus official academic IDs/categories/slugs; assertions match both current profileRevision and hash. A substantive academic change advances the revision, even if an implicit join operation leaves Student.updatedAt unchanged.

Approved teachers can search shared student profiles, correct allowed existing fields with reason/expectedVersion, and verify them. They cannot set stable IDs, houses, custom memberships, privileges, bulk data or deletion. Classroom directory/history DTOs exclude Events attendance, house/custom membership and account credentials. The Events individual editor also exposes the explicit QR disposition choice.

## Operations and activation

`pnpm exec tsx scripts/audit-qr-reservations.ts` is read-only. `--report /private/new-file.json` writes private identifier evidence with mode0600 and refuses to overwrite a file. The default console output contains counts and a fingerprint. Inventory collisions and actual printed-card payloads before enabling corrections/scanning; existing pre-registry changes cannot be reconstructed safely from current rows. M2 inventories existing import receipts and quarantines uncertain historical values. Investigate other school records separately; do not infer that an uncertain historical code belongs to today's claimant.

`pnpm exec tsx scripts/backfill-qr-reservations.ts` also defaults to read-only. Apply requires `--apply --expected-hash <reviewed fingerprint> --backup-confirmed`, rechecks the entire inventory under roster EXCLUSIVE, and only fills missing claims. It never adjudicates or reassigns existing reservations. This command is an operator migration tool, never a teacher workflow.

The destructive demo seed refuses a database with permanent student identity/history. Recreate only a deliberately disposable database for a fresh demo. Baseline/history-backed students cannot be hard-deleted; admin deletion returns a clear historical-data restriction. `archivedAt` is available for a future separately authorized administrative retirement flow; teachers cannot set it. Reservation tombstones survive deletion of an otherwise unused transient identity.

Deploy the compatible application and M2 together during the reviewed writer-maintenance window. Do not roll back to a writer that ignores registry authority or history. Keep Class disabled/pilot-scoped until the complete module and production release gates pass. No hosted migration or deployment is performed by the implementation tests.


## Classroom HTTP contract

- `GET /api/classroom/students?q=&page=1&pageSize=100`: shared minimal directory, capped at100 per page.
- `GET/PATCH /api/classroom/students/[studentId]`: current profile or durable correction command. PATCH requires commandId, expectedVersion, student allowlist, reason, and an explicit disposition when replacing identifiers.
- `POST /api/classroom/students/[studentId]/verifications`: immutable version/hash-bound assertion; required identity fields and unambiguous academic assignments are checked before VERIFIED. NEEDS_CORRECTION remains available for incomplete records.
- `GET /api/classroom/students/[studentId]/changes?limit=100&cursor=<audit-id>`: stable descending profile-history cursor; new corrections never shift an older page. IDs remain decimal strings and cursors are range-checked PostgreSQL bigint values.
- `GET /api/classroom/student-options`: existing permitted academic groups only.

Duplicate official academic assignments have an explicit individual repair flow. The teacher sees all competing labels and chooses one existing group or deliberately clears it, supplies a reason, and saves with the original edit version. A name-only edit cannot silently normalize duplicate sections. House/custom memberships are preserved and remain outside teacher editing powers. Full verification activity oversight is completed in the administrative monitoring milestone.

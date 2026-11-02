# Domain model

Current schema: `prisma/schema.prisma`; database-only invariants also live in migrations. [Earlier model notes](archive/pre-classroom/domain-model.md) are historical, not current contracts.

## Identity and authorization

User is an adult account. Student is a central directory identity and never a teacher account. User.role preserves Events ORGANIZER/ADMIN permissions and adds MEMBER for accounts without Events grants. Existing Events status and global accountState/credentialVersion remain separate from ClassroomMembership.status: PENDING, APPROVED, REJECTED, SUSPENDED or REVOKED. A dual user keeps Events when Class access is suspended. Global disable denies both. TeacherOnboarding stores resumable progress for the approved User.

Only teacher applications require administrative approval. Approved teachers own their classes, select sections, configure exceptions, correct permitted individual student fields and operate attendance independently. Administrators assist with an explicit reason and may transfer ownership to an approved teacher. Shared directory visibility grants no unrelated attendance history.

## Shared directory

Student has generated stable internal id, nullable USN/LRN, required first/last names, nullable school/year fields and Group memberships. USN/LRN are identifiers, not primary keys. Group supplies official SECTION and other school categories; custom memberships remain separate. Classroom teachers may change only the documented individual academic/profile allowlist. Bulk import/delete/merge and destructive maintenance are administrator-only.

StudentQrCode permanently reserves each exact raw code, its original owner/provenance and resolution state. Active aliases resolve only to that same student; retired/quarantined/tombstoned values never become another student's identifiers. Deletion must not free a code. StudentProfileChange captures immutable before/after, actor, reason and time; StudentProfilePending stages trigger-based transaction capture. StudentVerification asserts a revision and content hash; its historical assertion remains visible but becomes stale after a relevant change. StudentImportBatch is an immutable command/result receipt for reviewed admin imports.

## Events domain (preserved)

Event carries schedule, category/group audience, owner and DRAFT→PENDING→APPROVED/REJECTED workflow. Approval allows existing active Events operators to record attendance under existing visibility rules. Event.isTimeout is the event recording mode. Record holds timein/timeout and unique(eventId,studentId); AttendanceChange captures reasoned corrections. Events eligibility/reports are based on current directory membership, unlike Class snapshots. No Class session is represented by Event or Record.

## Academic configuration

AcademicTerm has name/date range and archive metadata. Subject is a reusable catalog item. ClassOffering relates one term, one subject and one primary User teacher, with display label, settings, optional schedule and independent config/roster revisions. Multiple offerings of a subject/term and multiple classes per section are valid. ClassSection joins any number of SECTION groups; ClassRosterException has unique(classId,studentId), INCLUDE/EXCLUDE kind and audited reason. Exclusions win over both section membership and additions. No class action edits an irregular student's official section.

Primary-teacher ownership is the v1 authorization rule. A later ClassTeacher membership can add co-teachers deliberately; no UI or server permission assumes that all teachers may see each other's classes.

## Attendance

ClassroomSession belongs to ClassOffering, states ACTIVE/FINALIZED/CANCELED, with scheduled UTC instant, Asia/Manila policy, grace/threshold snapshot, original class/teacher labels and revisions. Only one ACTIVE session/class is permitted by a partial unique index; there is no unique class/date constraint, so separate same-day meetings work. UUID start receipts prevent retries creating another meeting.

SessionRosterMember has composite(sessionId,studentId), frozen profile/identifiers/sections/provenance and included state. Original snapshot is retained even when an explicit audited adjustment changes eligibility. ClassroomAttendance references the same composite membership key; one row per pair, revisioned status UNMARKED/PRESENT/LATE/ABSENT/EXCUSED, method, first scan time and optional excuse note. Start creates an UNMARKED result row for every snapshot member; deferred constraints reject missing member/result pairs. Finalization atomically changes remaining included/unmarked rows to Absent; cancellation creates no absences and canceled meetings are excluded from reports. Late is attended and reported distinctly. At the exact late threshold a scan is Present; strictly after is Late. Manual changes use expected revision; replacing a marked result or correcting a finalized session requires reason.

ClassroomAttendanceChange holds immutable before/after, actor, reason, command and time. ClassroomAudit captures application/class/roster/session/student-related administrative activity. ClassroomCommandReceipt binds actor+UUID+request hash+safe result, in the same transaction as its writes/audits. Restrictive foreign keys, composite uniqueness, append-only triggers and explicit transaction locks protect integrity; administrator assistance does not bypass them.

## Reports and monitoring

Only finalized included session members enter Class aggregates. Students joining midway have no earlier denominator rows. Rate=(Present+Late)/(Present+Late+Absent); Excused separate, zero=N/A. Student aggregation uses stable IDs and historical labels. JSON, full CSV and print share selection/version/projector; stale preparations return REPORT_CHANGED. Notes are omitted from general reports and redacted from admin timeline details. Ownership checks intersect student-term reporting with the caller's own classes.

RequestRateLimit is the shared hashed rate counter. Audit tables have time/entity/actor indexes for cursor-based monitoring. M5 index migrations are concurrent and individually recoverable; see [release runbook](deployment/classroom.md).

Detailed schemas/contracts: [classes](implementation/classroom-classes.md), [sessions](implementation/classroom-sessions.md), [attendance](implementation/classroom-attendance.md), [reports](implementation/classroom-reporting.md), [student identity](implementation/classroom-student-identity.md).

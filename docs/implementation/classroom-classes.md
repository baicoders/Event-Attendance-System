# Classroom classes, rosters and setup

Classroom offerings are independent of Events. Approved teachers create and maintain their own offerings; active administrators assist through the same services, with an explicit reason when acting for another teacher. Only the teacher application needs approval.

## Catalog and offerings

- Academic terms use school dates and Asia/Manila. Teachers can add a missing term or subject immediately. Normalized duplicate keys return409; administrators correct/archive shared catalog entries with expected revisions and reasons.
- A class has a term, subject and primary teacher. Several offerings of the same subject/term are legitimate. Display names are not unique. Ownership can later move by an audited administrator command; the former owner immediately loses class and receipt access.
- Settings and roster configuration have independent `configRevision` and `rosterRevision` values. Archive preserves history. No class/catalog hard-delete API exists.
- `/api/classroom/terms` and `/subjects`: approved GET/POST; their `[id]` PATCH methods are administrator-only, including before body parsing. `/sections` lists official SECTION groups excluding employees.
- `/api/classroom/classes`: scoped GET/POST; `[classId]` GET/PATCH; `[classId]/roster` GET/PUT. `/api/admin/classroom/classes/[classId]/owner` POST transfers ownership.

## Persistent roster

`(selected official sections ∪ individual INCLUDE exceptions) − individual EXCLUDE exceptions`, deduplicated by immutable Student.id. ClassSection references protect selected groups from deletion/category changes. Irregular additions never change official student sections. Archived/employee identities are not eligible.

`composeClassRoster(tx,classId)` requires the central roster SHARE lock and authorized Class row lock. `fingerprintClassRoster` hashes the full sorted membership, relevant profile revision/content, provenance and saved configuration before display filtering/pagination. Search and page100 responses therefore carry the same full fingerprint. Central student edits invalidate live roster queries; historical session snapshots are a separate domain.

Mutations use the fresh command actor guard and atomic receipt/audit protocol. Lock participating User/membership rows first, then command advisory lock; optional onboarding advisory lock; central roster SHARE; reference rows (AcademicTerm, Subject, then sorted Group IDs); Class row. Never acquire a preceding layer after a later one. Shared catalog mutations lock only their catalog row after actor/command locks. Central student/group writers take roster EXCLUSIVE and do not enter Class/onboarding locks.

## Resumable onboarding

`GET /api/classroom/onboarding` is read-only. `PUT` uses `commandId`, `expectedRevision`, action `step`, and bounded optional draft/review metadata. Drafts contain class setup fields only; the whole persisted JSON is limited to16KiB in UTF-8. Passwords, student records and attendance drafts are rejected. Tutorial state is SEEN or SKIPPED.

The server derives the next step from current prerequisites: Welcome, Class, Roster, Settings, Tutorial, Ready. An archived/transferred class reference becomes an empty selection, with no other teacher's class DTO. Completed teachers keep completion even if their original class becomes unavailable. Help never resets completion or creates attendance.

First-class POST may include `onboardingExpectedRevision`. The command locks that user's setup, validates its revision, creates the class and links setup to the class in one transaction. Another device with the old revision cannot create a duplicate; retrying the same UUID returns the original class after current ownership checks. Reload after an uncertain response discovers the committed class through progress GET.

Roster acknowledgement binds the full live fingerprint and roster revision; settings acknowledgement binds configRevision. A class with no eligible students can be saved, but cannot pass Ready. Finishing setup checks all current prerequisites and does not start a meeting. Progress has optimistic concurrency, immutable audit events and honest confirmation/retry behavior.

The camera/manual tutorial is a clearly labeled simulation. It requests camera permission only on a deliberate action, stops tracks on exit, and never invokes production attendance endpoints. Real session start/first-attendance guidance is completed with the attendance interface before release.

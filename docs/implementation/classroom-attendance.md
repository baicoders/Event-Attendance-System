# Classroom scan, manual attendance and enrollment commands

`recordClassroomScan`, `setClassroomAttendance` and `adjustSessionRoster` use fresh Class grants, current class ownership and atomic domain/audit/receipt transactions. Events attendance is independent. Input status/method/actor/policy cannot bypass server authority.

## Capture and marking

Scans accept existing exact Student ID/USN/LRN/confirmed aliases through the shared permanent QR registry. Unknown, retired, ambiguous and unavailable codes produce distinct errors, no result change and no committed command receipt. Raw codes are POST bodies, never scan URLs or limiter keys. Replaying a successful command does not resolve its old code again: it returns the original acknowledged result after current authorization, including after closure or identifier retirement.

A scan changes only UNMARKED. Present/Late returns ALREADY_RECORDED; Absent/Excused returns ALREADY_MARKED. All preserve status, timestamp, source and revision. Server time sampled after the required locks determines Present versus Late. Each actual result change records immutable before/after, actor, time, reason where applicable and the effective policy/lifecycle revision.

Manual requests use canonical session member IDs, an expected result revision and one of Present/Late/Absent/Excused. First manual marks need no correction reason. Every change to an already marked result or finalized meeting requires a reason. Excuse notes are optional, bounded and exclusive to Excused; changing away clears the note. Excluded members must first be explicitly re-included. Canceled meetings reject new marks; successful old receipts remain recoverable under current authority.

Administrative assistance records the real administrator. A reason is required when scanning/marking another teacher's class. There is no approval queue for ordinary teacher actions.

## Explicit enrollment choices

An ineligible scan returns409 STUDENT_NOT_IN_SESSION with only permitted identity, this class's existing exception, snapshot/roster revisions and allowed choices. It enrolls/marks nothing.

- SESSION changes only this meeting.
- CLASS_AND_SESSION changes one persistent class exception and this meeting.
- CLASS_ONLY changes future class configuration and never admits/marks this meeting.

All require a reason and current snapshot revision; permanent scope additionally requires rosterRevision. Permanent INCLUDE explicitly confirms replacement of an existing EXCLUDE (`confirmReplaceExclusion=true`). Official student sections never change. Initial snapshots are never overwritten, and removals retain prior results. New admissions freeze current permitted identity with `originalMember=false` and admission scope/actor/reason.

`recordScan=true` additionally requires the original `code`; resolve it again and require the selected stable Student.id. This protects the interval between dialog and save. A finalized inclusion needs explicit `finalStatus`, never automatic scanning; re-including an existing historical result also needs `expectedAttendanceRevision`. An already included finalized member uses the normal correction endpoint. Canceled sessions reject adjustments; future enrollment remains available from the class editor.

The session retains at most1,000 members, including exclusions. This bounds history reads without deleting old members. An existing frozen student may be excluded after current directory archive/classification changes; new inclusion remains active-student-only. Adjustment/result/class exception/audit/receipt commit together or all roll back.

## Locks and HTTP contracts

Actor User/membership → command → roster SHARE when resolving identity/admitting students → Class SHARE (UPDATE for permanent exceptions) → Session SHARE for ordinary marks or UPDATE for adjustments/lifecycle → namespaced result pair. Manual canonical marks skip the global roster lock. Never upgrade a lock mid-command. Ordinary marks do not update session counters/revisions; different students can proceed independently.

- POST `/api/classroom/sessions/[sessionId]/scans`: commandId, code, optional assistance reason.
- PUT `/attendance/[studentId]`: commandId, expectedRevision, status, optional excuseNote/reason.
- POST `/roster-adjustments`: explicit action/scope/revisions/reason, conditional code/outcome/confirmation fields above.
- GET `/api/classroom/commands/[commandId]`: actor-only attendance/lifecycle receipt under fresh resource authority. Other command families recover through their original operation. A404 means no visible committed receipt at observation time; a racing request may still commit, so retry the original UUID.

Path/body identity disagreement is400 ROUTE_ID_MISMATCH. QR NUL characters fail validation before SQL; leading zeros remain strings. All replies are private/no-store. Shared abuse limits are600 scans/minute/actor and240 directory searches/minute/actor, with429/Retry-After. Limiter metadata is separate from domain transactions and contains hashed actor keys only. Receipt lookup remains available when the scan bucket is full.

The phone client must preserve uncertain UUIDs, wait for server confirmation, reconcile after reload/closure, and treat a rate-limited retry as inconclusive about an earlier uncertain save. V1 has no offline attendance queue.

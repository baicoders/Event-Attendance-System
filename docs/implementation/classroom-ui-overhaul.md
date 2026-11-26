# Classroom UI overhaul inventory

Base: `ca0f0fc`, branch `feat/classroom-teacher-module`. Approved reference: `/tmp/classroom-ui-overhaul-design/.superpowers/brainstorm/313687-1794558366/content/classroom-patterns.html`.

| Routes / workflow | Shared compositions |
| --- | --- |
| `/class` | ClassroomPage hero, SectionPanel, ClassroomSelect, IdentityBlock, StatusBadge, LoadingState, Feedback |
| `/class/classes`, `/class/admin/classes` | ClassroomPage, FilterToolbar, ClassroomSelect, Card, ListPagination, EmptyState |
| `/class/attendance` | ClassroomPage, semantic Active/Start links, FilterToolbar, ClassroomSelect, Card, ListPagination |
| Teacher/admin class detail | ClassroomPage, SectionPanel, semantic Overview/Roster/Settings links, StatusBadge, Feedback, DropdownMenu |
| Teacher/admin create/settings | ClassroomPage, FormSection, SectionPanel, ClassroomSelect, Field groups, ActionFooter, Switch/Checkbox/Textarea |
| Teacher/admin roster | SectionPanel, FilterToolbar, IdentityBlock, ResponsiveDataList, ActionFooter, Feedback, Checkbox |
| `/class/admin/catalog` | ClassroomPage, SectionPanel, FilterToolbar, ClassroomSelect, Sheet, Switch/Checkbox |
| Class start routes | ClassroomPage, SectionPanel, LoadingState, Feedback, AttendanceActionSheet, ActionFooter |
| `/class/students` | ClassroomPage, FilterToolbar, ResponsiveDataList, IdentityBlock, StatusBadge, LoadingState, Feedback |
| Student detail/correction/verification | ClassroomPage, SectionPanel, IdentityBlock, StatusBadge, ActionFooter, Feedback, Sheet, technical disclosures |
| `/class/access` | SectionPanel, FormSection, ActionFooter, Feedback, status-specific next actions |
| Teacher administration list/detail | ClassroomPage, FilterToolbar, ResponsiveDataList, SectionPanel, IdentityBlock, StatusBadge, decision ActionFooter |
| `/class/admin/activity` | ClassroomPage, FilterToolbar, SectionPanel, IdentityBlock, ClassroomSelect, advanced disclosure, detail Sheet |
| `/class/settings` | ClassroomPage, SectionPanel, grouped semantic navigation rows |
| `/class/onboarding` | ClassroomPage, SectionPanel, step indicator, six focused steps, ActionFooter, shared forms, Feedback |
| Session ACTIVE/FINALIZED/CANCELED | Existing Focus/Roster/scanner layout; SectionPanel summary, StatusBadge, shared Sheet, DropdownMenu, Textarea |
| `/class/reports` and print | Existing approved summary/charts/table/print; ClassroomPage, SectionPanel metrics, IdentityBlock, LoadingState, Feedback. Export/version/privacy unchanged. |

## Read additions and invariants

`GET /api/classroom/overview?termId=…` reuses classroomRead authorization. It returns full-scope totals independently of five-active/six-class/five-recent preview limits. Teacher scope follows current ownership; administrators see administrative scope. Archived classes are excluded from current class totals/cards; archived historical meetings remain visible in historical totals. Meeting identities come from frozen snapshots. Today uses scheduled meeting time in Asia/Manila and distinct active/finalized session IDs.

Class-list `attendanceState=ACTIVE|READY` is applied before server pagination; READY also excludes archived classes. Meeting-history progress comes from batched included-member attendance counts. Existing write schemas, command receipts, recovery, report calculations and migrations are unchanged. Confirmed commands invalidate relevant Classroom reads.

## Verification record

Fresh evidence and remaining limitations are recorded in `docs/testing/classroom-ui-overhaul.md`. Execution scratch/logs live in `.superpowers/classroom-overhaul` and `/tmp/classroom-overhaul-*` and never contain copied demo credentials in documentation.

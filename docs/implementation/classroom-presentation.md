# Classroom presentation and account dialogs

This follow-up continues the existing Classroom feature worktree and preserves its continuous background. It changes presentation and client navigation only: no dependencies, migrations, server write contracts, or permission expansions.

Settings uses one 760px navigation panel. Account/password and Events access share a 576px shadcn Dialog with viewport margins, independently scrolling content, identity information, and a separated footer. Root `@modal` intercepted routes retain the workspace page; canonical account routes use the same dialog on a neutral background. Explicit root and catch-all slot pages clear unmatched navigation. Return destinations use the existing workspace preference and permission resolver, falling back to the other workspace when a destination would reopen the same access gate.

The account form retains its existing password/session recovery. Its submission state locks dialog dismissal. Events applications retain their command ID across retries. Restricted accounts retain sign-out and cannot dismiss the gate. Workspace navigation retains its originating pathname, and list/attendance URL synchronization ignores an account overlay. Student directory links flush pending search updates before navigation so a delayed history replacement cannot interrupt opening a profile.

Verification uses school-record language and remains optional for attendance. Optional new notes are disclosed; saved notes and checker/date remain visible. Change history is collapsed and fetched on demand, preserving authorized server cursor pagination. Changing the selected student resets disclosure/cursor state. System/baseline attribution is neutral. Readable comparisons are separate from advanced versions, source values, and scrubbed records.

Report selection starts with four native radio choices. The selected type controls student/date/meeting fields and required class selection. Class/student date limits are disclosed and restored from URLs. Selected student identities are resolved through the existing authorized read endpoint, with explicit loading, retry, unavailable, and change-selection states. The existing report filter payload, table-search scope, calculations, historical snapshots, exports, print, and version checks are retained. Current/remembered term defaults do not override a meeting deep link.

Lucide icons accompany meaningful actions, navigation, headings, sheets, onboarding, and decisions. Visible labels, action ordering, and 48px targets remain. `SectionPanel` accepts an optional heading icon; attendance decisions share a small status-icon composition.

Regression entry point: `USWAG_TEST_DIST_DIR=<isolated-build> node --import tsx scripts/test-classroom-presentation.mjs`. It creates a guarded disposable database and removes it after the browser run. Existing student/report browser suites use the revised labels and controls. Saved-demo walkthroughs remain read-only.

# Teacher onboarding and guide redesign execution ledger

Source: approved plan supplied in the implementation request, 2026-11-14.

Continue the existing `feat/classroom-teacher-module` worktree. Preserve its prior uncommitted changes, persisted step identifiers, schemas, command payloads, completion checks, and saved demo data. No dependencies or migrations.

Tasks: presentation/readiness and local practice; shared field groups and mounted save ownership; immersive journey; reusable help hub and contextual sheets; behavioral/browser regressions and production verification; read-only demo counts then refresh.

Pre-flight: journey consumes existing onboarding projection and command runner. Help/practice must never invoke writes. Creation uses existing atomic onboarding revision linkage. Settings and roster edits use their existing revision contracts, followed by a fresh progress read before acknowledgement.

Ruling: the approved sketch image is not present in this context; use the written visual specification and separate warm SVG illustrations with native controls. Visual fidelity is assessed against the supplied description.

Ruling: user supplied a fully approved plan, so implement directly without another design approval. Keep work local and uncommitted to preserve the existing feature worktree's review state.

Review fixes: blank grace stays invalid; acknowledgements bind to the visible class/configuration and rendered roster fingerprint. A saved roster edit is shown for review before acknowledging its checkpoint. Confirmed internal screen transitions bypass only their own synchronous navigation event, while pending browser traversal and external links remain blocked. Background read failures retain mounted drafts and require reconciliation before further commands.

Focused review regressions: four unit tests passed after two failed before implementation. Prior full runs before environment restart: Classroom unit 87/87, database 97/97, roster API passed; rerun final verification below.

Environment resume on 2026-11-22: original feature-owned PostgreSQL cluster was stopped. Restarted it with the existing data directory, port 55491 and loopback binding. Fresh saved demo counts remain 9 users, 290 students, 6 classes, 22 sessions. No data was reseeded or reset.

Final review: independent reviewer identified stale roster recovery after an explicit reload. Browser reproduced the stale displayed list after reload; recovery now invalidates the owned roster query and clears the review snapshot until refreshed. A further regression verifies that confirming roster edits cannot advance unseen configuration revisions, or vice versa. Each screen saves its own field group; Save and exit validates all pending edits.

Final touch/reason checks: measured native subject options were below 48px; shared Classroom select options now have a 48px minimum. Exception comparisons use the server's trimmed reason representation, so a valid padded reason cannot stay dirty after saving and prevent review. The unit regression failed on the prior whitespace-preserving comparison and now passes. Source is frozen pending final artifact verification.

Implementation complete. Final release onboarding/roster/report browser runs and production build passed; unit 91/91 and database 97/97. Original demo refreshed with all 29 table counts unchanged across restart. Read-only demo browser walkthrough passed; enclosing Node HTTP post-check needs fresh-connection handling. User requested further verification be deferred and an OpenCode handoff. Continue from `docs/implementation/teacher-onboarding-opencode-handoff.md`; keep this worktree and saved demo intact.

# Claude Code Skills

This document indexes every skill in `.claude/skills/` — why it exists, where it came
from, and why candidates that *aren't* installed were rejected. It's written for a
developer (or a future Claude session) asking "why the hell did we install this?" six
months from now.

Skills are project-scoped (`.claude/skills/`, committed to this repo) unless noted
otherwise — see [Scope rationale](#scope-rationale).

---

## Project-Specific Skills

Written for this repository specifically, encoding knowledge that generic training
data cannot provide: this app's architecture, domain rules, and conventions. Full
audit trail for the facts they encode: [`architecture.md`](./architecture.md),
[`domain-model.md`](./domain-model.md), [`conventions.md`](./conventions.md), and the
[`audit/`](./audit/) directory.

| Skill | Purpose | Use when |
|---|---|---|
| [`project-orientation`](../.claude/skills/project-orientation/SKILL.md) | Deployment model, stack, directory layout, entity model, event lifecycle | Start of any non-trivial task |
| [`auth-and-authorization`](../.claude/skills/auth-and-authorization/SKILL.md) | Session model, the four authorization primitives, known gaps (SEC-01/02/03) | Touching auth, permissions, or any route's access control |
| [`prisma-and-database`](../.claude/skills/prisma-and-database/SKILL.md) | Schema/migration workflow, compare-and-set concurrency pattern, transaction pitfalls, seed danger | Touching `schema.prisma`, migrations, seed, `$transaction`, or Prisma queries |
| [`api-route-patterns`](../.claude/skills/api-route-patterns/SKILL.md) | The `requireAuth → validate → authorize → prisma → respond` shape, `ok()`/`err()` envelope | Adding/editing an `app/api/**/route.ts` |
| [`data-fetching-and-state`](../.claude/skills/data-fetching-and-state/SKILL.md) | TanStack Query hook conventions, `queryKeys` factory, deliberate over-invalidation, live polling | Touching `globals/hooks`, `features/*/hooks`, or any data-fetching component |
| [`forms-tables-ui`](../.claude/skills/forms-tables-ui/SKILL.md) | react-hook-form+Zod pattern, the two table implementations, Sheet-vs-Drawer, mandatory confirm-before-destroy | Building/editing a form, table, modal, or destructive action |
| [`release-verification`](../.claude/skills/release-verification/SKILL.md) | No automated test suite exists; known P0/P1 findings; what "done" means here | Before claiming a fix/feature complete, or touching a release-blocker item |

These seven were chosen to cover the areas the task brief called out (architecture,
domain rules, auth, database, API, frontend/data-fetching, forms/UI,
testing/verification) while staying small — architecture and domain-model knowledge
were merged into one orientation skill rather than split, since they're both "read this
before anything else" material, and forms/tables/modals were merged into one UI skill
rather than split by widget type. Each skill is a dense digest with pointers into the
full docs, not a restatement of them — see each skill file for the reasoning behind
that choice.

---

## External Skills

Sourced from public repositories, vetted individually (not installed off a
"best skills" list). Every entry below was installed only after reading its actual
source files, not just its marketplace description.

| Skill | Source | Purpose | Decision | Scope | Reason |
|---|---|---|---|---|---|
| `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills) | Playwright-driven browser testing toolkit for local web apps | **INSTALL** | Project | Official Anthropic skill; fills a real, documented gap — this repo has zero automated tests (`release-verification` skill) |
| `reviewing-a11y` | [masuP9/a11y-specialist-skills](https://github.com/masuP9/a11y-specialist-skills) | WCAG 2.2/WAI-ARIA accessibility review for pages, code, and designs | **INSTALL** | Project | Narrow, actively maintained, MIT-licensed, directly React/JSX-applicable; fills a gap the project skills don't cover |
| `ux-heuristics` | [wondelai/skills](https://github.com/wondelai/skills) | Krug's laws + Nielsen's 10 heuristics usability review, severity-scored | **INSTALL** | Project | Directly matches the brief's UI/UX priority (operator usability, not aesthetics); complements `reviewing-a11y` without duplicating it |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) | Aesthetic/visual-identity design guidance ("take a real aesthetic risk," brand personality, hero sections) | REJECT | — | Optimizes for distinctive visual branding, not operator usability — the brief explicitly says visual polish is secondary for this app |
| `ux-review` | [NickCrew/Claude-Cortex](https://github.com/NickCrew/Claude-Cortex) | Multi-perspective UX review (Nielsen heuristics + accessibility + interaction design) | REJECT | — | Sourced from a 152-skill personal framework (agents, rules, hooks, output-styles) — installing from it risks pulling in an opinionated, cross-referenced system; its content also duplicates `ux-heuristics` + `reviewing-a11y`, which are better-sourced individually |
| `auditing-wcag`, `planning-wcag-audit`, `planning-a11y-improvement` | masuP9/a11y-specialist-skills (siblings of `reviewing-a11y`) | Formal WCAG conformance audits, audit planning, org-level accessibility roadmaps/KPIs | REJECT (for now) | — | Enterprise compliance-program tooling; out of scope for a one-week beta. Revisit if the project later needs a formal accessibility program |
| `code-review-skill` | [awesome-skills/code-review-skill](https://github.com/awesome-skills/code-review-skill) | Generic code review guidance across 20+ languages/frameworks, including React 19 + TypeScript | REJECT | — | Kitchen-sink skill — over 90% of its reference material (PHP, Ruby, Go, Rust, Kotlin, Swift, C/C++, Zig, Qt, Django, Rails...) is irrelevant to this stack. Right-sizing it would mean rewriting its own frontmatter/scope, which stops being a faithful install of the source. Generic React 19/TypeScript best practices are also well within baseline model knowledge, unlike this repo's own undocumented conventions (which the project-specific skills already cover) |
| `mastering-typescript-skill` | [SpillwaveSolutions/mastering-typescript-skill](https://github.com/SpillwaveSolutions/mastering-typescript-skill) | Enterprise TypeScript patterns | REJECT | — | No license file in the repository (can't confidently vendor it); no activity in 7+ months |
| `trailofbits/skills` (40-skill collection) | [trailofbits/skills](https://github.com/trailofbits/skills) | Security research: smart contracts, binary analysis, cryptography, fuzzing, YARA, DWARF debugging | REJECT | — | Extremely reputable source, but the wrong specialty entirely — this is a Next.js/Prisma/PostgreSQL CRUD app, not a binary or smart-contract target. This repo's actual security surface (auth model, cookies, IDOR, rate limiting) was already covered by the manual audit in `audit/security.md`, which targets business-logic risk these skills don't address |
| Assorted small "systematic debugging" / "RCA" / "5-whys" skills | Various (searched individually) | Structured root-cause-analysis methodology | REJECT | — | Low community validation (1–41 stars each), and the methodology (reproduce → hypothesize → fix root cause → verify) is already how a competent session should work without a dedicated skill; no differentiated capability found |
| `obra/superpowers` (14-skill collection) | [obra/superpowers](https://github.com/obra/superpowers) | Full SDLC methodology: mandatory TDD, git-worktree branching, planning/brainstorming rituals, subagent orchestration | REJECT | — | Extremely popular (270k+ stars) but popularity alone isn't sufficient justification (explicit task constraint). It's a broad, opinionated workflow overlay that would compete with this session's own harness-provided conventions (task tracking, git safety protocol) and push practices (mandatory TDD) this project's actual state doesn't support — it has zero test infrastructure today, a decision documented and accepted in `release-verification`, not something to silently override |

### Why `reviewing-a11y` and `ux-heuristics` don't duplicate each other

Both touch accessibility, which is exactly the kind of overlap the task brief warned
against installing twice. They're kept because they answer different questions:
**`reviewing-a11y`** asks "does this meet WCAG 2.2/WAI-ARIA conformance" (screen
readers, keyboard nav, ARIA correctness — a standards-conformance lens).
**`ux-heuristics`** asks "would a confused, non-technical operator understand this
without help" (Krug's laws, Nielsen's heuristics, dark-pattern detection — a
plain-usability lens, which is what an event-day organizer who's never seen this
codebase actually needs, per the brief's Part 4). Both bundle their own
`wcag-checklist.md` reference — that's a known, harmless duplication between the two
vendored copies, not a bug; each skill stands alone by design.

---

## Skill Precedence

When a project-specific skill and an external skill give different guidance:

1. **This repository's actual code and documented business rules always win.**
   `architecture.md`, `domain-model.md`, `conventions.md`, and the `audit/` findings
   describe what this codebase does and why — an external skill's generic
   recommendation never overrides a documented, deliberate decision here (e.g., don't
   let `ux-heuristics` push for a "reduce clicks" redesign of the attendance scan flow
   without checking `architecture.md`'s concurrency notes first; don't let
   `webapp-testing` substitute for the manual smoke tests in
   `audit/release-readiness.md`, which test scenarios Playwright alone can't judge,
   like "would an organizer understand this error").
2. **Project-specific skills encode this repository's conventions** — the API route
   shape, the auth primitives, the Prisma patterns, the query-key factory. These are
   facts about this codebase, not opinions; treat them as close to ground truth as a
   skill file can be (they were written from a full audit read of the actual source,
   not from general framework knowledge).
3. **External skills provide general expertise this repo doesn't need to re-derive** —
   WCAG technique details, Nielsen's heuristics, Playwright automation patterns. Useful
   and correct in general, but they don't know this app's specific tradeoffs.
4. **An external skill's recommendation that implies a structural or architectural
   change must not be applied silently.** If `ux-heuristics` or `reviewing-a11y`
   surfaces a finding that implies changing a documented pattern (e.g., "this table's
   pagination should be server-side" running into the known `manual`-mode-exists-but-
   unused situation in `docs/conventions.md`), report it and let the user decide —
   don't quietly refactor architecture to satisfy an external skill's checklist. This
   mirrors the task-level instruction this document itself was written under: audits
   surface findings, they don't authorize unrequested rewrites.

---

## Scope rationale

Every skill here is **project-scoped** (`.claude/skills/`, committed to git), not
installed into the user's global `~/.claude/skills/`. Reasoning:

- The seven project-specific skills are, by definition, meaningless outside this
  repository — they describe this app's auth cookie format, this app's Prisma schema,
  this app's TanStack Query key factory. Global installation would be actively wrong.
- The three external skills (`webapp-testing`, `reviewing-a11y`, `ux-heuristics`) are
  general-purpose and *could* be useful in other projects, but they were vetted
  specifically against this app's stack and constraints (React/Next.js/TypeScript, no
  test suite, operator-usability priority). Installing them globally would apply them
  to unrelated projects without the same vetting, and would decouple the skill's
  presence from the audit trail explaining why it's there (this document). Keeping
  them project-scoped means this repository carries its own required Claude knowledge
  with it, which was an explicit goal of this task.
- No skill here had a "strong reason" for global scope (the bar the task set for
  breaking from project-scope-by-default), so none were installed globally.

---

## Final validation

Performed after installation — see the session that created this document for the
full commands run:

- All 10 `SKILL.md` files (7 project-specific, 3 external) have valid YAML frontmatter
  with `name` and `description`.
- No duplicate skill names.
- No two skills give contradictory instructions for the same situation — the one
  apparent overlap (`reviewing-a11y` vs `ux-heuristics`, both accessibility-adjacent)
  is addressed above and is complementary, not contradictory.
- No unnecessary skill collections were installed — every external skill was
  cherry-picked as an individual file/directory out of a larger source repository, with
  the omitted siblings and the reason for omitting them documented per-entry above and
  in each skill's own `SOURCE.md`.
- No application source code was modified by this task — verify with `git status`;
  the only changes are new files under `.claude/skills/` and this document.
- Every vendored external skill carries a `SOURCE.md` recording the exact upstream
  repository, path, commit SHA, fetch date, license, and any modifications made
  (all modifications are prepended "Project note" blocks, clearly delimited from the
  original upstream content — no upstream instructional text was altered or removed
  beyond the disclosed Japanese-localization trim in `reviewing-a11y`).

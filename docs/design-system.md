# Design System

**Canonical reference for how UI in the Event Attendance System should look.**

The interactive version lives at [`/design-system`](../app/(main)/design-system/page.tsx)
— run the app and open it. That page *shows* the components; this document explains
the reasoning and the rules. Component API detail lives in JSDoc on the components
themselves.

> **If you are an AI agent about to create or modify UI, read
> [Rules for AI agents](#rules-for-ai-agents) first.**

---

## Where this came from

The app was built over a long period, partly with AI assistance, and accumulated
several parallel visual languages. This system does not invent a new one. It
documents the best of what already exists.

**The Student List pages are the source of truth.** They are the most deliberate,
internally consistent screens in the app, and everything below was extracted from
them:

- `app/(main)/students/page.tsx` — overview/landing
- `app/(main)/students/select-category/page.tsx` — selection sub-page
- `app/(main)/students/student-list/page.tsx` — data-heavy roster
- `features/students/components/**` — the components those pages compose

The Dashboard independently adopted much of the same language, which is good
corroboration. Attendance, Reports, and Calendar diverge — see
[Known deviations](#known-deviations).

---

## Foundations

### Colour

**Primary is Tailwind `indigo-600`.** Use the stock Tailwind indigo scale. Never
introduce a bespoke primary hex.

| Step | Used for |
|---|---|
| `indigo-50` | Chip fills, subtle washes |
| `indigo-100` | Eyebrow text on the dark hero |
| `indigo-200` | Chip borders, hover borders |
| `indigo-400` | Focus rings (`ring-indigo-400/60`) |
| `indigo-500` | Primary hover, accent dots |
| **`indigo-600`** | **Primary — actions, eyebrows, active nav** |
| `indigo-700` | Chip text, emphasis numerals |

The shadcn `--primary` CSS variable resolves to indigo-600, so `<Button>`,
`<Checkbox>`, and `<Switch>` inherit it. This was changed as part of establishing
this system — it was previously stock shadcn neutral (near-black), which meant the
primitive layer visually contradicted every hand-styled action in the Student List.

**Neutrals are slate.** `slate-900` headings, `slate-600` body, `slate-500`
supporting copy, `slate-200` borders, `slate-50` inset surfaces.

**Semantic tones.** Six tones cover every status in the app. Pick by *meaning*,
never by preferred hue.

| Tone | Meaning | Event status |
|---|---|---|
| `neutral` | Counts, inert metadata | — |
| `primary` | The app's own emphasis | — |
| `info` | In progress | `PENDING` |
| `success` | Done, present | `APPROVED` |
| `warning` | Needs attention | `DRAFT` |
| `danger` | Failure, absent | `REJECTED` |

Resolve an `Event.status` through `EVENT_STATUS_TONE` in
`globals/components/shared/StatusBadge.tsx` rather than hardcoding a colour. The same
file exports `USER_STATUS_TONE` (`PENDING`/`ACTIVE`/`REJECTED`) for the operator
console's user table — same rule, same reason.

### Typography

Poppins (`--font-sans`) throughout. The **eyebrow + title** pair is the app's
signature header treatment:

```
eyebrow    text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600
title      text-3xl font-semibold tracking-tight md:text-4xl
subtitle   text-sm text-slate-500
```

Use `PageHeader` rather than reproducing this by hand.

### Surfaces

Three levels, and radii step *down* with nesting:

| Token | Radius | Use |
|---|---|---|
| `page.surface` | — | Full-page background (radial indigo→white wash) |
| `surface.panel` | `rounded-3xl` | The container holding a page's main content |
| `surface.card` | `rounded-2xl` | A content unit inside a panel |
| `surface.cardInteractive` | `rounded-2xl` | A card that is itself a link — adds lift + indigo hover |

Panels may layer `surface.panelGlow` (an absolutely-positioned indigo radial wash)
behind a `relative` content wrapper.

### Spacing & focus

Page padding `p-6 md:p-8`. Stack gap `gap-6`. Container `max-w-6xl`
(`max-w-7xl` for data-heavy screens).

Every custom interactive element needs a visible focus ring — use the shared
`focusRing` token. shad-cn primitives carry their own.

All of the above are exported from
[`globals/constants/designTokens.ts`](../globals/constants/designTokens.ts).
Import them instead of re-deriving the class strings from memory.

---

## Components

Live examples: [`/design-system`](../app/(main)/design-system/page.tsx) →
**Components**.

| Need | Use | Not |
|---|---|---|
| Ordinary action | `Button` (shad-cn) | A hand-styled `<button>` |
| Toolbar action | `pill.primary` / `pill.secondary` tokens | `Button` mixed into a pill row |
| Text field | `FormInput` | Bare `Input` + hand-written label |
| Select | `FormSelect` (needs `control`) | Raw `Select` in a `Controller` |
| Searchable select | `ComboBox` | `FormSelect` with 50 options |
| Date range | `DateRangePicker` | Two loose `DatePicker`s |
| Multi-select | `CheckboxGroup` | Several checkboxes in a row |
| Status / count chip | `StatusBadge` | Inline `rounded-full bg-x-50` |
| Page title | `PageHeader` | A bare `<h1>` |
| Table | `DataTable` (shared) | `StudentsDataTable` (Student List only) |
| Confirmation | `useConfirm()` | A bespoke dialog |
| Form panel | `Sheet` | `Drawer` (legacy) |
| Transient feedback | `toastSuccess` / `Warning` / `Danger` | `alert()` |
| Persistent message | `Alert` | A toast |
| Table loading/empty/error | `DataTableStates` exports | Per-feature placeholders |
| Chart | Recharts inside `ChartPanel` | A bare `ResponsiveContainer` |

Two rules worth stating explicitly:

- **`useConfirm()` is mandatory for every irreversible action.** This is the one
  convention in the codebase with zero exceptions. Breaking it is the easiest way
  to cause accidental attendance-data loss.
- **`toastWarning` ≠ `toastDanger`.** Warning is for a no-op that isn't a failure
  ("attendance was already recorded"). During an event, red for a harmless
  duplicate scan makes an organizer think data was lost and start re-scanning.

---

### Charts

Recharts, added for the reports overhaul. Charts are a **new pattern**, so the
rules are short and binding:

- **Wrap every chart in `features/reports/components/charts/ChartPanel`** — it
  supplies the card, the title, the fixed height Recharts needs to measure, an
  `overflow-x-auto` plot area, and the empty state. An empty chart frame with axes
  and no marks reads as broken; a sentence reads as "nothing happened".
- **Colours come from `CHART_COLORS`** in `globals/constants/attendance.ts`, as
  literal hex. Recharts styles with CSS values, not classes — and a Tailwind class
  assembled at runtime ships unstyled anyway.
- **The present/late/absent trio is validated, not chosen by eye.** It passes
  colour-vision-deficient separation but `late` (amber-500) sits under 3:1 contrast
  against white, so **any chart using it must carry visible labels or an
  accompanying table**. The status donut's labelled legend is that relief.
- **One series needs no legend** (the panel title names it); two or more always get
  one, so identity is never colour-alone.
- **`isAnimationActive={false}`.** A report is read, not watched, and animation
  makes print and screenshots non-deterministic.
- **Never on the print page.** `ResponsiveContainer` measures the DOM and renders
  blank or mis-sized in print. Printed documents are tables and numbers.
- Load charts with `next/dynamic` so Recharts stays out of the initial bundle.

---

## Page patterns

### Overview / landing
Hero `PageHeader`, then a panel of `cardInteractive` tiles that navigate deeper.
*Reference: Student List landing, Dashboard.*

### List / management
Toolbar panel (title + counter chips + actions + search) directly above a table.
The workhorse pattern. *Reference: `student-list`.*

### Selection / sub-page
Back link, plain `PageHeader`, then a `SelectionBoardFrame` panel of choice cards.
*Reference: `select-category`.*

### Form
Forms live in a `Sheet`, not on their own route. Multi-step forms use a step
indicator, validate per step with `methods.trigger([...])`, and pin Back/Next in
the footer. *Reference: `StudentFormDrawer`.*

### Dashboard / metrics
A row of metric cards above grouped sections. The value is `slate-900` and the
card border is neutral `slate-200`; tone survives **only** as a soft-fill icon
tile (the same `bg-x-50 text-x-700` treatment as `StatusBadge`). No gradients on
the icon tile, no tone-coloured value, no pastel border. *Reference: Dashboard.*

### Attendance (live operator screen)
The one screen operated under time pressure by someone who didn't build the app.
Optimise for legibility and unambiguous feedback over density: large scan target,
a toast on **every** scan, live table below, and a visible event-mode indicator so
the operator always knows whether they're recording time-in or time-out.

---

## Responsive guidance

**The app is not currently fully responsive, and this system does not fix that.**
A separate effort will. These rules exist so new work doesn't deepen the problem.

**Breakpoints in use:** `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280. Padding steps
at `md`, titles step at `md`, toolbars collapse at `lg`/`xl`.

**Principles:**

1. **Mobile-first classes.** Write the narrow layout, then add `md:`/`lg:`
   overrides. Don't start at desktop and bolt on overrides.
2. **The page body must never scroll horizontally.** Wide content — tables,
   toolbars, chip rows — scrolls inside its own `overflow-x-auto` container.
3. **Stack, don't shrink.** Toolbar rows are `flex-col` by default, `flex-row` at
   `lg`/`xl`. Shrinking a control below its tap target is worse than stacking.
4. **Tap targets ≥ 40px** in any flow an organizer uses during an event.
5. **Test at 375px.** If the page scrolls sideways there, it's wrong.

**Known to need responsive work** (not in scope here):

- Student List toolbar — pills wrap, but search competes for room below `md`
- `StudentsDataTable` — no horizontal scroll container; wide rosters overflow
- Attendance page — the primary mobile surface, built at desktop width
- Calendar — FullCalendar's month grid is unusable below `sm`
- Dashboard metric row — four across doesn't collapse cleanly on small tablets

---

## Known deviations

Recorded, not fixed. Establishing the target state is the point; a broad refactor
is deliberately out of scope. **Follow the "preferred" column in new work.**

| Deviation | Where | Preferred |
|---|---|---|
| Two table implementations | `StudentsDataTable` vs shared `DataTable` | Shared `DataTable` |
| Two page shells | Student List/Dashboard/Reports use `page.surface`; Attendance `bg-white p-6` | `page.surface` |
| Event-status colours duplicated | Dashboard `chipClass`, calendar `EventCard` | `EVENT_STATUS_TONE` |
| `Sheet` and `Drawer` coexist | `StudentFormDrawer` vs `EventDrawer` | `Sheet` |
| Student List `Pagination` duplicates the shared one | `StudentsDataTable/Pagination.tsx` | Shared `DataTablePagination` |
| Dark mode is dead code | `globals.css` `.dark` block and a `prefers-color-scheme` rule that sets inverted values; nothing activates either | Don't write `dark:` variants |

Each has a tracked backlog issue under the `ui` label.

---

## Rules for AI agents

If you are asked to *"create a new screen for X"*, these are binding.

1. **Consult this document and `/design-system` before creating any new UI.**
2. **Prefer an existing reusable component** over writing a new one. Check the
   component table above first.
3. **Follow the established page-level patterns** rather than inventing a layout.
4. **Use the documented tokens** for colour, spacing, typography, and interaction.
   Import from `globals/constants/designTokens.ts`.
5. **Don't introduce arbitrary new visual styles** because they're convenient.
6. **Don't add a new component** when an existing one satisfies the requirement.
7. **If a genuinely new pattern is required**, say so explicitly and propose it as
   an addition to this system rather than quietly inventing it.
8. **Treat the Student List pages and `/design-system` as canonical.** When this
   document and the code disagree, the Student List pages win, and this document
   should be corrected.
9. **Preserve the existing architecture** unless there's a concrete benefit to
   changing it.
10. **Prefer incremental improvements over rewrites.** Do not "bring a page in
    line with the design system" as an unrequested side effect of another task —
    file an issue instead.

### Two specific traps

- **Never build Tailwind class names at runtime.** `` `bg-${color}-500` `` produces
  unstyled elements because Tailwind only ships classes it can find as complete
  literals. This has already caused a real bug (past calendar events rendering as
  blank bars). Use a static lookup map.
- **Don't reach for a token to fake a component that already exists.** Tokens
  prevent *structural* drift; they're not a substitute for the component layer.

---

## Related documentation

- [`conventions.md`](./conventions.md) — code conventions ("how do I add a table?")
- [`architecture.md`](./architecture.md) — system design
- [`audit/operability.md`](./audit/operability.md) — why operator clarity is
  weighted so heavily on the attendance screen
- Component JSDoc — API detail, constraints, and worked examples

## Dedicated Class workspace (November2026)

Class reuses the indigo/Poppins tokens, shared headers, forms, dialogs, toasts and status indicators. Its focused sidebar and compact mobile tabs expose Dashboard, My Classes, Attendance, Students, Reports and Settings according to capability. The Events mobile shutter layout remains the default Events pattern.

Attendance uses stacked student cards and bottom sheets rather than a dense phone table. Actions have48px targets, text plus status indicators, visible saved/unconfirmed/error states and row-local same-save recovery. Default pagination is100, with server search/filter and stable scroll. Preserve accessible names, search/filter/page/mode across updates/reload. Scan success requires acknowledgment, never color or sound alone.

Verify375px and200% zoom with both page-overflow and adjacent-tab/label bounds; a page fitting the viewport can still contain overlapping tabs. Sheets need bounded scrolling, focused accessible labels and a usable manual camera fallback. Physical one-handed teacher and screen-reader trials remain release gates, not claims from automated bounds checks.

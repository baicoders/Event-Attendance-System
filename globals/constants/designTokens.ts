/**
 * Canonical design tokens for the Event Attendance System.
 *
 * These strings are the *literal* Tailwind class lists used by the Student List
 * pages, which `docs/design-system.md` designates as the visual source of truth.
 * They are exported here so new UI can import the real pattern instead of
 * re-deriving it (and drifting) from memory.
 *
 * ## When to use these
 *
 * Import a token when you are building a **page shell, panel, card, eyebrow, or
 * pill action** — the structural pieces that make screens look like they belong
 * to this app. For everything else, prefer an actual component
 * (`Button`, `FormInput`, `DataTable`, `StatusBadge`) over a token string.
 *
 * ## When NOT to use these
 *
 * Don't reach for a token to style a one-off element that a shad-cn primitive
 * already covers. Tokens exist to stop *structural* drift, not to replace the
 * component layer. If you find yourself composing three tokens to fake a
 * component that already exists, use the component.
 *
 * @see docs/design-system.md — the written playbook
 * @see /design-system — the interactive reference page
 */

/**
 * Page-level shells.
 *
 * `surface` is the canonical full-page background + padding used by the Student List
 * and the Dashboard. `container` centers content and caps line length.
 *
 * Note: Attendance, Reports, and Calendar currently use flat `bg-white` shells
 * instead — a known, documented deviation (see `docs/design-system.md`
 * "Known deviations"). New pages should use `surface`.
 */
export const page = {
  /** Full-page background + padding. Pair with `page.container`. */
  surface:
    "flex flex-1 justify-center overflow-y-auto bg-[radial-gradient(circle_at_top,#eef2ff_0%,#f8fafc_45%,#ffffff_100%)] min-w-0 p-4 text-slate-900 sm:p-6 md:p-8",
  /** Centered column inside `page.surface`. `max-w-7xl` (1280px) is the app default. */
  container: "flex w-full min-w-0 max-w-7xl flex-col gap-6",
  /** Wider variant for data-heavy screens (tables that need horizontal room). */
  containerWide: "flex w-full min-w-0 max-w-7xl flex-col gap-6",
} as const;

/**
 * Elevated containers.
 *
 * `panel` is the large rounded container that holds a page's main content
 * (stats board, table header, selection board). `card` is the smaller,
 * interactive unit inside it.
 *
 * `panelGlow` is the decorative indigo wash the Student List layers inside panels —
 * render it as an absolutely-positioned sibling before the content, and keep
 * the content in a `relative` wrapper so it stacks above.
 */
export const surface = {
  /** Large content container. Rounded-3xl, soft elevation, subtle blur. */
  panel:
    "relative overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-[0_20px_45px_rgba(15,23,42,0.08)] backdrop-blur",
  /** Decorative indigo wash for inside a panel. Position absolute, before content. */
  panelGlow:
    "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.10),transparent_58%)]",
  /** Standard card. Use `cardInteractive` instead when the whole card is a link. */
  card: "rounded-2xl border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.08)]",
  /** Card that is itself a link/button — adds lift + indigo hover affordance. */
  cardInteractive:
    "group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition-all hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_18px_34px_rgba(37,99,235,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60",
} as const;

/**
 * Typography.
 *
 * `eyebrow` is the small uppercase label above a page title — the app's most
 * recognizable type signature. `pageTitle` is the h1 beneath it.
 */
export const type = {
  /** Small uppercase kicker above a title. Indigo on light surfaces. */
  eyebrow:
    "text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600",
  /** Same kicker, for use on the dark gradient hero where indigo has no contrast. */
  eyebrowOnDark:
    "text-xs font-semibold uppercase tracking-[0.2em] text-indigo-100",
  /** Page h1. */
  pageTitle:
    "mt-2 break-words text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl",
  /** Page h1 on the dark gradient hero. */
  pageTitleOnDark: "mt-2 break-words text-3xl font-semibold tracking-tight md:text-4xl",
  /** Supporting sentence under a page title. */
  pageSubtitle: "mt-2 text-sm text-slate-500",
  /** Section title inside a panel. */
  sectionTitle: "text-lg font-semibold text-slate-900",
  /** De-emphasized body copy. */
  muted: "text-sm text-slate-500",
} as const;

/**
 * Pill actions — the Student List toolbar button style.
 *
 * These match the shared Button typography, radius and target size.
 * They remain available for existing toolbar markup during incremental adoption.
 *
 * **Prefer `<Button>` for ordinary actions** (dialog footers, forms, anything
 * in a card). Reach for a pill only when building a toolbar row that should
 * match the Student List's.
 */
export const pill = {
  /** Primary toolbar action (Add, Execute). Indigo-600 filled. */
  primary:
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-indigo-600 bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 disabled:pointer-events-none disabled:opacity-50",
  /** Secondary toolbar action (Import, Sort, Filter). White with slate border. */
  secondary:
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 disabled:pointer-events-none disabled:opacity-50",
  /** Back / breadcrumb link. Softer than `secondary`. */
  back: "group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/50 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm backdrop-blur-sm transition-all hover:border-indigo-300 hover:bg-white hover:text-indigo-600 hover:shadow-md",
} as const;

/**
 * Form controls that are hand-rolled rather than shad-cn.
 *
 * Only `searchInput` lives here — every other input in the app should go
 * through `FormInput` / `FormSelect` / the shad-cn primitives.
 */
export const control = {
  /** Rounded search field with a leading icon slot. See `StudentSearchInput`. */
  searchInput:
    "w-full rounded-full border border-slate-300 bg-white min-h-12 px-10 py-3 text-sm font-normal text-slate-700 shadow-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300/40",
} as const;

/**
 * The app's focus ring. Apply to any custom interactive element that isn't a
 * shad-cn primitive (those carry their own `focus-visible` styles).
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60";

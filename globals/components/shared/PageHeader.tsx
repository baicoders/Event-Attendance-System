import type { ReactNode } from "react";

import { cn } from "@/globals/libs/shad-cn";
import { type as typeToken } from "@/globals/constants/designTokens";

type PageHeaderProps = {
  /** Small uppercase kicker above the title (e.g. "Student Directory"). */
  eyebrow?: string;
  /** The page's h1. Keep it short — it renders at 3xl/4xl. */
  title: string;
  /** One supporting sentence. Omit rather than padding with filler. */
  description?: string;
  /**
   * `hero` — indigo gradient block with white text. Use once, at the top of a
   * landing/overview page (Students, Dashboard).
   *
   * `plain` — text on the page background. Use for sub-pages and anything
   * sitting inside or above a panel, so a screen never stacks two heroes.
   */
  variant?: "hero" | "plain";
  /** Right-aligned slot for actions or status chips. */
  actions?: ReactNode;
  className?: string;
};

/**
 * PageHeader
 *
 * The canonical page title block. Two variants cover every header in the app:
 * the indigo gradient `hero` that opens the Students pages and the Dashboard, and the
 * `plain` text header used on sub-pages.
 *
 * ## Prefer this over
 * Hand-writing an `<h1>` with its own eyebrow/spacing. The eyebrow's letter
 * spacing, the title's responsive size step, and the gradient are all easy to
 * get subtly wrong, and drift here is very visible because it's the first thing
 * on every screen.
 *
 * ## Constraints
 * - **One `hero` per page.** A hero under a hero reads as two page titles.
 * - The hero is deliberately dark; don't place indigo text on it (use the
 *   component's own eyebrow, which switches to `indigo-100` automatically).
 * - `actions` is for a small number of controls. A full toolbar row belongs in
 *   the panel below the header, next to the data it acts on — see the Manage
 *   List table header.
 *
 * ## Responsive
 * Both variants stack `actions` below the title under `md`. The hero's title
 * steps 3xl → 4xl at `md`. No further work is needed for narrow screens.
 *
 * @example
 * ```tsx
 * <PageHeader
 *   variant="hero"
 *   eyebrow="Student Directory"
 *   title="Student's List"
 *   description="Choose a student category below to manage its roster."
 * />
 * ```
 */
const PageHeader = ({
  eyebrow,
  title,
  description,
  variant = "plain",
  actions,
  className,
}: PageHeaderProps) => {
  const isHero = variant === "hero";

  return (
    <header
      className={cn(
        isHero &&
          "overflow-hidden rounded-3xl border border-indigo-200/60 bg-[linear-gradient(130deg,#1e1b4b_0%,#1d4ed8_52%,#4f46e5_100%)] px-6 py-7 text-white shadow-[0_24px_50px_rgba(30,64,175,0.25)] md:px-8",
        className,
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className={isHero ? typeToken.eyebrowOnDark : typeToken.eyebrow}>
              {eyebrow}
            </p>
          ) : null}

          <h1
            className={isHero ? typeToken.pageTitleOnDark : typeToken.pageTitle}
          >
            {title}
          </h1>

          {description ? (
            <p
              className={cn(
                "mt-3 max-w-2xl text-sm",
                isHero ? "text-indigo-100/90" : "text-slate-500",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 md:max-w-[50%]">{actions}</div>
        ) : null}
      </div>
    </header>
  );
};

export default PageHeader;

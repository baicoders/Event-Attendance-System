"use client";

import { useEffect, useState } from "react";

import PageHeader from "@/globals/components/shared/PageHeader";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { cn } from "@/globals/libs/shad-cn";
import { page } from "@/globals/constants/designTokens";
import ComponentsSection from "@/features/design-system/components/ComponentsSection";
import FoundationsSection from "@/features/design-system/components/FoundationsSection";
import GuidanceSection from "@/features/design-system/components/GuidanceSection";
import PatternsSection from "@/features/design-system/components/PatternsSection";

const NAV = [
  { id: "foundations", label: "Foundations" },
  { id: "components", label: "Components" },
  { id: "patterns", label: "Patterns" },
  { id: "guidance", label: "Guidance" },
];

/**
 * Internal design system playbook.
 *
 * Developer-facing reference for the app's visual language. Every example
 * renders a real component from `globals/components` — nothing here is a
 * lookalike built for the docs, so if an example drifts from the product it is
 * because the component changed, which is exactly the signal we want.
 *
 * Not linked from the sidebar: it's a developer tool, not an operator feature.
 * Reachable at `/design-system`.
 *
 * @see docs/design-system.md — the written playbook and AI rules
 */
const DesignSystemPage = () => {
  const [active, setActive] = useState<string>("foundations");

  // Highlight the nav entry for whichever section is currently in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      // Trigger around the upper third so a section registers as "current"
      // once its heading reaches comfortable reading position.
      { rootMargin: "-80px 0px -66% 0px", threshold: 0 },
    );

    NAV.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={cn(page.containerWide, "gap-8")}>
        <PageHeader
          variant="hero"
          eyebrow="Internal Reference"
          title="Design System"
          description="The canonical visual language for the Event Attendance System. Build new screens from these components and patterns so the app keeps looking like one app."
          actions={
            <StatusBadge tone="primary" className="border-white/25 bg-white/15 text-white">
              Developer tool
            </StatusBadge>
          }
        />

        {/* Sticky section nav. Scrolls horizontally on narrow screens rather
            than wrapping into a tall block that pushes content down. */}
        <nav
          aria-label="Design system sections"
          className="sticky top-0 z-20 -mx-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white/85 px-1 py-1.5 backdrop-blur"
        >
          <ul className="flex min-w-max items-center gap-1">
            {NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={active === item.id ? "true" : undefined}
                  className={cn(
                    "inline-flex items-center rounded-xl px-3.5 py-1.5 text-sm font-medium transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60",
                    active === item.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-col gap-12 pb-16">
          <FoundationsSection />
          <ComponentsSection />
          <PatternsSection />
          <GuidanceSection />
        </div>
      </div>
    </section>
  );
};

export default DesignSystemPage;

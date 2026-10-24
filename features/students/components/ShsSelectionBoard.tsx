"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { STRAND_TRACK_BY_SLUG } from "@/features/students/constants/categories";
import { SHS_STRANDS } from "@/globals/constants/groups";
import { type GroupChoice, useFetchGroupsByCategory } from "@/globals/hooks/useGroups";
import { Skeleton } from "@/globals/components/shad-cn/skeleton";
import { Button } from "@/globals/components/shad-cn/button";
import { slugify } from "@/globals/utils/text";

const codesBySlug = Object.fromEntries(SHS_STRANDS.map(strand => [slugify(strand.code), strand.code]));

function StrandPanel({ title, description, strands }: { title: string; description: string; strands: GroupChoice[] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-slate-500">{strands.length}</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {strands.map(strand => {
        const code = codesBySlug[strand.slug];
        return <Link key={strand.slug}
          href={{ pathname: "/students/student-list", query: { category: "SHS", strand: strand.slug } }}
          className="group flex min-h-24 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="min-w-0">
            {code && code.toLowerCase() !== strand.name.toLowerCase() && <span className="mb-1 block text-xs font-medium text-slate-500">{code}</span>}
            <span className="block break-words text-sm font-semibold leading-5 text-slate-800 group-hover:text-indigo-700">{strand.name}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400 group-hover:text-indigo-600" />
        </Link>;
      })}
    </div>
  </section>;
}

export default function ShsSelectionBoard() {
  const { data: strands = [], isLoading, isError, refetch } = useFetchGroupsByCategory("STRAND");
  const sections = [
    { title: "Academic track", description: "General education and university pathways.", strands: strands.filter(strand => STRAND_TRACK_BY_SLUG[strand.slug] === "ACADEMIC") },
    { title: "Technical-vocational track", description: "Practical skills and technical specializations.", strands: strands.filter(strand => STRAND_TRACK_BY_SLUG[strand.slug] === "TECHVOC") },
    // Newly created strands remain reachable even without a track assignment.
    { title: "Other strands", description: "Additional strands in the student directory.", strands: strands.filter(strand => !STRAND_TRACK_BY_SLUG[strand.slug]) },
  ].filter(section => section.strands.length > 0);

  return <div className="w-full space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-indigo-700">Student directory</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">Senior High School</h1>
        <p className="mt-2 text-sm text-slate-500">Select a strand to view and manage its student roster.</p>
      </div>
      {!isLoading && !isError && <p className="text-sm text-slate-500">{strands.length} {strands.length === 1 ? "strand" : "strands"}</p>}
    </header>
    {isLoading ? <div aria-label="Loading strands" role="status" className="grid gap-6 lg:grid-cols-2">
      <Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" />
    </div> : isError ? <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-6">
      <p className="mb-3 text-sm text-slate-600">Couldn&apos;t load strands.</p>
      <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
    </div> : sections.length ? <div className="grid items-start gap-6 lg:grid-cols-2">
      {sections.map(section => <StrandPanel key={section.title} {...section} />)}
    </div> : <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No strands yet. An administrator can add them in Settings.</p>}
  </div>;
}

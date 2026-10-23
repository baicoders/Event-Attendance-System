"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import PageHeader from "@/globals/components/shared/PageHeader";
import DataTable from "@/globals/components/shared/dataTable/DataTable";
import { DataTableEmptyState, DataTableErrorState } from "@/globals/components/shared/dataTable/DataTableStates";
import { Button } from "@/globals/components/shad-cn/button";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { page, pill } from "@/globals/constants/designTokens";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useCustomGroups } from "../hooks/useCustomGroups";
import { getCustomGroupColumns } from "../constants/groupColumns";
import type { CustomGroup } from "../types";
import CustomGroupFormSheet from "./CustomGroupFormSheet";

export default function CustomGroupsClient() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const router = useRouter();
  const groups = useCustomGroups();
  const [formTarget, setFormTarget] = useState<CustomGroup | "new" | null>(null);
  const columns = useMemo(() => getCustomGroupColumns(isAdmin ? setFormTarget : undefined), [isAdmin]);

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <PageHeader variant="hero" eyebrow="Student Organizations" title="Custom Groups" description="Manage the students in clubs, organizations, and teams, and choose these groups as event audiences." />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge>Total groups: {groups.data?.length ?? "—"}</StatusBadge>
          {!isAdmin && <p className="text-sm text-slate-500">An administrator can create groups and manage members.</p>}
        </div>
        <DataTable columns={columns} data={groups.data ?? []} isLoading={groups.isLoading} isError={groups.isError} getRowId={(group) => group.id}
          emptyState={<DataTableEmptyState title="No custom groups yet" description={isAdmin ? "Create a group, then add students from the existing roster." : "Custom groups will appear here once an administrator creates them."} />}
          errorState={<div className="pb-8 text-center"><DataTableErrorState title="Couldn't load custom groups" description={groups.error instanceof Error ? groups.error.message : "Please retry."} /><Button variant="outline" onClick={() => groups.refetch()}>Retry</Button></div>}
          toolbarTrailing={isAdmin ? <button type="button" className={pill.primary} onClick={() => setFormTarget("new")}><Plus aria-hidden className="size-4" />Create group</button> : undefined}
        />
        {isAdmin && formTarget && <CustomGroupFormSheet group={formTarget === "new" ? undefined : formTarget} onClose={() => setFormTarget(null)} onCreated={(group) => router.push(`/custom-groups/${encodeURIComponent(group.id)}`)} />}
      </div>
    </section>
  );
}

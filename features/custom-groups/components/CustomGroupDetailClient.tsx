"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import PageHeader from "@/globals/components/shared/PageHeader";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import DataTable from "@/globals/components/shared/dataTable/DataTable";
import { DataTableEmptyState, DataTableErrorState } from "@/globals/components/shared/dataTable/DataTableStates";
import { page, pill, surface } from "@/globals/constants/designTokens";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useCustomGroup } from "../hooks/useCustomGroups";
import { getMemberColumns } from "../constants/memberColumns";
import AddGroupMember from "./AddGroupMember";
import CustomGroupFormSheet from "./CustomGroupFormSheet";

export default function CustomGroupDetailClient({ groupId }: { groupId: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const group = useCustomGroup(groupId);
  const [isRenaming, setIsRenaming] = useState(false);
  const columns = useMemo(() => getMemberColumns(isAdmin), [isAdmin]);

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <div><Link className={pill.back} href="/custom-groups"><ArrowLeft aria-hidden className="size-4" />Custom Groups</Link></div>
        {group.isLoading ? <p role="status" className="flex items-center gap-2 text-slate-500"><Loader2 aria-hidden className="size-4 animate-spin" />Loading group…</p>
          : group.isError || !group.data ? <div className={`${surface.panel} p-6 text-center`}><DataTableErrorState title="Couldn't load custom group" description={group.error instanceof Error ? group.error.message : "Please retry."} /><Button variant="outline" onClick={() => group.refetch()}>Retry</Button></div>
          : <>
            <PageHeader eyebrow="Custom Group" title={group.data.name} description="Membership determines eligibility for events targeting this group." actions={<>
              <StatusBadge tone="primary">{group.data.memberCount} {group.data.memberCount === 1 ? "member" : "members"}</StatusBadge>
              {isAdmin && <Button variant="outline" onClick={() => setIsRenaming(true)}><Pencil aria-hidden className="size-4" />Rename group</Button>}
            </>} />
            {isAdmin ? <AddGroupMember groupId={groupId} /> : <p className="text-sm text-slate-500">An administrator can add or remove members and update positions.</p>}
            <DataTable title="Members" columns={columns} data={group.data.members} isLoading={false} getRowId={(member) => member.studentId} resetKey={groupId} emptyState={<DataTableEmptyState title="No members yet" description={isAdmin ? "Search the student roster above to add the first member." : "Members will appear here once an administrator adds them."} />} />
            {isAdmin && isRenaming && <CustomGroupFormSheet group={group.data} onClose={() => setIsRenaming(false)} />}
          </>}
      </div>
    </section>
  );
}

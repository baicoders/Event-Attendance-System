"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import DataTable from "@/globals/components/shared/dataTable/DataTable";
import {
  DataTableEmptyState,
  DataTableErrorState,
} from "@/globals/components/shared/dataTable/DataTableStates";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { pill, type as typeToken } from "@/globals/constants/designTokens";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import {
  ManagedGroup,
  useDeleteGroup,
  useManageGroups,
} from "@/globals/hooks/useGroups";
import { getGroupColumns } from "../constants/groupsTable";
import GroupFormSheet from "./GroupFormSheet";
import GroupDeleteDialog from "./GroupDeleteDialog";

/**
 * The console's group vocabulary screen — the durable replacement for editing
 * `globals/constants/groups.ts` and re-running the destructive seed.
 */
const ManageGroupsSection = () => {
  const { data: groups, isLoading, isError } = useManageGroups();
  const { mutateAsync: deleteGroup, isPending: isDeleting } = useDeleteGroup();
  const confirm = useConfirm();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ManagedGroup | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<ManagedGroup | null>(null);

  const rows = useMemo(() => groups ?? [], [groups]);

  const columns = useMemo(
    () =>
      getGroupColumns({
        onEdit: (group) => {
          setEditTarget(group);
          setIsFormOpen(true);
        },
        onDelete: (group) => setDeleteTarget(group),
      }),
    [],
  );

  const handleConfirmDelete = async (reassignToGroupId: string | null) => {
    if (!deleteTarget) return;

    const confirmed = await confirm({
      title: `Delete "${deleteTarget.name}"?`,
      description: reassignToGroupId
        ? "Its members will be moved to the group you picked. Deleting a group cannot be undone."
        : "Its members will be left without a group of this category. Deleting a group cannot be undone.",
    });
    if (!confirmed) return;

    try {
      const result = await deleteGroup({
        groupId: deleteTarget.id,
        reassignToGroupId,
      });
      toastSuccess(
        "Group deleted",
        result.reassignedStudents > 0
          ? `${result.reassignedStudents} student(s) moved.`
          : result.unassignedStudents > 0
            ? `${result.unassignedStudents} student(s) left unassigned.`
            : undefined,
      );
      setDeleteTarget(null);
    } catch (error) {
      toastDanger(
        "Couldn't delete group",
        error instanceof Error ? error.message : undefined,
      );
    }
  };

  const openCreateForm = () => {
    setEditTarget(undefined);
    setIsFormOpen(true);
  };

  return (
    <section id="groups" className="flex w-full scroll-mt-6 flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className={typeToken.sectionTitle}>Groups</h2>
          <p className={typeToken.muted}>
            The vocabulary a roster import is checked against, and what an event
            can target.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge>Total: {rows.length}</StatusBadge>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        isError={isError}
        getRowId={(row) => row.id}
        errorState={
          <DataTableErrorState
            title="Couldn't load groups"
            description="Please retry."
          />
        }
        emptyState={
          <DataTableEmptyState
            title="No groups yet"
            description="Add the sections, departments, houses, programs, and strands your roster uses."
          />
        }
        // The built-in toolbar keeps the shared search box wired to the table
        // instance; the Add action rides alongside it.
        toolbarTrailing={
          <button type="button" className={pill.primary} onClick={openCreateForm}>
            <Plus className="size-4" />
            Add group
          </button>
        }
      />

      <GroupFormSheet
        // Remount per record so the form never carries the previous group over.
        key={editTarget?.id ?? "new"}
        isOpen={isFormOpen}
        group={editTarget}
        onClose={() => setIsFormOpen(false)}
      />

      <GroupDeleteDialog
        group={deleteTarget}
        allGroups={rows}
        isDeleting={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
};

export default ManageGroupsSection;

import { ColumnDef } from "@tanstack/react-table";
import { KeyRound } from "lucide-react";

import { Button } from "@/globals/components/shad-cn/button";
import StatusBadge, {
  USER_STATUS_TONE,
} from "@/globals/components/shared/StatusBadge";
import type { ManagedUser } from "@/globals/hooks/useAdmin";

type Actions = {
  onResetPassword: (user: ManagedUser) => void;
  /** Id of the row currently being reset, so only that button shows progress. */
  processingId: string | null;
  /** While a reset is pending or an issuance awaits dismissal, all rows lock. */
  resetDisabled?: boolean;
};

export const getUserColumns = ({
  onResetPassword,
  processingId,
  resetDisabled = false,
}: Actions): ColumnDef<ManagedUser>[] => [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium text-slate-900">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => (
      <span className="text-slate-600">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => (
      <StatusBadge tone={row.original.role === "ADMIN" ? "primary" : "neutral"}>
        {row.original.role}
      </StatusBadge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={USER_STATUS_TONE[row.original.status]} withDot>
          {row.original.status}
        </StatusBadge>
        {row.original.mustChangePassword ? (
          <StatusBadge tone="warning">Temp password</StatusBadge>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Joined",
    // A relation-free primitive for the cell; the raw ISO string is what the
    // wire format carries.
    cell: ({ row }) => (
      <span className="text-slate-600">
        {new Date(row.original.createdAt).toLocaleDateString()}
      </span>
    ),
  },
  {
    id: "actions",
    header: "",
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={resetDisabled || processingId === row.original.id}
          onClick={() => onResetPassword(row.original)}
        >
          <KeyRound className="size-4" />
          {processingId === row.original.id
            ? "Resetting…"
            : "Reset password"}
        </Button>
      </div>
    ),
  },
];

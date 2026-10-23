import Link from "next/link";
import { Pencil } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/globals/components/shad-cn/button";
import { focusRing } from "@/globals/constants/designTokens";
import type { CustomGroup } from "../types";

export const getCustomGroupColumns = (onRename?: (group: CustomGroup) => void): ColumnDef<CustomGroup>[] => [
  {
    accessorKey: "name",
    header: "Group name",
    cell: ({ row }) => <Link className={`font-semibold text-indigo-600 hover:underline ${focusRing}`} href={`/custom-groups/${encodeURIComponent(row.original.id)}`}>{row.original.name}</Link>,
  },
  { accessorKey: "memberCount", header: "Members" },
  ...(onRename ? [{
    id: "actions",
    header: "Actions",
    enableSorting: false,
    cell: ({ row }: { row: { original: CustomGroup } }) => (
      <Button type="button" variant="outline" size="sm" onClick={() => onRename(row.original)} aria-label={`Rename ${row.original.name}`}>
        <Pencil aria-hidden className="size-3.5" />Rename
      </Button>
    ),
  }] : []),
];

"use client";

import { getAttendanceColumns } from "@/features/attendance/constants/eventAttendanceTable";
import { Event } from "@/globals/types/events";
import { useAllRecordsFromEvent } from "@/globals/hooks/useRecords";
import { useEffect, useMemo, useState } from "react";
import DataTable from "@/globals/components/shared/dataTable/DataTable";
import { Button } from "@/globals/components/shad-cn/button";
import { DataTableErrorState } from "@/globals/components/shared/dataTable/DataTableStates";
import { useAuth } from "@/globals/contexts/AuthContext";

type Props = {
  selectedEvent: Event | null;
};

const AttendanceRecordsTable = ({ selectedEvent }: Props) => {
  const { user } = useAuth();
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  useEffect(() => setOnlyNeedsReview(false), [selectedEvent?.id]);
  const { data, isLoading, isError } = useAllRecordsFromEvent(
    selectedEvent?.id,
    { live: true, onlyNeedsReview }
  );
  const records = useMemo(() => data ?? [], [data]);

  // Deleting records requires event ownership (or admin); the columns hide the
  // delete control accordingly so users aren't shown a control that 403s.
  const canManage =
    !!selectedEvent &&
    (user?.role === "ADMIN" || selectedEvent.createdById === user?.id);
  const columns = useMemo(
    () => getAttendanceColumns(canManage),
    [canManage]
  );

  if (!selectedEvent) return null;

  // Error presentation goes through the shared card (via isError/errorState)
  // rather than a separate red box, so loading/error/empty stay consistent.
  return (
    <DataTable
      columns={columns}
      data={records}
      isLoading={isLoading}
      isError={isError}
      errorState={
        <DataTableErrorState
          title="Couldn't load attendance records"
          description="Please retry."
        />
      }
      title={onlyNeedsReview ? "Records needing review" : "Attendance Records"}
      toolbarTrailing={<Button type="button" variant="outline" size="sm" aria-pressed={onlyNeedsReview}
        onClick={() => setOnlyNeedsReview((value) => !value)}>
        {onlyNeedsReview ? "Show checked-in records" : "Review records without time-in"}
      </Button>}
      // Switching events swaps the rows without unmounting; restart at page 1 so
      // live polling of the previous event's page doesn't linger.
      resetKey={`${selectedEvent.id}:${onlyNeedsReview}`}
    />
  );
};

export default AttendanceRecordsTable;

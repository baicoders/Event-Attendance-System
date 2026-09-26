import { Suspense } from "react";
import AttendanceReviewClient from "@/features/attendance/components/AttendanceReviewClient";

export default function AttendanceCorrectionsPage() {
  return <Suspense fallback={<p className="p-6" role="status">Loading attendance review…</p>}><AttendanceReviewClient /></Suspense>;
}

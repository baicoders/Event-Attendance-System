import StudentDetailClient from "@/features/students/components/StudentDetailClient";
import { decodeStudentPageId } from "@/globals/utils/studentReturn";

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: encodedId } = await params;
  const id = decodeStudentPageId(encodedId);
  return <StudentDetailClient key={id} studentId={id} />;
}

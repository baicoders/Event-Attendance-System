import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError, requireAuth, requireRole } from "@/globals/utils/auth";
import PageHeader from "@/globals/components/shared/PageHeader";
import { page, pill } from "@/globals/constants/designTokens";
import StudentRecordIssuesClient from "@/features/students/components/StudentRecordIssuesClient";
export default async function StudentRecordIssuesPage() {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.status === 401) redirect("/login");
    return (
      <p role="alert" className="p-6">
        An active administrator account is required to address student record
        issues.
      </p>
    );
  }
  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={`${page.containerWide} space-y-6`}>
        <Link href="/students" className={`${pill.back} self-start`}>
          ← Student management
        </Link>
        <PageHeader
          eyebrow="Student directory"
          title="Address Student Record Issues"
          description="Find missing information and open a student profile to complete it. These issues do not prevent attendance at school-wide events."
        />
        <Suspense fallback={<p>Loading record issues…</p>}>
          <StudentRecordIssuesClient />
        </Suspense>
      </div>
    </section>
  );
}

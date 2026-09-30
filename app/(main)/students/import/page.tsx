import { Download } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import { page } from "@/globals/constants/designTokens";
import { AuthError, requireAuth, requireRole } from "@/globals/utils/auth";
import { redirect } from "next/navigation";
import StudentImporter from "@/features/students/components/StudentImporter";

export default async function ImportStudentPage() {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.status === 401) redirect("/login");
    return <p role="alert" className="p-6">A usable administrator account is required to import the student masterlist.</p>;
  }
  return <section className={`${page.surface} min-h-svh`}><div className={`${page.containerWide} space-y-6`}><div className="flex flex-wrap items-end justify-between gap-4"><div className="space-y-1"><h1 className="text-3xl font-bold tracking-tight">Import student masterlist</h1><p className="text-sm text-muted-foreground">Upload the canonical CSV, review every consequence, then confirm.</p></div><Button variant="outline" size="sm" asChild><a href="/templates/student_import_template.csv" download="student_import_template.csv"><Download className="size-4" />Download canonical template</a></Button></div><StudentImporter /></div></section>;
}

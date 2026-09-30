import { redirect } from "next/navigation";
import { AuthError, requireAuth, requireRole } from "@/globals/utils/auth";
import { page } from "@/globals/constants/designTokens";
import StudentImportReceipt from "@/features/students/components/StudentImportReceipt";

export default async function ImportReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.status === 401) redirect("/login");
    return <p role="alert" className="p-6">A usable administrator account is required to view import receipts.</p>;
  }
  const { id } = await params;
  return <section className={`${page.surface} min-h-svh`}><div className={page.containerWide}><StudentImportReceipt receiptId={id} /></div></section>;
}

import { requireAuth, requireRole } from '@/globals/utils/auth';
import { prisma } from '@/globals/libs/prisma';
import { getImportReceipt } from '@/features/students/import/receiptServer';
import { importSuccess, importFailure } from '@/features/students/import/http';
export async function GET(_request:Request, context:{params:Promise<{id:string}>}) {
  try {
    const actor=await requireAuth(); requireRole(actor,'ADMIN');
    return importSuccess(await getImportReceipt(prisma,(await context.params).id,actor));
  } catch(error) { return importFailure(error); }
}

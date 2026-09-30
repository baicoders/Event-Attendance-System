import { requireAuth, requireRole } from '@/globals/utils/auth';
import { prisma } from '@/globals/libs/prisma';
import { getImportReceipt } from '@/features/students/import/receiptServer';
import { importSuccess, importFailure } from '@/features/students/import/http';
export async function GET(_request:Request, context:{params:Promise<{commandId:string}>}) {
  try {
    const actor=await requireAuth(); requireRole(actor,'ADMIN');
    return importSuccess(await getImportReceipt(prisma,(await context.params).commandId,actor,true));
  } catch(error) { return importFailure(error); }
}

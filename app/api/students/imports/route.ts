import { requireAuth, requireRole } from '@/globals/utils/auth';
import { prisma } from '@/globals/libs/prisma';
import { ImportError } from '@/features/students/import/errors';
import { listImportReceipts } from '@/features/students/import/receiptServer';
import { importSuccess, importFailure } from '@/features/students/import/http';
export async function GET(request:Request) {
  try {
    const actor=await requireAuth(); requireRole(actor,'ADMIN');
    const params=new URL(request.url).searchParams;
    if([...params.keys()].some(key=>params.getAll(key).length!==1)) throw new ImportError('Duplicate history parameters.','INVALID_REQUEST');
    return importSuccess(await listImportReceipts(prisma,Object.fromEntries(params),actor));
  } catch(error) { return importFailure(error); }
}

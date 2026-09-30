import { requireAuth, requireRole } from '@/globals/utils/auth';
import { prisma } from '@/globals/libs/prisma';
import { commitStudentImport } from '@/features/students/import/server';
import { readImportBody, importSuccess, importFailure } from '@/features/students/import/http';
export async function POST(request:Request) {
  try {
    const actor=await requireAuth();
    requireRole(actor,'ADMIN');
    return importSuccess(await commitStudentImport(prisma,await readImportBody(request),actor));
  } catch(error) { return importFailure(error); }
}

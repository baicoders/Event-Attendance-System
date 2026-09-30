import { requireAuth, requireRole } from '@/globals/utils/auth';
import { prisma } from '@/globals/libs/prisma';
import { previewStudentImport } from '@/features/students/import/server';
import { readImportBody, importSuccess, importFailure } from '@/features/students/import/http';
export async function POST(request:Request) {
  try {
    const actor=await requireAuth();
    requireRole(actor,'ADMIN');
    return importSuccess(await previewStudentImport(prisma,await readImportBody(request),actor));
  } catch(error) { return importFailure(error); }
}

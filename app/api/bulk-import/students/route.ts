import { requireAuth, requireRole } from '@/globals/utils/auth';
import { importFailure } from '@/features/students/import/http';
import { ImportError } from '@/features/students/import/errors';
/** Coordinated UI/API replacement: old clients must review before any write. */
export async function POST() {
  try {
    const actor=await requireAuth();
    requireRole(actor,'ADMIN');
    throw new ImportError('Student imports require reviewed preview. Use /api/students/imports/preview and /commit.', 'REVIEW_REQUIRED',410);
  } catch(error) { return importFailure(error); }
}

import { requireAuth, requireRole } from '@/globals/utils/auth';
import { prisma } from '@/globals/libs/prisma';
import { commitStudentImport } from '@/features/students/import/server';
import { readImportBody, importSuccess, importFailure } from '@/features/students/import/http';
export const maxDuration = 180;
export async function POST(request:Request) {
  try {
    const actor=await requireAuth();
    requireRole(actor,'ADMIN');
    const input = await readImportBody(request);
    if (request.headers.get('accept')?.includes('application/x-ndjson')) {
      let closed = false;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (value: unknown) => {
            if (closed) return;
            try { controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); } catch { closed = true; }
          };
          try {
            const result = await commitStudentImport(prisma,input,actor, progress => send({ type: 'progress', ...progress }));
            send({ type: 'result', envelope: await importSuccess(result).json() });
          } catch (error) {
            send({ type: 'result', envelope: await importFailure(error).json() });
          } finally {
            if (!closed) { closed = true; controller.close(); }
          }
        },
        // A dropped connection does not cancel database work or assert rollback.
        cancel() { closed = true; },
      });
      return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
    }
    return importSuccess(await commitStudentImport(prisma,input,actor));
  } catch(error) { return importFailure(error); }
}

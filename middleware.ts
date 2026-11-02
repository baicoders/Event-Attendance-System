import { NextResponse, type NextRequest } from 'next/server';
import { requestOriginProblem } from '@/globals/utils/requestOrigin';

export function middleware(req: NextRequest) {
  const origins = process.env.APP_ORIGINS?.split(',').map(v => v.trim()).filter(Boolean) ?? [];
  const problem = requestOriginProblem(req, origins);
  if (problem) return NextResponse.json({ success: false, code: problem, message: 'Request origin could not be verified. Refresh and try again.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/api/:path*'] };

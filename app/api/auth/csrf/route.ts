import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
export async function GET() {
  const token = randomBytes(32).toString('hex');
  const response = NextResponse.json({ success: true, data: { token } }, { headers: { 'Cache-Control': 'private, no-store' } });
  response.cookies.set(process.env.NODE_ENV === 'production' ? '__Host-school-csrf' : 'school-csrf', token, { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 3600 });
  return response;
}

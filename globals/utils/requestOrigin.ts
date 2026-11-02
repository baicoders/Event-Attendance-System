const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function cookieValue(raw: string, key: string) {
  return raw.split(';').map(value => value.trim()).find(value => value.startsWith(`${key}=`))?.slice(key.length + 1);
}
/** Browser provenance or double-submit token is required for credentialed writes. */
export function requestOriginProblem(req: Request, canonicalOrigins: string[] = []): 'CROSS_SITE_REQUEST' | 'CSRF_TOKEN_REQUIRED' | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  const url = new URL(req.url);
  const host = req.headers.get('host');
  // NextRequest normalizes loopback addresses to localhost; Host retains the browser target.
  if (host && !/^[a-z0-9.:[\]-]+$/i.test(host)) return 'CROSS_SITE_REQUEST';
  const requestOrigin = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
  const allowed = canonicalOrigins.length ? canonicalOrigins : [requestOrigin];
  if (site === 'cross-site' || (origin !== null && !allowed.includes(origin))) return 'CROSS_SITE_REQUEST';
  const cookies = req.headers.get('cookie') ?? '';
  if (!cookieValue(cookies, 'event-attendance-auth') || origin !== null || site === 'same-origin') return null;
  const token = req.headers.get('x-csrf-token');
  if (token && /^[a-f0-9]{64}$/.test(token) && (cookieValue(cookies, '__Host-school-csrf') === token || cookieValue(cookies, 'school-csrf') === token)) return null;
  return 'CSRF_TOKEN_REQUIRED';
}

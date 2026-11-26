// Node HTTP tests model a same-origin browser. Explicit cross-origin tests are preserved.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return originalFetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('origin')) headers.set('origin', new URL(input instanceof Request ? input.url : String(input)).origin);
  return originalFetch(input, { ...init, headers });
};

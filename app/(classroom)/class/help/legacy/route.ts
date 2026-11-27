export function GET() {
  return new Response(null, {
    status: 307,
    headers: { Location: "/class/help", "Cache-Control": "private, no-store" },
  });
}

export const HEAD = GET;

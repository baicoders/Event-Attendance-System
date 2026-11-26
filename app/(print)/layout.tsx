/**
 * Layout for printable documents.
 *
 * Deliberately bare. The `(main)` layout mounts the sidebar, the mobile top bar,
 * the bottom nav, a slate page background and a `pb-24` gutter, and gates render
 * behind a client-side auth check that flashes "Checking access…" first. All of
 * that is wrong for a document meant to be sent straight to a printer — the nav
 * chrome carries `print:hidden` so it wouldn't reach paper, but it still framed
 * the on-screen preview and delayed the first paint.
 *
 * Pages under here authenticate on the server instead, which is the stronger
 * boundary anyway: the `(main)` layout is a client component and never protected
 * a direct request to a server route.
 */
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-white text-black print:min-h-0">{children}</div>;
}

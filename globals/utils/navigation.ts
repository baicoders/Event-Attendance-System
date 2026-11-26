/** Select one destination, matching complete path segments. Classroom home is exact. */
export function deepestNavigationRoute(pathname: string, routes: readonly string[]): string | undefined {
 return routes.filter(route => pathname === route || (route !== '/class' && pathname.startsWith(route + '/'))).sort((a,b) => b.length-a.length)[0];
}

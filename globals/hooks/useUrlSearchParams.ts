"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Small helper for refresh-persistent, shareable page state kept in the URL.
 *
 * `setParams` applies a set of changes (a string value sets the param, `null`
 * deletes it) while preserving every unrelated parameter. It uses
 * `router.replace(..., { scroll: false })` so high-frequency UI updates neither
 * spam the history stack nor jump the scroll position, and it skips the replace
 * entirely when nothing actually changed - which is what keeps effect-driven
 * writers (e.g. the calendar's datesSet) from looping.
 */
export function useUrlSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      // Read the *live* URL (not the possibly-stale React snapshot) so that two
      // writers firing in the same tick - e.g. the calendar's datesSet handler
      // and the create=1 consumer - compose instead of clobbering each other
      // (which previously resurrected a just-removed param).
      const params = new URLSearchParams(window.location.search);
      let changed = false;

      for (const [key, value] of Object.entries(changes)) {
        const current = params.get(key);
        if (value === null) {
          if (current !== null) {
            params.delete(key);
            changed = true;
          }
        } else if (current !== value) {
          params.set(key, value);
          changed = true;
        }
      }

      if (!changed) return;

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  return { searchParams, setParams };
}

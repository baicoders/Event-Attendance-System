"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";

import { ApiError } from "@/globals/utils/api";

/** Never retry auth, conflict, or rate-limit failures — they never heal. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (
      error.status === 401 ||
      error.status === 403 ||
      error.status === 409 ||
      error.status === 429
    ) {
      return false;
    }
  }
  return failureCount < 1;
}

/**
 * When the held session is revoked or restricted, cancel in-flight protected
 * queries and drop their caches so a late success cannot repopulate a cleared
 * account's views. Fresh queries refetch under the new session automatically.
 */
function AuthCacheSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onInvalid = () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    };
    window.addEventListener("auth:session-invalid", onInvalid);
    return () => window.removeEventListener("auth:session-invalid", onInvalid);
  }, [queryClient]);

  return null;
}

const QueryProvider = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Metadata (events, students, stats) rarely changes second to
            // second; a short stale window prevents redundant refetches while
            // mutations still invalidate precisely for freshness where needed.
            staleTime: 60_000,
            // Refetching every time the tab regains focus is wasteful here and
            // caused visible reloads; rely on staleTime + explicit invalidation.
            refetchOnWindowFocus: false,
            retry: shouldRetry,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthCacheSync />
      {children}
    </QueryClientProvider>
  );
};

export default QueryProvider;

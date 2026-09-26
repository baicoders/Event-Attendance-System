"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventCategory } from "@prisma/client";
import type { AudiencePreview } from "@/globals/types/audiencePreview";
import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";

type Scope = { category: EventCategory; includedGroups: string[]; eventId?: string };

function requestPreview(scope: Scope, search: string, page: number, pageSize: number, includeRoster: boolean, signal: AbortSignal) {
  return fetchApi<AudiencePreview>("/api/events/audience-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...scope, search, page, pageSize, includeRoster }),
    signal,
  });
}

export function useAudiencePreview(scope: Scope, enabled: boolean, rosterOpen: boolean) {
  const sortedIds = [...new Set(scope.includedGroups)].sort();
  const signature = JSON.stringify([scope.category, sortedIds]);
  const [debouncedSignature, setDebouncedSignature] = useState(signature);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSignature(signature), 250);
    return () => clearTimeout(timer);
  }, [signature]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [signature, debouncedSearch]);

  const valid = ["ALL", "COLLEGE", "SHS"].includes(scope.category) || sortedIds.length > 0;
  const current = signature === debouncedSignature;
  const queryScope = { ...scope, includedGroups: sortedIds };
  const count = useQuery({
    queryKey: queryKeys.audience.count(debouncedSignature, scope.eventId),
    queryFn: ({ signal }) => requestPreview(queryScope, "", 1, pageSize, false, signal),
    enabled: enabled && valid && current,
    staleTime: 0,
  });
  const roster = useQuery({
    queryKey: [...queryKeys.audience.roster(debouncedSignature, debouncedSearch, page, scope.eventId), pageSize],
    queryFn: ({ signal }) => requestPreview(queryScope, debouncedSearch, page, pageSize, true, signal),
    enabled: enabled && rosterOpen && valid && current && search === debouncedSearch,
    staleTime: 0,
  });

  return { count, roster, valid, current, search, setSearch, page, setPage, pageSize,
    setPageSize: (size: number) => { setPage(1); setPageSize(size); },
    searchCurrent: search === debouncedSearch };
}

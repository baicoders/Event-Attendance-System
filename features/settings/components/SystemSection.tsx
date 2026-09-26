"use client";

import { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/globals/components/shad-cn/alert";
import { Skeleton } from "@/globals/components/shad-cn/skeleton";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { surface, type as typeToken } from "@/globals/constants/designTokens";
import { cn } from "@/globals/libs/shad-cn";
import { useSystemInfo } from "@/globals/hooks/useAdmin";

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
    <dt className="text-sm text-slate-500">{label}</dt>
    <dd className="text-right text-sm font-medium text-slate-900">{children}</dd>
  </div>
);

/**
 * Read-only environment health, so an operator can answer "which database am I
 * on and is this configured properly?" without a terminal. The route reports
 * whether configuration is valid; it never returns a secret's value.
 */
const SystemSection = () => {
  const { data, isLoading, isError } = useSystemInfo();

  if (isLoading) {
    return (
      <section className={cn(surface.card, "p-6")}>
        <h2 className={typeToken.sectionTitle}>System</h2>
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className={cn(surface.card, "p-6")}>
        <h2 className={typeToken.sectionTitle}>System</h2>
        <p className={cn(typeToken.muted, "mt-2")}>
          Couldn&apos;t read system information.
        </p>
      </section>
    );
  }

  const { authSecret } = data;
  const secretIsHealthy = authSecret.configured && authSecret.meetsMinLength;

  return (
    <section className={cn(surface.card, "p-6")}>
      <h2 className={typeToken.sectionTitle}>System</h2>
      <p className={cn(typeToken.muted, "mt-1")}>
        What this server is actually running against.
      </p>

      {!secretIsHealthy ? (
        <Alert variant="destructive" className="mt-4">
          <ShieldAlert />
          <AlertTitle>AUTH_SECRET is not set properly</AlertTitle>
          <AlertDescription>
            {authSecret.usingDevFallback
              ? "Sessions are signed with the shared development fallback. Set AUTH_SECRET to at least 16 characters before running a production build — otherwise the server refuses to start and reports it as a database error."
              : "Set AUTH_SECRET to at least 16 characters and restart the server."}
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="mt-4">
        <Row label="Environment">
          <StatusBadge
            tone={data.nodeEnv === "production" ? "success" : "warning"}
          >
            {data.nodeEnv}
          </StatusBadge>
        </Row>
        <Row label="Database">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {data.database.database}
          </code>
        </Row>
        <Row label="PostgreSQL">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {data.database.serverVersion}
          </code>
        </Row>
        <Row label="AUTH_SECRET">
          <StatusBadge tone={secretIsHealthy ? "success" : "danger"} withDot>
            {secretIsHealthy ? "Configured" : "Missing or too short"}
          </StatusBadge>
        </Row>
        <Row label="App version">{data.appVersion}</Row>
        <Row label="Server clock">
          {new Date(data.serverTime).toLocaleString()}
        </Row>
      </dl>

      <p className={cn(typeToken.muted, "mt-3 text-xs")}>
        Compare the server clock against a phone before an event — a wrong host
        clock silently produces wrong attendance timestamps.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Students", data.counts.students],
            ["Groups", data.counts.groups],
            ["Events", data.counts.events],
            ["Records", data.counts.records],
            ["Users", data.counts.users],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center"
          >
            <p className="text-lg font-semibold tabular-nums text-slate-900">
              {value}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              {label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default SystemSection;

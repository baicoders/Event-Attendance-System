"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Plus,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";

import { Button } from "@/globals/components/shad-cn/button";
import {
  toastDanger,
  toastSuccess,
  toastWarning,
} from "@/globals/components/shared/toasts";
import { useAuth } from "@/globals/contexts/AuthContext";
import {
  PendingOrganizer,
  useApproveOrganizer,
  usePendingOrganizers,
  useRejectOrganizer,
} from "@/globals/hooks/useAdmin";
import useEvents, {
  useApproveEvent,
  useRejectEvent,
} from "@/globals/hooks/useEvents";
import { Event } from "@/globals/types/events";
import { cn } from "@/globals/libs/shad-cn";
import { page } from "@/globals/constants/designTokens";
import RejectionDialog from "@/globals/components/shared/RejectionDialog";

const formatDateTime = (dateValue: Date | string) =>
  new Date(dateValue).toLocaleString();

type MetricTone = "blue" | "emerald" | "amber" | "rose";

type MetricCardProps = {
  label: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  tone: MetricTone;
};

type StatusSection = {
  status: Event["status"];
  title: string;
  empty: string;
};

type StatusMeta = {
  title: string;
  description: string;
  icon: LucideIcon;
  chipClass: string;
  glowClass: string;
};

const toneMap: Record<MetricTone, { iconWrap: string }> = {
  blue: { iconWrap: "bg-blue-50 text-blue-700" },
  emerald: { iconWrap: "bg-emerald-50 text-emerald-700" },
  amber: { iconWrap: "bg-amber-50 text-amber-700" },
  rose: { iconWrap: "bg-rose-50 text-rose-700" },
};

const MetricCard = ({
  label,
  value,
  description,
  icon: Icon,
  tone,
}: MetricCardProps) => {
  const toneStyle = toneMap[tone];

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_16px_32px_rgba(15,23,42,0.06)] sm:rounded-2xl sm:p-5">
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-indigo-600 sm:text-xs sm:tracking-[0.16em]">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold leading-none text-slate-900 sm:mt-2 sm:text-4xl">
            {value}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 sm:mt-2 sm:text-xs">
            {description}
          </p>
        </div>
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-11 sm:rounded-xl",
            toneStyle.iconWrap
          )}
        >
          <Icon className="size-4 sm:size-5" />
        </div>
      </div>
    </article>
  );
};

type SectionCardProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
};

const SectionCard = ({ title, subtitle, children }: SectionCardProps) => (
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.06)]">
    <header className="border-b border-slate-100 px-5 py-4 sm:px-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </header>
    {children}
  </section>
);

const DashboardPage = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center bg-white text-slate-600">
        Loading dashboard...
      </main>
    );
  }

  if (!user) {
    return null;
  }

  if (user.role === "ADMIN") {
    return <AdminDashboard />;
  }

  return <OrganizerDashboard />;
};

const AdminDashboard = () => {
  const { data, isLoading, isError } = usePendingOrganizers();
  const { data: events, isLoading: isEventsLoading } = useEvents();
  const approveEvent = useApproveEvent();
  const rejectEvent = useRejectEvent();
  const approve = useApproveOrganizer();
  const reject = useRejectOrganizer();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] =
    useState<"APPROVE" | "REJECT" | null>(null);
  const [processingEventId, setProcessingEventId] = useState<string | null>(null);
  const [processingEventAction, setProcessingEventAction] =
    useState<"APPROVE" | "REJECT" | null>(null);
  const [organizerRejectionTarget, setOrganizerRejectionTarget] =
    useState<PendingOrganizer | null>(null);
  const [organizerRejectionReason, setOrganizerRejectionReason] = useState("");
  const [eventRejectionTarget, setEventRejectionTarget] = useState<Event | null>(null);
  const [eventRejectionReason, setEventRejectionReason] = useState("");

  const handleApprove = (organizerId: string) => {
    setProcessingId(organizerId);
    setProcessingAction("APPROVE");
    approve.mutate(
      { id: organizerId },
      {
        onSuccess: () => {
          toastSuccess("Organizer approved", "They can now sign in.");
        },
        onError: (error) => {
          toastDanger(
            "Approval failed",
            error instanceof Error ? error.message : undefined
          );
        },
        onSettled: () => {
          setProcessingId(null);
          setProcessingAction(null);
        },
      }
    );
  };

  const handleReject = (organizer: PendingOrganizer) => {
    setOrganizerRejectionTarget(organizer);
    setOrganizerRejectionReason(
      organizer.rejectionReason ?? "Incomplete requirements"
    );
  };

  const handleConfirmOrganizerReject = () => {
    if (!organizerRejectionTarget) return;

    const reason = organizerRejectionReason.trim();
    if (!reason) {
      toastWarning("Rejection reason required");
      return;
    }

    setProcessingId(organizerRejectionTarget.id);
    setProcessingAction("REJECT");
    reject.mutate(
      { id: organizerRejectionTarget.id, reason },
      {
        onSuccess: () => {
          toastSuccess("Organizer rejected", reason);
          setOrganizerRejectionTarget(null);
          setOrganizerRejectionReason("");
        },
        onError: (error) => {
          toastDanger(
            "Rejection failed",
            error instanceof Error ? error.message : undefined
          );
        },
        onSettled: () => {
          setProcessingId(null);
          setProcessingAction(null);
        },
      }
    );
  };

  const handleOpenEventReject = (event: Event) => {
    setEventRejectionTarget(event);
    setEventRejectionReason(event.rejectionReason ?? "Needs revisions");
  };

  const handleConfirmEventReject = () => {
    if (!eventRejectionTarget) return;

    const reason = eventRejectionReason.trim();
    if (!reason) {
      toastWarning("Rejection reason required");
      return;
    }

    setProcessingEventId(eventRejectionTarget.id);
    setProcessingEventAction("REJECT");
    rejectEvent.mutate(
      { id: eventRejectionTarget.id, reason },
      {
        onSuccess: () => {
          toastSuccess("Event rejected", reason);
          setEventRejectionTarget(null);
          setEventRejectionReason("");
        },
        onError: (error) => {
          toastDanger(
            "Rejection failed",
            error instanceof Error ? error.message : undefined
          );
        },
        onSettled: () => {
          setProcessingEventId(null);
          setProcessingEventAction(null);
        },
      }
    );
  };

  const pendingCount = data?.length ?? 0;
  const pendingEventsCount =
    events?.filter((event) => event.status === "PENDING").length ?? 0;
  const pendingEvents = events?.filter((event) => event.status === "PENDING") ?? [];

  const organizerActionStatus = processingAction
    ? `${processingAction} in progress`
    : "Idle";
  const eventActionStatus = processingEventAction
    ? `${processingEventAction} in progress`
    : "Idle";

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-[linear-gradient(120deg,#0f172a_0%,#1e3a8a_45%,#4f46e5_100%)] p-6 text-white shadow-[0_20px_45px_rgba(30,64,175,0.25)]">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">
          Admin Overview
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Approval Command Center
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-blue-100/90">
          Review organizer registrations and event submissions with clear action
          queues and quick status visibility.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard
          label="Pending Organizers"
          value={pendingCount}
          description={
            pendingCount === 0
              ? "No organizer requests waiting."
              : "Approve or reject to unblock access."
          }
          icon={UserCheck}
          tone="blue"
        />
        <MetricCard
          label="Organizer Actions"
          value={organizerActionStatus}
          description="Action buttons auto-disable while processing."
          icon={Clock3}
          tone="amber"
        />
        <MetricCard
          label="Pending Events"
          value={isEventsLoading ? "--" : pendingEventsCount}
          description={
            pendingEventsCount === 0
              ? "No event submissions waiting."
              : "Review in queue order."
          }
          icon={CalendarClock}
          tone="emerald"
        />
        <MetricCard
          label="Event Actions"
          value={eventActionStatus}
          description="Each event decision includes optional notes."
          icon={ShieldCheck}
          tone="rose"
        />
      </div>

      <SectionCard
        title="Pending Organizer Requests"
        subtitle={
          pendingCount === 0
            ? "All caught up."
            : "Review organizer details and decide access."
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">Organizer</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Requested</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {isLoading || isError ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-500">
                    {isLoading ? "Loading requests..." : "Failed to load requests."}
                  </td>
                </tr>
              ) : pendingCount === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-500">
                    No pending organizers right now.
                  </td>
                </tr>
              ) : (
                data!.map((organizer) => (
                  <tr key={organizer.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{organizer.name}</div>
                      <div className="text-xs text-slate-500">
                        ID: {organizer.id.slice(0, 6)}...
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{organizer.email}</td>
                    <td className="px-6 py-4 text-slate-600">
                      {formatDateTime(organizer.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleApprove(organizer.id)}
                          disabled={
                            approve.isPending ||
                            reject.isPending ||
                            processingId === organizer.id
                          }
                        >
                          <CheckCircle2 className="size-3.5" />
                          {processingId === organizer.id && processingAction === "APPROVE"
                            ? "Approving..."
                            : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleReject(organizer)}
                          disabled={
                            approve.isPending ||
                            reject.isPending ||
                            processingId === organizer.id
                          }
                        >
                          <UserX className="size-3.5" />
                          {processingId === organizer.id && processingAction === "REJECT"
                            ? "Rejecting..."
                            : "Reject"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Pending Event Requests"
        subtitle={
          pendingEventsCount === 0
            ? "No event submissions waiting."
            : "Approve or reject submitted events."
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">Event</th>
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3">Scheduled</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {isEventsLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-500">
                    Loading events...
                  </td>
                </tr>
              ) : pendingEventsCount === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-500">
                    No pending events right now.
                  </td>
                </tr>
              ) : (
                pendingEvents.map((event) => (
                  <tr key={event.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{event.title}</div>
                      {event.organizerName ? (
                        <div className="text-xs text-slate-500">
                          Organizer: {event.organizerName}
                        </div>
                      ) : event.createdById ? (
                        <div className="text-xs text-slate-500">
                          Organizer ID: {event.createdById.slice(0, 6)}...
                        </div>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                        {event.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {formatDateTime(event.start)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            setProcessingEventId(event.id);
                            setProcessingEventAction("APPROVE");
                            approveEvent.mutate(
                              { id: event.id },
                              {
                                onSuccess: () => {
                                  toastSuccess("Event approved", "The event is now live.");
                                },
                                onError: (error) => {
                                  toastDanger(
                                    "Approval failed",
                                    error instanceof Error ? error.message : undefined
                                  );
                                },
                                onSettled: () => {
                                  setProcessingEventId(null);
                                  setProcessingEventAction(null);
                                },
                              }
                            );
                          }}
                          disabled={
                            approveEvent.isPending ||
                            rejectEvent.isPending ||
                            processingEventId === event.id
                          }
                        >
                          <CheckCircle2 className="size-3.5" />
                          {processingEventId === event.id &&
                          processingEventAction === "APPROVE"
                            ? "Approving..."
                            : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleOpenEventReject(event)}
                          disabled={
                            approveEvent.isPending ||
                            rejectEvent.isPending ||
                            processingEventId === event.id
                          }
                        >
                          <CircleAlert className="size-3.5" />
                          {processingEventId === event.id &&
                          processingEventAction === "REJECT"
                            ? "Rejecting..."
                            : "Reject"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <RejectionDialog
        isOpen={!!organizerRejectionTarget}
        title={
          organizerRejectionTarget
            ? `Reject ${organizerRejectionTarget.name}?`
            : "Reject organizer?"
        }
        description="Share a clear reason so the organizer knows what needs to be fixed."
        reason={organizerRejectionReason}
        onReasonChange={setOrganizerRejectionReason}
        onCancel={() => {
          setOrganizerRejectionTarget(null);
          setOrganizerRejectionReason("");
        }}
        onConfirm={handleConfirmOrganizerReject}
        isSubmitting={reject.isPending}
        confirmLabel={reject.isPending ? "Rejecting..." : "Reject organizer"}
        reasonLabel="Rejection message"
        placeholder="Example: Missing required profile details. Please complete your registration information."
      />

      <RejectionDialog
        isOpen={!!eventRejectionTarget}
        title={eventRejectionTarget ? `Reject "${eventRejectionTarget.title}"?` : "Reject event?"}
        description="Add a note for the organizer so they can revise and resubmit quickly."
        reason={eventRejectionReason}
        onReasonChange={setEventRejectionReason}
        onCancel={() => {
          setEventRejectionTarget(null);
          setEventRejectionReason("");
        }}
        onConfirm={handleConfirmEventReject}
        isSubmitting={rejectEvent.isPending}
        confirmLabel={rejectEvent.isPending ? "Rejecting..." : "Reject event"}
        reasonLabel="Rejection message"
        placeholder="Example: Please update the schedule conflict and include a clearer event description."
      />
      </div>
    </section>
  );
};

const OrganizerDashboard = () => {
  const { data: events, isLoading, isError } = useEvents({ scope: "mine" });

  const statusMeta: Record<Event["status"], StatusMeta> = {
    DRAFT: {
      title: "Drafts",
      description: "Finish details before submitting",
      icon: Clock3,
      chipClass: "bg-amber-100 text-amber-700",
      glowClass: "from-amber-500/15 to-transparent",
    },
    PENDING: {
      title: "Pending Review",
      description: "Waiting for admin approval",
      icon: CircleAlert,
      chipClass: "bg-sky-100 text-sky-700",
      glowClass: "from-sky-500/15 to-transparent",
    },
    APPROVED: {
      title: "Approved",
      description: "Ready for attendance and stats",
      icon: CheckCircle2,
      chipClass: "bg-emerald-100 text-emerald-700",
      glowClass: "from-emerald-500/15 to-transparent",
    },
    REJECTED: {
      title: "Rejected",
      description: "Needs revisions before resubmitting",
      icon: UserX,
      chipClass: "bg-rose-100 text-rose-700",
      glowClass: "from-rose-500/15 to-transparent",
    },
  };

  const grouped = useMemo(() => {
    const base: Record<Event["status"], Event[]> = {
      DRAFT: [],
      PENDING: [],
      APPROVED: [],
      REJECTED: [],
    };

    (events ?? []).forEach((event) => {
      base[event.status].push(event);
    });

    return base;
  }, [events]);

  const highlightSections: StatusSection[] = [
    {
      status: "DRAFT",
      title: "Drafts To Finish",
      empty: "No drafts yet. Start planning a new event.",
    },
    {
      status: "PENDING",
      title: "Awaiting Approval",
      empty: "No pending events. Submit one when ready.",
    },
    {
      status: "REJECTED",
      title: "Needs Attention",
      empty: "No rejected events. Great progress.",
    },
  ];

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
      <section className="overflow-hidden rounded-3xl border border-indigo-200/60 bg-[linear-gradient(130deg,#1e1b4b_0%,#1d4ed8_50%,#4f46e5_100%)] p-6 text-white shadow-[0_24px_50px_rgba(30,64,175,0.25)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
              Organizer Overview
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Event Workflow Tracker
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-blue-100/90">
              Monitor every event from draft to approval, then move quickly into
              attendance operations.
            </p>
          </div>
          <Button
            asChild
            className="h-11 rounded-xl bg-white text-indigo-700 shadow-lg transition hover:bg-indigo-50"
          >
            <Link href="/calendar?create=1" className="inline-flex items-center gap-2">
              <Plus className="size-4" />
              Create event
            </Link>
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Object.entries(grouped).map(([status, items]) => {
          const typedStatus = status as Event["status"];
          const meta = statusMeta[typedStatus];
          const Icon = meta.icon;

          return (
            <article
              key={status}
              className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-[0_16px_32px_rgba(15,23,42,0.06)] sm:rounded-2xl sm:p-5"
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br",
                  meta.glowClass
                )}
              />
              <div className="relative">
                <div className="flex items-start justify-between gap-2 sm:gap-3">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.12em]",
                      meta.chipClass
                    )}
                  >
                    {meta.title}
                  </span>
                  <div className="shrink-0 rounded-lg bg-slate-100 p-1.5 text-slate-600 sm:rounded-xl sm:p-2">
                    <Icon className="size-3.5 sm:size-4.5" />
                  </div>
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900 sm:mt-4 sm:text-4xl">
                  {isLoading ? "--" : items.length}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 sm:text-xs">
                  {meta.description}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {highlightSections.map((section) => {
          const list = grouped[section.status];
          const meta = statusMeta[section.status];

          return (
            <article
              key={section.status}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.06)]"
            >
              <header className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {section.title}
                  </h2>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      meta.chipClass
                    )}
                  >
                    {meta.title}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {section.status === "DRAFT"
                    ? "Complete details and submit for approval."
                    : section.status === "PENDING"
                    ? "Admins review events in submission order."
                    : "Rejected events include reasons for quick revisions."}
                </p>
              </header>

              <div className="space-y-3 px-5 py-4">
                {isLoading ? (
                  <p className="text-sm text-slate-500">Loading events...</p>
                ) : list.length === 0 ? (
                  <p className="text-sm text-slate-400">{section.empty}</p>
                ) : (
                  list.slice(0, 5).map((event) => (
                    <article
                      key={event.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100/70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            {event.title}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDateTime(event.start)} | {event.category}
                          </p>
                        </div>
                        <Link
                          href="/calendar"
                          className="rounded-lg bg-white p-1.5 text-slate-500 shadow-sm transition hover:text-indigo-600"
                          aria-label={`Open ${event.title} in calendar`}
                          title="Open in calendar"
                        >
                          <ArrowUpRight className="size-4" />
                        </Link>
                      </div>
                      {section.status === "REJECTED" && event.rejectionReason ? (
                        <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                          {event.rejectionReason}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}

                {list.length > 5 ? (
                  <p className="text-xs text-slate-500">
                    + {list.length - 5} more {section.title.toLowerCase()}.
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_32px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-indigo-100 p-2 text-indigo-700">
              <CalendarClock className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Next best action
              </h3>
              <p className="text-sm text-slate-500">
                Keep drafts moving and clear rejections quickly to reduce event
                delays.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/calendar">
              Open calendar
              <ArrowUpRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>
      </section>

      {isError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Failed to load events. Please refresh the page.
        </p>
      ) : null}
      </div>
    </section>
  );
};

export default DashboardPage;

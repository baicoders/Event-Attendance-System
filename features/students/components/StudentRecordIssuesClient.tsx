"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, type FieldPath } from "react-hook-form";
import { YearLevel } from "@prisma/client";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  House,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useFetchStudents } from "@/globals/hooks/useStudents";
import { Button } from "@/globals/components/shad-cn/button";
import FormInput from "@/globals/components/shared/FormInput";
import FormSelect from "@/globals/components/shared/FormSelect";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import DataTable from "@/globals/components/shared/dataTable/DataTable";
import {
  DataTableEmptyState,
  DataTableErrorState,
  DataTableFilteredEmptyState,
} from "@/globals/components/shared/dataTable/DataTableStates";
import { surface, type as typeToken } from "@/globals/constants/designTokens";
import { labelForGroup } from "@/globals/constants/groups";
import type { Option } from "@/globals/types/primitives";
import {
  getStudentDataIssues,
  isEmployeeRecord,
  matchesStudentIssueSearch,
  STUDENT_ISSUE_LABELS,
  type StudentIssueCode,
} from "../issues/dataIssues";
import {
  parseIssueFilters,
  optionsWithCurrentSelection,
  type IssueFilters,
} from "../issues/filters";
import {
  getStudentIssueColumns,
  issueProfileHref,
  studentAcademicLabel,
} from "../constants/studentIssueColumns";
import StudentDataIssueBadges from "./StudentDataIssueBadges";

function AuthorizedIssues({ params }: { params: URLSearchParams }) {
  const query = useFetchStudents();
  const router = useRouter();
  const filters = parseIssueFilters(params);
  const methods = useForm<IssueFilters>({ defaultValues: filters });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const entries = useMemo(
    () =>
      (query.data ?? [])
        .filter((student) => !isEmployeeRecord(student))
        .map((student) => ({ student, issues: getStudentDataIssues(student) })),
    [query.data],
  );
  const groupOptions = (category: string) =>
    [
      ...new Map(
        entries.flatMap(({ student }) =>
          (student.groups ?? [])
            .filter((group) => group.category === category)
            .map((group) => [group.slug, group.name]),
        ),
      ).entries(),
    ]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  const summary = {
    total: entries.length,
    complete: entries.filter((entry) => !entry.issues.length).length,
    attention: entries.filter((entry) => entry.issues.length).length,
    house: entries.filter((entry) => entry.issues.includes("MISSING_HOUSE"))
      .length,
    other: entries.filter((entry) =>
      entry.issues.some((code) => code !== "MISSING_HOUSE"),
    ).length,
  };
  const filtered = entries
    .filter(({ student, issues }) => {
      if (!matchesStudentIssueSearch(student, filters.q)) return false;
      if (
        filters.schoolLevel &&
        (filters.schoolLevel === "missing"
          ? !!student.schoolLevel
          : student.schoolLevel !== filters.schoolLevel)
      )
        return false;
      if (filters.issue && !issues.includes(filters.issue as StudentIssueCode))
        return false;
      if (filters.house === "missing" && !issues.includes("MISSING_HOUSE"))
        return false;
      if (filters.missingIdentifier === "usn" && student.usn) return false;
      if (filters.missingIdentifier === "lrn" && student.lrn) return false;
      if (filters.missingIdentifier === "both" && (student.usn || student.lrn))
        return false;
      if (filters.recordStatus === "complete" && issues.length) return false;
      if (filters.recordStatus === "attention" && !issues.length) return false;
      if (filters.yearLevel && student.yearLevel !== filters.yearLevel)
        return false;
      for (const [field, category] of [
        ["program", "PROGRAM"],
        ["section", "SECTION"],
      ] as const)
        if (
          filters[field] &&
          !student.groups?.some(
            (group) =>
              group.category === category && group.slug === filters[field],
          )
        )
          return false;
      return true;
    })
    .map((entry) => entry.student)
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName) ||
        a.id.localeCompare(b.id),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);
  const returnTo = `/students/issues${params.size ? `?${params}` : ""}`;
  const columns = useMemo(() => getStudentIssueColumns(returnTo), [returnTo]);
  const reset = () => router.push("/students/issues");
  const isFiltered = Object.values(filters).some(Boolean);
  const apply = methods.handleSubmit((values) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value?.trim()) next.set(key, value.trim());
    router.push(`/students/issues${next.size ? `?${next}` : ""}`);
  });
  const select = (
    name: FieldPath<IssueFilters>,
    label: string,
    options: Option[],
  ) => (
    <FormSelect
      name={name}
      label={label}
      options={optionsWithCurrentSelection(options, methods.getValues(name))}
      control={methods.control}
      clearable
      clearLabel="All"
      placeholder="All"
    />
  );
  const cards = [
    { label: "Total students", count: summary.total, Icon: Users },
    { label: "Complete records", count: summary.complete, Icon: CheckCircle2 },
    {
      label: "Needing attention",
      count: summary.attention,
      Icon: ClipboardList,
    },
    { label: "Missing House", count: summary.house, Icon: House },
    {
      label: "Other information gaps",
      count: summary.other,
      Icon: AlertCircle,
    },
  ];
  return (
    <div className="space-y-6">
      <div
        aria-label="Student record summary"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        {cards.map(({ label, count, Icon }) => (
          <div
            key={label}
            className={`${surface.card} flex items-start gap-3 p-4`}
          >
            <span className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
              <Icon className="size-5" strokeWidth={1.6} />
            </span>
            <div>
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {query.isLoading
                  ? "…"
                  : query.isError
                    ? "—"
                    : count.toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
      <section
        className={`${surface.panel} p-5 md:p-6`}
        aria-label="Record issue filters"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={typeToken.sectionTitle}>Find records to complete</h2>
            <p className="mt-1 text-sm text-slate-500">
              Use confirmed school information. Either USN or LRN is a valid
              identifier.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={`size-4 ${query.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
        <form onSubmit={apply} aria-label="Filter student record issues">
          <fieldset
            disabled={query.isLoading}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <FormInput
              label="Search name / USN / LRN"
              {...methods.register("q")}
              maxLength={100}
              placeholder="Name or student code"
            />
            {select("schoolLevel", "School level", [
              { value: "SHS", label: "Senior High School" },
              { value: "COLLEGE", label: "College" },
              { value: "missing", label: "Not provided" },
            ])}
            {select(
              "issue",
              "Record issue",
              Object.entries(STUDENT_ISSUE_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            )}
            {select("house", "House assignment", [
              { value: "missing", label: "Missing House" },
            ])}
            {select("missingIdentifier", "Missing identifier", [
              { value: "usn", label: "No USN" },
              { value: "lrn", label: "No LRN" },
              { value: "both", label: "Neither identifier" },
            ])}
            {select("recordStatus", "Completeness", [
              { value: "attention", label: "Needs attention" },
              { value: "complete", label: "Complete" },
            ])}
            {select(
              "yearLevel",
              "Year / Grade",
              Object.values(YearLevel).map((value) => ({
                value,
                label: labelForGroup("YEAR", value),
              })),
            )}
            {select("program", "Program", groupOptions("PROGRAM"))}
            {select("section", "Section", groupOptions("SECTION"))}
          </fieldset>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={query.isLoading}>
              <Search className="size-4" />
              Apply filters
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={reset}
              disabled={!isFiltered}
            >
              Reset filters
            </Button>
          </div>
        </form>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Open a profile to resolve its missing information.
        </p>
        <StatusBadge tone="primary">
          {filtered.length} matching students
        </StatusBadge>
      </div>
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={visible}
          isLoading={query.isLoading}
          isError={query.isError}
          errorState={
            <div role="alert">
              <DataTableErrorState />
              <Button variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          }
          showToolbar={false}
          getRowId={(student) => student.id}
          emptyState={
            <DataTableEmptyState
              title="No student records"
              description="Create a student or import the school roster to get started."
            />
          }
          filteredEmptyState={<DataTableFilteredEmptyState onClear={reset} />}
          manual={{
            pageIndex: current,
            pageSize,
            rowCount: filtered.length,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPage(0);
              setPageSize(size);
            },
            sorting: [],
            onSortingChange: () => {},
            isPending: query.isFetching,
            isFiltered,
          }}
        />
      </div>
      <div className="space-y-3 md:hidden">
        {query.isLoading ? (
          <p role="status">Loading student records…</p>
        ) : query.isError ? (
          <div role="alert">
            <DataTableErrorState />
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : !visible.length ? (
          isFiltered ? (
            <DataTableFilteredEmptyState onClear={reset} />
          ) : (
            <DataTableEmptyState title="No student records" />
          )
        ) : (
          visible.map((student) => (
            <article
              key={student.id}
              className={`${surface.card} space-y-3 p-4`}
            >
              <div>
                <h3 className="font-semibold text-slate-900">
                  {student.lastName},{" "}
                  {[student.firstName, student.middleName]
                    .filter(Boolean)
                    .join(" ")}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {studentAcademicLabel(student)}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="font-medium text-slate-500">USN</dt>
                  <dd className="mt-1 break-all font-mono">
                    {student.usn || "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">LRN</dt>
                  <dd className="mt-1 break-all font-mono">
                    {student.lrn || "Not provided"}
                  </dd>
                </div>
              </dl>
              <StudentDataIssueBadges student={student} />
              <Button asChild variant="outline" size="sm">
                <Link href={issueProfileHref(student, returnTo)}>
                  Edit record
                </Link>
              </Button>
            </article>
          ))
        )}
        {!query.isLoading && !query.isError && (
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="outline"
              disabled={!current || query.isFetching}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <span className="text-xs">
              Page {current + 1} of {pages}
            </span>
            <Button
              variant="outline"
              disabled={current + 1 === pages || query.isFetching}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
export default function StudentRecordIssuesClient() {
  const { user, isLoading } = useAuth();
  const params = useSearchParams();
  if (isLoading) return <p role="status">Checking access…</p>;
  if (
    !user ||
    user.role !== "ADMIN" ||
    user.status !== "ACTIVE" ||
    user.mustChangePassword
  )
    return <p role="alert">An active administrator account is required.</p>;
  return (
    <AuthorizedIssues
      key={`${user.id}:${params}`}
      params={new URLSearchParams(params)}
    />
  );
}

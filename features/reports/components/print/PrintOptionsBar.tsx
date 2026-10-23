"use client";

import { Printer } from "lucide-react";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Switch } from "@/globals/components/shad-cn/switch";
import { Label } from "@/globals/components/shad-cn/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/globals/components/shad-cn/select";
import { pill } from "@/globals/constants/designTokens";
import { GROUP_DIMENSIONS } from "@/globals/utils/reportGroups";
import { PRINT_COLUMNS, resolvePrintColumns, setPrintColumn, type PrintColumnKey } from "@/features/reports/utils/printColumns";

type Toggle = {
  key: string;
  label: string;
  /** What the option is when the parameter is absent. */
  defaultOn: boolean;
};

const TOGGLES: Toggle[] = [
  { key: "absentees", label: "Include absentees", defaultOn: true },
  { key: "grouped", label: "Group by section", defaultOn: true },
];

/**
 * On-screen controls for the printable sheet. Never printed (`.no-print`).
 *
 * Options live in the URL rather than in React state so the page itself can stay
 * a server component — it reads `searchParams` and renders the finished document,
 * with no report logic shipped to the browser. It also makes a particular
 * configuration a shareable, bookmarkable link.
 */
const PrintOptionsBar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const summary = searchParams.get("view") === "summary";
  const columns = resolvePrintColumns(searchParams.has("columns") ? searchParams.getAll("columns") : undefined, searchParams.get("signature") ?? undefined);

  const navigate = (params: URLSearchParams) => {
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
    navigate(params);
  };

  const isOn = (toggle: Toggle) => {
    const value = searchParams.get(toggle.key);
    if (value === null) return toggle.defaultOn;
    return value !== "0";
  };

  const setToggle = (toggle: Toggle, next: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    // Keep the URL clean: only record a value when it differs from the default.
    if (next === toggle.defaultOn) params.delete(toggle.key);
    else params.set(toggle.key, next ? "1" : "0");

    navigate(params);
  };

  const toggleColumn = (key: PrintColumnKey, enabled: boolean) => navigate(setPrintColumn(new URLSearchParams(searchParams.toString()), key, enabled));

  return (
    <div className="no-print sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
      <Select disabled={pending} value={summary ? "summary" : "sheet"} onValueChange={(value) => setParam("view", value === "sheet" ? null : value)}>
        <SelectTrigger aria-label="Print view" className="w-52"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="sheet">Attendance sheet</SelectItem><SelectItem value="summary">Event summary</SelectItem></SelectContent>
      </Select>
      {summary ? <Select disabled={pending} value={searchParams.get("groupBy") ?? "SECTION"} onValueChange={(value) => setParam("groupBy", value)}>
        <SelectTrigger aria-label="Group summary by" className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent>{GROUP_DIMENSIONS.map((dimension) => <SelectItem key={dimension} value={dimension}>{dimension}</SelectItem>)}</SelectContent>
      </Select> : TOGGLES.map((toggle) => (
        <div key={toggle.key} className="flex items-center gap-2">
          <Switch
            id={`print-${toggle.key}`}
            checked={isOn(toggle)}
            disabled={pending}
            onCheckedChange={(next) => setToggle(toggle, next)}
          />
          <Label htmlFor={`print-${toggle.key}`} className="text-sm text-slate-600">
            {toggle.label}
          </Label>
        </div>
      ))}

      {!summary ? (
        <fieldset disabled={pending} className="order-last flex w-full flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-2">
          <legend className="px-1 text-xs font-medium text-slate-600">Print columns</legend>
          {PRINT_COLUMNS.map((column) => (
            <label key={column.key} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={columns.includes(column.key)}
                disabled={columns.length === 1 && columns[0] === column.key}
                onChange={(event) => toggleColumn(column.key, event.target.checked)}
                className="h-4 w-4 accent-slate-900"
              />
              {column.label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <button
        type="button"
        disabled={pending}
        onClick={() => window.print()}
        className={`${pill.primary} ml-auto`}
      >
        <Printer className="h-4 w-4" />
        Print
      </button>
    </div>
  );
};

export default PrintOptionsBar;

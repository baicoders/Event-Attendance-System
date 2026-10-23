"use client";

import type { EventCategory } from "@prisma/client";

import DateRangePicker, {
  type DateRange,
  toDateInput,
} from "@/globals/components/shared/DateRangePicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/globals/components/shad-cn/select";
import { pill, surface } from "@/globals/constants/designTokens";
import { capitalizeLabel } from "@/globals/utils/text";

const CATEGORIES: EventCategory[] = [
  "CUSTOM",
  "ALL",
  "COLLEGE",
  "SHS",
  "DEPARTMENT",
  "HOUSE",
  "STRAND",
  "PROGRAM",
  "SECTION",
  "YEAR",
];

/** Sentinel for "no category filter" — Radix Select rejects an empty-string value. */
const ANY_CATEGORY = "__ANY__";

type DateRangeControlsProps = {
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  category?: EventCategory;
  onCategoryChange: (category?: EventCategory) => void;
};

/** Presets covering the deployment's real horizon: a school week, then a month. */
const presets = [
  { label: "7 days", days: 6 },
  { label: "30 days", days: 29 },
  { label: "90 days", days: 89 },
];

const DateRangeControls = ({
  range,
  onRangeChange,
  category,
  onCategoryChange,
}: DateRangeControlsProps) => {
  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    onRangeChange({ from: toDateInput(from), to: toDateInput(to) });
  };

  return (
    <div className={`${surface.panel} p-5`}>
      <div className={surface.panelGlow} />
      <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <DateRangePicker value={range} onChange={onRangeChange} />

          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={pill.secondary}
                onClick={() => applyPreset(preset.days)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <Select
          value={category ?? ANY_CATEGORY}
          onValueChange={(value) =>
            onCategoryChange(
              value === ANY_CATEGORY ? undefined : (value as EventCategory),
            )
          }
        >
          <SelectTrigger
            aria-label="Filter by event category"
            className="h-9 w-full border-slate-300 bg-white sm:w-56"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_CATEGORY}>All categories</SelectItem>
            {CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "CUSTOM" ? "Custom Groups" : capitalizeLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default DateRangeControls;

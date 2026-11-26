"use client";

import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import { Command, CommandGroup } from "@/globals/components/shad-cn/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/globals/components/shad-cn/popover";
import { useState } from "react";
import { Checkbox } from "@/globals/components/shad-cn/checkbox";
import { Label } from "@/globals/components/shad-cn/label";
import { cn } from "@/globals/libs/shad-cn";

type CheckboxItem = {
  id: string;
  label: string;
};

type CheckboxGroupProps = {
  choices: CheckboxItem[];
  placeholder: string;
  selectedValues: string[];
  onSelect: (newValues: string[]) => void;
  maxHeight?: string;
  /** Extra classes for the trigger button - e.g. "w-full" inside a grid/flex cell. */
  className?: string;
};

/**
 * Checkbox Group that allows you to select multiple groups
 * The selected items are returned as an array in a two-column layout
 */
const CheckboxGroup = ({
  choices,
  placeholder,
  selectedValues,
  onSelect,
  maxHeight = "300px", // Default max height
  className,
}: CheckboxGroupProps) => {
  const [open, setOpen] = useState(false);

  const handleToggle = (value: string) => {
    const newSelectedValues = selectedValues.includes(value)
      ? selectedValues.filter((selected) => selected !== value)
      : [...selectedValues, value];

    onSelect(newSelectedValues);
  };

  // Split choices into two columns
  const midpoint = Math.ceil(choices.length / 2);
  const firstColumn = choices.slice(0, midpoint);
  const secondColumn = choices.slice(midpoint);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("min-w-0 max-w-full justify-between", className)}
        >
          {selectedValues.length > 0
            ? `${placeholder} (${selectedValues.length} selected)`
            : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(320px,calc(100vw-2rem))] p-0">
        <Command>
          <CommandGroup>
            <div
              className="grid grid-cols-2 gap-4 p-4"
              style={{ maxHeight, overflowY: "auto" }}
            >
              {/* First Column */}
              <div className="space-y-2">
                {firstColumn.map((item) => (
                  <div key={item.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`first-${item.id}`}
                      checked={selectedValues.includes(item.id)}
                      onCheckedChange={() => handleToggle(item.id)}
                    />
                    <Label
                      htmlFor={`first-${item.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {item.label}
                    </Label>
                  </div>
                ))}
              </div>

              {/* Second Column */}
              <div className="space-y-2">
                {secondColumn.map((item) => (
                  <div key={item.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`second-${item.id}`}
                      checked={selectedValues.includes(item.id)}
                      onCheckedChange={() => handleToggle(item.id)}
                    />
                    <Label
                      htmlFor={`second-${item.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {item.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Select All / Clear All Footer */}
            <div className="border-t px-4 py-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelect(choices.map((c) => c.id))}
                className="text-sm"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelect([])}
                className="text-sm"
              >
                Clear All
              </Button>
            </div>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default CheckboxGroup;

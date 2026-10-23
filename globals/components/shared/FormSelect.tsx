"use client";

import { useController, Control } from "react-hook-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/globals/components/shad-cn/select";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../shad-cn/field";
import { Option } from "@/globals/types/primitives";
import { Info } from "lucide-react";

interface FormSelectProps {
  /** Field name in the form schema. */
  name: string;
  clearable?: boolean;
  /** Visible label. */
  label: string;
  placeholder?: string;
  /** `{ label, value }` pairs. Derive these from `globals/constants/groups.ts`
   *  rather than hardcoding school vocabulary at the call site. */
  options: Option[];
  /** react-hook-form `control` — this component is controlled, not registered. */
  control: Control<any>;
  description?: string;
  /** Validation message. Pass `errors.field?.message`. */
  error?: string;
}

/**
 * FormSelect
 *
 * Single-select bound to react-hook-form via `useController`. Unlike
 * {@link FormInput}, this takes `control` rather than spreading `register()` —
 * Radix's Select isn't a native input, so it has to be controlled.
 *
 * ## Prefer this over
 * - A raw shad-cn `Select` inside a `Controller`, which reimplements the same
 *   wiring plus the label/error layout every time.
 * - A `ComboBox`, unless the list is long enough to need search. Under ~10
 *   options a plain select is faster to operate.
 *
 * ## Constraints
 * - Requires `control`; it will not work with `register()`.
 * - For multi-select, use `CheckboxGroup` instead — this component holds a
 *   single string value.
 *
 * @example
 * ```tsx
 * <FormSelect
 *   name="department"
 *   label="Department"
 *   options={departmentOptions}
 *   control={form.control}
 *   error={errors.department?.message}
 * />
 * ```
 *
 * @see /design-system — live examples
 */
const FormSelect = ({
  name,
  clearable = false,
  label,
  placeholder,
  options,
  control,
  description,
  error,
}: FormSelectProps) => {
  const {
    field: { value, onChange, ref },
  } = useController({
    name,
    control,
    defaultValue: "",
  });

  return (
    <Field className="gap-1.5">
      <FieldLabel className="text-[10px] uppercase font-bold text-slate-400 ml-1">
        {label}
      </FieldLabel>
      <Select onValueChange={next => onChange(next === "__clear__" ? null : next)} value={value ?? ""}>
        <SelectTrigger
          ref={ref}
          className="border-slate-200 rounded-xl focus:ring-slate-900"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-slate-200">
          {clearable && <SelectItem value="__clear__">Not provided (clear field)</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {description && !error && (
        <FieldDescription className="text-[11px] ml-1 mt-1 text-slate-500">
          {description}
        </FieldDescription>
      )}

      {error && (
        <FieldError className="flex items-center-safe text-[11px] font-medium text-rose-500 ml-1">
          <Info size={12} className="mr-1 inline-block" />
          {error}
        </FieldError>
      )}
    </Field>
  );
};

export default FormSelect;

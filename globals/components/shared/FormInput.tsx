"use client";

import { Input } from "@/globals/components/shad-cn/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../shad-cn/field";
import { Info } from "lucide-react";
import { ComponentProps, forwardRef } from "react";

interface FormInputProps extends ComponentProps<typeof Input> {
  /** Visible label. Also derives the input's `id` when one isn't supplied. */
  label: string;
  /** Helper text below the field. Hidden while an `error` is showing. */
  description?: string;
  /** Validation message. Pass `errors.field?.message` from react-hook-form. */
  error?: string;
}

/**
 * FormInput
 *
 * The standard text field. Wraps shad-cn's `Input` with this app's label,
 * description, and error layout, and forwards its ref so it drops straight into
 * `register()`.
 *
 * ## Prefer this over
 * A bare `<Input>` plus a hand-written `<label>`. Doing that loses the
 * label/error spacing, the readable label treatment, and the automatic
 * `htmlFor`/`id` association that keeps the field accessible.
 *
 * ## Constraints
 * - `description` and `error` are mutually exclusive by design — the error
 *   replaces the description so the field never shows two conflicting hints.
 * - Always feed `error` from the form schema rather than rendering your own
 *   message, so client and server validation stay in agreement.
 *
 * @example
 * ```tsx
 * <FormInput
 *   label="Student ID"
 *   placeholder="2026XXXXXX"
 *   {...register("id")}
 *   error={errors.id?.message}
 * />
 * ```
 *
 * @see FormSelect — the equivalent for `<select>`, bound via `control`
 * @see /design-system — live examples
 */
const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, description, error, id, className, ...props }, ref) => {
    const inputId = id ?? `input-${label.replace(/\s+/g, "-").toLowerCase()}`;

    return (
      <Field className="gap-1.5">
        <FieldLabel
          htmlFor={inputId}
          className="text-sm font-medium text-slate-700"
        >
          {label}
        </FieldLabel>
        <Input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : description ? `${inputId}-description` : undefined}
          className={`border-slate-300 rounded-xl mb-0 ${className}`}
          {...props}
        />
        {description && !error && (
          <FieldDescription id={`${inputId}-description`} className="text-xs mt-1 text-slate-600">
            {description}
          </FieldDescription>
        )}
        {error && (
          <FieldError id={`${inputId}-error`} className="flex items-center-safe text-xs font-medium text-rose-700">
            <Info size={12} className="mr-1 inline-block" />
            {error}
          </FieldError>
        )}
      </Field>
    );
  },
);

FormInput.displayName = "FormInput";
export default FormInput;

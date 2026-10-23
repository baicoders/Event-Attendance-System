"use client";

import { useFormContext } from "react-hook-form";
import FormSelect from "@/globals/components/shared/FormSelect";
import { FieldGroup, FieldSet } from "@/globals/components/shad-cn/field";
import SectionHeading from "./SectionHeading";
import { StudentFormValues } from "@/globals/schemas/studentSchema";
import { useFetchGroups } from "@/globals/hooks/useGroups";
import { Skeleton } from "@/globals/components/shad-cn/skeleton";

const GroupsSection = () => {
  const {
    control,
    watch,
    formState: { errors },
  } = useFormContext<StudentFormValues>();

  const { data: options, isLoading } = useFetchGroups();
  const schoolLevel = watch("schoolLevel");

  if (isLoading) {
    return <GroupsSectionSkeleton />;
  }

  return (
    <FieldSet className="animate-in fade-in slide-in-from-right-4 duration-300">
      <SectionHeading
        title="Group Assignments"
        description="Add only confirmed assignments. All fields are optional; choose Not provided to clear a value."
      />

      <FieldGroup className="grid grid-cols-1 gap-y-4 mt-4">
        {/* Universal Fields */}
        <div className="grid grid-cols-2 gap-4">
          <FormSelect
            clearable
            name="section"
            label="Section"
            placeholder="Select Section"
            options={options?.SECTION ?? []}
            control={control}
            error={errors.section?.message}
          />
          <FormSelect
            clearable
            name="house"
            label="House"
            placeholder="Select House"
            options={options?.HOUSE ?? []}
            control={control}
            error={errors.house?.message}
          />
        </div>

        {/* Conditional College Fields */}
        {(!schoolLevel || schoolLevel === "COLLEGE") && (
          <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
            <FormSelect
              clearable
              name="department"
              label="Department"
              placeholder="Select Department"
              options={options?.DEPARTMENT ?? []}
              control={control}
              error={errors.department?.message}
            />
            <FormSelect
              clearable
              name="program"
              label="Program"
              placeholder="Select Program"
              options={options?.PROGRAM ?? []}
              control={control}
              error={errors.program?.message}
            />
          </div>
        )}

        {/* Conditional SHS Fields */}
        {(!schoolLevel || schoolLevel === "SHS") && (
          <div className="animate-in slide-in-from-top-2 duration-200">
            <FormSelect
              clearable
              name="strand"
              label="Strand"
              placeholder="Select Strand"
              options={options?.STRAND ?? []}
              control={control}
              error={errors.strand?.message}
            />
          </div>
        )}
      </FieldGroup>
    </FieldSet>
  );
};

const GroupsSectionSkeleton = () => (
  <div className="space-y-6">
    <div className="space-y-2">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-48" />
    </div>
    <div className="grid grid-cols-2 gap-4">
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
    <Skeleton className="h-10 w-full rounded-xl" />
    <Skeleton className="h-10 w-full rounded-xl" />
  </div>
);

export default GroupsSection;
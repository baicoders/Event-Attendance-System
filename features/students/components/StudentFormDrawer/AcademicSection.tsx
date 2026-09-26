import { useFormContext } from "react-hook-form";
import FormSelect from "@/globals/components/shared/FormSelect";
import { FieldGroup, FieldSet } from "@/globals/components/shad-cn/field";
import SectionHeading from "./SectionHeading";
import { StudentFormValues } from "@/globals/schemas/studentSchema";
import { Option } from "@/globals/types/primitives";
import { SchoolLevel, YearLevel } from "@prisma/client";
import { useEffect, useRef } from "react";

const SCHOOL_LEVELS = [
  { label: "College", value: "COLLEGE" },
  { label: "Senior High School", value: "SHS" },
];

const YEAR_LEVELS_BY_SCHOOL_TYPE: Record<SchoolLevel, Option<YearLevel>[]> = {
  COLLEGE: [
    { label: "1st Year", value: "YEAR_1" },
    { label: "2nd Year", value: "YEAR_2" },
    { label: "3rd Year", value: "YEAR_3" },
    { label: "4th Year", value: "YEAR_4" },
  ],
  SHS: [
    { label: "Grade 11", value: "GRADE_11" },
    { label: "Grade 12", value: "GRADE_12" },
  ],
};

const AcademicSection = () => {
  const {
    control,
    watch,
    formState: { errors, isDirty },
    resetField,
  } = useFormContext<StudentFormValues>();

  const schoolLevel = watch("schoolLevel");
  const previousSchoolLevel = useRef(schoolLevel);
  const yearLevelOptions = YEAR_LEVELS_BY_SCHOOL_TYPE[schoolLevel ?? "COLLEGE"];

  useEffect(() => {
    // Opening this step after a name edit must preserve the existing year.
    // Clear incompatible fields only when the operator changes school level.
    if (previousSchoolLevel.current === schoolLevel) return;
    previousSchoolLevel.current = schoolLevel;
    if (!isDirty) return;

    if (schoolLevel === "COLLEGE") {
      resetField("strand", { defaultValue: "" });
    } else if (schoolLevel === "SHS") {
      resetField("department", { defaultValue: "" });
      resetField("program", { defaultValue: "" });
    }

    // Always reset yearLevel when level changes to prevent "Grade 11"
    // being stuck in a "College" student's state
    const defaultYearLevel: YearLevel =
      schoolLevel === "COLLEGE" ? "YEAR_1" : "GRADE_11";
    resetField("yearLevel", { defaultValue: defaultYearLevel });
  }, [schoolLevel, resetField, isDirty]);
  return (
    <FieldSet className="animate-in fade-in slide-in-from-right-4 duration-300">
      <SectionHeading
        title="Academic Standing"
        description="Select the student's current level"
      />

      <FieldGroup className="grid grid-cols-1 gap-y-4">
        <FormSelect
          name="schoolLevel"
          label="School Level"
          placeholder="Select level"
          options={SCHOOL_LEVELS}
          control={control}
          error={errors.schoolLevel?.message}
        />

        {schoolLevel && (
          <FormSelect
            name="yearLevel"
            label="Year Level"
            placeholder="Select year"
            options={yearLevelOptions}
            control={control}
            error={errors.yearLevel?.message}
          />
        )}
      </FieldGroup>
    </FieldSet>
  );
};

export default AcademicSection;

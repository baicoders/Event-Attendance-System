"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFetchStudents } from "@/globals/hooks/useStudents";
import { page } from "@/globals/constants/designTokens";
import StudentListClient from "@/features/students/components/StudentListClient";
import { StudentListCategory } from "@/features/students/types";
import { Student } from "@/globals/types/students";

const EMPTY_STUDENTS: Student[] = [];

const CATEGORY_CONFIG: Record<
  StudentListCategory,
  {
    label: string;
    heading: string;
    queryKey?: string; // The key used in searchParams (e.g., 'department')
  }
> = {
  COLLEGE: {
    label: "College Department",
    heading: "College Rosters",
    queryKey: "department",
  },
  SHS: {
    label: "Senior High Strand",
    heading: "SHS Rosters",
    queryKey: "strand",
  },
  HOUSE: {
    label: "House",
    heading: "House Rosters",
    queryKey: "house",
  },
  ALL: {
    label: "All Students",
    heading: "Main Student Directory",
  },
};

const StudentListPage = () => {
  const searchParams = useSearchParams();
  const filters = Object.fromEntries(searchParams.entries());

  // Derive Category State. Fall back to ALL for unknown categories so a
  // crafted ?category=... can't crash on an undefined config.
  const rawCategory = filters?.category as string | undefined;
  const isKnownCategory = !!rawCategory && rawCategory in CATEGORY_CONFIG;
  const category: StudentListCategory = isKnownCategory
    ? (rawCategory as StudentListCategory)
    : "ALL";
  const config = CATEGORY_CONFIG[category];

  // When the category is unknown we truly fall back to the ALL roster, so drop
  // the other raw filters too - otherwise ?category=invalid&house=azul would
  // claim "All Students" while still returning only Azul. A valid/absent
  // category keeps its filters.
  const queryFilters =
    rawCategory && !isKnownCategory
      ? { category: "ALL" }
      : { ...filters, category };
  const { data: students, isLoading, isError } = useFetchStudents(queryFilters);

  // Dynamically extract the "item" slug based on the category's specific query key
  const itemSlug = config.queryKey
    ? (filters[config.queryKey] as string)
    : undefined; 

  const backHref =
    category === "ALL"
      ? "/students"
      : `/students/select-category?category=${category}`;

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <Link
          href={backHref}
          className="inline-flex items-center w-fit rounded-full border border-slate-200 bg-white py-2 px-6 md:px-12 text-sm font-medium text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
        >
          <span className="mr-2">←</span> Back to selection
        </Link>

        <StudentListClient
          category={category}
          label={config.label}
          item={itemSlug || "General"}
          categoryHeading={config.heading}
          students={students ?? EMPTY_STUDENTS}
          isLoading={isLoading}
          isError={isError}
        />
      </div>
    </section>
  );
};

export default StudentListPage;

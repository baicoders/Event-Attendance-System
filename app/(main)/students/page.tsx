"use client";

import StudentStatsBoard from "@/features/students/components/StudentStatsBoard";
import { page } from "@/globals/constants/designTokens";

const StudentsPage = () => {
  return (
    <section className={page.surface + " min-h-svh"}>
      <div className={page.containerWide}>
        <header className="overflow-hidden rounded-3xl border border-indigo-200/60 bg-[linear-gradient(130deg,#1e1b4b_0%,#1d4ed8_52%,#4f46e5_100%)] px-6 py-7 text-white shadow-[0_24px_50px_rgba(30,64,175,0.25)] md:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
            Student Directory
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            Student&apos;s List
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-blue-100/90">
            Choose a student category below to manage its roster and related
            attendance information.
          </p>
        </header>
        <StudentStatsBoard />
      </div>
    </section>
  );
};

export default StudentsPage;

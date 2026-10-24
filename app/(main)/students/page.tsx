"use client";

import StudentStatsBoard from "@/features/students/components/StudentStatsBoard";
import Link from "next/link";
import { QrCode, Upload, TriangleAlert } from "lucide-react";
import { useAuth } from "@/globals/contexts/AuthContext";
import { page } from "@/globals/constants/designTokens";

const StudentsPage = () => {
  const { user } = useAuth();
  const actionClass = "inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
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
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/students/qr-codes?category=ALL&source=directory" className={actionClass} aria-label="Manage QR codes"><QrCode aria-hidden className="size-4" />Manage</Link>
            {user?.role === "ADMIN" && user.status === "ACTIVE" && <>
              <Link href="/students/issues" className={actionClass}><TriangleAlert aria-hidden className="size-4" />Address Student Record Issues</Link>
              <Link href="/students/import" className={actionClass}><Upload aria-hidden className="size-4" />Import</Link>
            </>}
          </div>
        </header>
        <StudentStatsBoard />
      </div>
    </section>
  );
};

export default StudentsPage;

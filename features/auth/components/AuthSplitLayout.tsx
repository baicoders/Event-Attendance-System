import Image from "next/image";
import type { ReactNode } from "react";

import AuthBackdrop from "./AuthBackdrop";

type AuthSplitLayoutProps = {
  mode: "login" | "signup";
  workspace?: "EVENTS" | "CLASS";
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
};

const AuthSplitLayout = ({
  mode,
  workspace = "EVENTS",
  title,
  subtitle,
  children,
  footer,
}: AuthSplitLayoutProps) => {
  const brandingSubtitle = workspace === "CLASS" ? "Your classes, student QR codes, and daily attendance." :
    mode === "login"
      ? "Sign in to manage events and attendance records."
      : "Request access to manage events and attendance records.";

  return (
    <AuthBackdrop>
      <section className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl border-4 border-slate-800 bg-white/95 shadow-[0_24px_90px_rgba(2,6,23,0.55)] backdrop-blur-md">
        <div className="p-6 text-slate-900 sm:p-8 md:p-10">
          <div className="mb-5 flex justify-center">
            <Image
              src="/logos/school/logo.png"
              alt="ACLC College of Ormoc City logo"
              width={104}
              height={104}
              className="h-24 w-24 object-contain"
              priority
            />
          </div>

          <div className="mb-7 space-y-2">
            <h2 className="text-center text-3xl font-semibold tracking-tight text-slate-900">
              {workspace === "CLASS" ? "ACLC Classroom Attendance" : "ACLC Event Attendance"}
            </h2>
            <p className="text-center text-[12px] text-slate-500">
              {brandingSubtitle}
            </p>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>

          <div className="mt-7">{children}</div>
          <div className="mt-6 border-t border-slate-200 pt-6 text-center text-sm text-slate-600">
            {footer}
          </div>
        </div>
      </section>
    </AuthBackdrop>
  );
};

export default AuthSplitLayout;

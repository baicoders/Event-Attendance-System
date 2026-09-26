"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarProvider } from "@/globals/contexts/SidebarContext";
import Sidebar from "@/globals/components/shared/Sidebar";
import MobileTopBar from "@/globals/components/shared/MobileTopBar";
import MobileBottomNav from "@/globals/components/shared/MobileBottomNav";
import { useAuth } from "@/globals/contexts/AuthContext";
import ChangePasswordForm from "@/features/settings/components/ChangePasswordForm";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const isOperator = usePathname() === "/attendance/operator";

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-600">
        Checking access…
      </main>
    );
  }

  if (!user) {
    return null;
  }

  if (user.status !== "ACTIVE") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-700 p-6">
        <div className="max-w-md w-full rounded-2xl bg-white shadow-lg border border-slate-200 p-8 space-y-4 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">
            {user.status === "PENDING"
              ? "Awaiting Approval"
              : "Account Access Restricted"}
          </h1>
          <p className="text-sm text-slate-600">
            {user.status === "PENDING"
              ? "Your organizer account is pending admin approval. You will gain access once an administrator reviews your request."
              : user.rejectionReason ||
                "This account has been rejected. Please contact an administrator for assistance."}
          </p>
          <button
            type="button"
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={async () => {
              // Navigate only if logout actually succeeded server-side.
              if (await logout()) {
                router.replace("/login");
              }
            }}
          >
            Return to login
          </button>
        </div>
      </main>
    );
  }

  // An admin-issued temporary password gets the user in, and no further. The
  // gate lifts as soon as ChangePasswordForm refreshes the session.
  // Server routes enforce the same rule; this is the UX mirror, not the
  // boundary.
  if (user.mustChangePassword) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-700 p-6">
        <div className="max-w-md w-full rounded-2xl bg-white shadow-lg border border-slate-200 p-8 space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-slate-900">
              Choose a new password
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              You signed in with an administrator-issued temporary password.
            </p>
          </div>

          <ChangePasswordForm submitLabel="Set password and continue" />

          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            onClick={async () => {
              if (await logout()) {
                router.replace("/login");
              }
            }}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  if (isOperator) {
    return <main className="min-h-screen bg-slate-100">{children}</main>;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-slate-100">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col overflow-x-hidden">
          <MobileTopBar />
          <main className="flex-1 overflow-x-hidden pb-24 lg:pb-0">{children}</main>
          <MobileBottomNav />
        </div>
      </div>
    </SidebarProvider>
  );
};

export default MainLayout;

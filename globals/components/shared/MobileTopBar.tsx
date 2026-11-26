"use client";

import Image from "next/image";
import Link from "next/link";
import { useAccountBackgroundPathname } from "@/features/auth/hooks/useAccountBackgroundPathname";
import { LogOut, Settings, Network, BookOpen, UserRound } from "lucide-react";

import WorkspaceSwitcher from "@/features/auth/components/WorkspaceSwitcher";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useLogout } from "@/globals/hooks/useLogout";
import { focusRing } from "@/globals/constants/designTokens";
import { cn } from "@/globals/libs/shad-cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/globals/components/shad-cn/dropdown-menu";

/**
 * Sticky mobile/tablet header shown below the `lg` breakpoint. Navigation
 * itself lives in `MobileBottomNav`; this bar just carries branding plus the
 * account affordances the desktop `Sidebar` would otherwise host.
 */
const MobileTopBar = ({ workspace = "EVENTS" }: { workspace?: "EVENTS" | "CLASS" }) => {
  const { user } = useAuth();
  const handleLogout = useLogout();
  const pathname = useAccountBackgroundPathname();

  const initials = (user?.name ?? "Organizer")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="print:hidden sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <Image
          src="/logos/school/logo.png"
          alt="ACLC logo"
          width={28}
          height={28}
          className="size-7 shrink-0 object-contain"
        />
        <p className="truncate text-sm font-semibold tracking-tight text-slate-900">
          {workspace === "CLASS" ? "ACLC Class Attendance" : "ACLC Attendance"}
        </p>
      </div>

      {/* The account menu also carries destinations beyond the bottom nav's
          item budget, including Settings and Custom Groups. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0b4dff_0%,#6d28d9_100%)] text-xs font-semibold text-white transition-opacity hover:opacity-90",
              focusRing
            )}
            aria-label={`Account menu for ${user?.name ?? "Organizer"}`}
            title={user?.name ?? "Organizer"}
          >
            {initials || "O"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="truncate">
            {user?.name ?? "Organizer"}
          </DropdownMenuLabel>
          <WorkspaceSwitcher menu />
          {workspace === "CLASS" ? <DropdownMenuItem asChild><Link href="/account/settings" scroll={false}><UserRound aria-hidden className="size-4" />Account settings</Link></DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              href={workspace === "CLASS" ? user?.role === "ADMIN" ? "/class/admin/classes" : "/class/classes" : "/custom-groups"}
              aria-current={
                pathname === "/custom-groups"
                  ? "page"
                  : pathname.startsWith("/custom-groups/")
                    ? "location"
                    : undefined
              }
            >
              {workspace === "CLASS" ? <BookOpen aria-hidden="true" /> : <Network aria-hidden="true" />}
              {workspace === "CLASS" ? user?.role === "ADMIN" ? "Classes" : "My Classes" : "Custom Groups"}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              href={workspace === "CLASS" ? "/class/settings" : "/settings"}
              aria-current={
                pathname === "/settings"
                  ? "page"
                  : pathname.startsWith("/settings/")
                    ? "location"
                    : undefined
              }
            >
              <Settings aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={handleLogout}>
            <LogOut aria-hidden="true" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};

export default MobileTopBar;

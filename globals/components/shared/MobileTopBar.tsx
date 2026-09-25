"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings } from "lucide-react";

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
const MobileTopBar = () => {
  const { user } = useAuth();
  const handleLogout = useLogout();
  const pathname = usePathname();

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
          ACLC Attendance
        </p>
      </div>

      {/* Catch-all account menu. Account-scoped actions belong here rather
          than as more standalone icon buttons; Settings lives here instead of
          in MobileBottomNav, which is already at its item budget. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0b4dff_0%,#6d28d9_100%)] text-xs font-semibold text-white transition-opacity hover:opacity-90",
              focusRing
            )}
            aria-label={`Account menu for ${user?.name ?? "Organizer"}`}
            title={user?.name ?? "Organizer"}
          >
            {initials || "O"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="truncate">
            {user?.name ?? "Organizer"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              href="/settings"
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

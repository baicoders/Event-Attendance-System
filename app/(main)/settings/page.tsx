"use client";

import PageHeader from "@/globals/components/shared/PageHeader";
import { page } from "@/globals/constants/designTokens";
import { useAuth } from "@/globals/contexts/AuthContext";
import AccountSection from "@/features/settings/components/AccountSection";
import ManageGroupsSection from "@/features/settings/components/ManageGroupsSection";
import UsersSection from "@/features/settings/components/UsersSection";
import SystemSection from "@/features/settings/components/SystemSection";

/**
 * The operator console.
 *
 * Everything here used to require terminal access and Prisma Studio: adding a
 * missing section mid-import, recovering a forgotten password, checking which
 * database the server is on.
 *
 * The admin gate below is cosmetic - every route these sections call enforces
 * `requireRole(user, "ADMIN")` itself.
 */
const SettingsPage = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <PageHeader
          variant="hero"
          eyebrow="Operator Console"
          title="Settings"
          description={
            isAdmin
              ? "Manage the group vocabulary, recover accounts, and check this server's configuration."
              : "Manage your own account."
          }
        />

        <AccountSection />

        {isAdmin ? (
          <>
            <ManageGroupsSection />
            <UsersSection />
            <SystemSection />
          </>
        ) : null}
      </div>
    </section>
  );
};

export default SettingsPage;

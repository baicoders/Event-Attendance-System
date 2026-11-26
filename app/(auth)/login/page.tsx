"use client";

import WorkspaceSelector from "@/features/auth/components/WorkspaceSelector";
import { useWorkspacePreference } from "@/features/auth/hooks/useWorkspacePreference";
import { resolveWorkspaceDestination } from "@/features/auth/utils/workspaceDestination";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/globals/components/shad-cn/button";
import FormInput from "@/globals/components/shared/FormInput";
import { toastDanger } from "@/globals/components/shared/toasts";
import AuthSplitLayout from "@/features/auth/components/AuthSplitLayout";
import AuthStatusScreen from "@/features/auth/components/AuthStatusScreen";
import {
  LoginFormValues,
  loginSchema,
} from "@/features/auth/schema/loginSchema";
import { useAuth } from "@/globals/contexts/AuthContext";

const LoginPage = () => {
  const { login, isLoading, isUnavailable, refresh, user } = useAuth();
  const router = useRouter();
  const { workspace, setWorkspace, ready } = useWorkspacePreference();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (!isLoading && !isUnavailable && ready && user) {
      router.replace(resolveWorkspaceDestination(user, workspace, new URLSearchParams(window.location.search).get("returnTo")));
    }
  }, [isLoading, isUnavailable, ready, user, workspace, router]);

  const onSubmit = handleSubmit(async ({ email, password }) => {
    try {
      setWorkspace(workspace);
      const result = await login(email, password, workspace);

      if (!result.success) {
        toastDanger(result.message ?? "Unable to sign in.");
        return;
      }

      // The authenticated-user effect chooses the authorized workspace destination.
    } catch {
      toastDanger("Unexpected error. Please try again.");
    }
  });

  if (isUnavailable) return <main className="p-6" role="alert">Unable to check sign-in. <Button className="min-h-12" onClick={() => void refresh()}>Retry connection</Button></main>;

  if (isLoading || !ready) {
    return <AuthStatusScreen message="Preparing sign in…" />;
  }

  if (user) return null;

  return (
    <AuthSplitLayout
      mode="login"
      workspace={workspace}
      title="Sign In"
      subtitle={workspace === "CLASS" ? "Sign in to your teacher account or check your application." : "Enter your organizer credentials to continue."}
      footer={
        <p>
          {workspace === "CLASS" ? "New teacher?" : "New organizer?"}{" "}
          <Link
            href={`/signup?workspace=${workspace}`}
            className="inline-flex min-h-12 items-center text-sm font-semibold text-slate-900 underline-offset-2 hover:text-indigo-600 hover:underline"
          >
            Request access
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <WorkspaceSelector value={workspace} onChange={setWorkspace} disabled={isSubmitting} />
        <FormInput
          label="Email"
          type="email"
          autoComplete="email"
          {...register("email")}
          error={errors.email?.message}
        />

        <FormInput
          label="Password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
          error={errors.password?.message}
        />

        <Button
          type="submit"
          className="min-h-12 w-full"
          size="lg"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </AuthSplitLayout>
  );
};

export default LoginPage;

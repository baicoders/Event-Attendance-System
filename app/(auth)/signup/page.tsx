"use client";

import WorkspaceSelector from "@/features/auth/components/WorkspaceSelector";
import { useWorkspacePreference } from "@/features/auth/hooks/useWorkspacePreference";
import { resolveWorkspaceDestination } from "@/features/auth/utils/workspaceDestination";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/globals/components/shad-cn/button";
import FormInput from "@/globals/components/shared/FormInput";
import { toastDanger } from "@/globals/components/shared/toasts";
import AuthSplitLayout from "@/features/auth/components/AuthSplitLayout";
import AuthStatusScreen from "@/features/auth/components/AuthStatusScreen";
import {
  SignupFormValues,
  signupSchema,
} from "@/features/auth/schema/signupSchema";
import { useAuth } from "@/globals/contexts/AuthContext";
import { ApiError, fetchApi } from "@/globals/utils/api";

const SignupPage = () => {
  const { user, isLoading, isUnavailable, refresh } = useAuth();
  const router = useRouter();
  const { workspace, setWorkspace, ready } = useWorkspacePreference();
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  const {
    register,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
  });

  useEffect(() => {
    if (!isLoading && !isUnavailable && ready && user) {
      router.replace(resolveWorkspaceDestination(user, workspace));
    }
  }, [isLoading, isUnavailable, ready, user, workspace, router]);

  useEffect(() => { setValue("workspace", workspace); }, [workspace, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await fetchApi("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, workspace }),
      });

      setWorkspace(workspace);
      if (workspace === "CLASS") await refresh();
      else setSubmittedName(values.name);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Unexpected error. Please try again.";
      toastDanger(message);
    }
  });

  if (isUnavailable) return <main className="p-6" role="alert">Unable to check sign-in. <Button className="min-h-12" onClick={() => void refresh()}>Retry connection</Button></main>;

  if (isLoading || !ready) {
    return <AuthStatusScreen message="Preparing signup…" />;
  }

  if (user) return null;

  return (
    <AuthSplitLayout
      mode="signup"
      workspace={workspace}
      title={workspace === "CLASS" ? "Apply for Teacher Access" : "Request Access"}
      subtitle={workspace === "CLASS" ? "One school administrator approval gives you independent access to manage your classes." : "Submit your details and wait for administrator approval."}
      footer={
        <p>
          Already registered?{" "}
          <Link
            href={`/login?workspace=${workspace}`}
            className="inline-flex min-h-12 items-center text-sm font-semibold text-slate-900 underline-offset-2 hover:text-indigo-600 hover:underline"
          >
            Return to login
          </Link>
        </p>
      }
    >
      {submittedName ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="size-6 text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900">
            Request submitted, {submittedName.split(" ")[0]}.
          </p>
          <p className="max-w-xs text-sm text-slate-500">
            An admin will review your account shortly. You&apos;ll be able to
            sign in once it&apos;s approved.
          </p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <WorkspaceSelector value={workspace} onChange={setWorkspace} disabled={isSubmitting} />
          <FormInput
            label="Full name"
            type="text"
            autoComplete="name"
            {...register("name")}
            error={errors.name?.message}
          />

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
            autoComplete="new-password"
            {...register("password")}
            error={errors.password?.message}
            description={
              !errors.password ? "At least 8 characters." : undefined
            }
          />

          {workspace === "CLASS" ? <>
            <FormInput label="Department or teaching designation" {...register("departmentOrDesignation")} error={errors.departmentOrDesignation?.message} />
            <FormInput label="Staff reference (optional)" {...register("staffReference")} error={errors.staffReference?.message} />
          </> : null}
          <Button
            type="submit"
            className="min-h-12 w-full"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit request"
            )}
          </Button>
        </form>
      )}
    </AuthSplitLayout>
  );
};

export default SignupPage;

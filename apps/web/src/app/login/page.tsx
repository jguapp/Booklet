"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookletPeekMark, PasswordPeekProvider } from "@/components/ui/password-peek";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { useAuth } from "@/lib/auth/auth-provider";
import { ApiError } from "@/lib/api/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <PasswordPeekProvider>
        <LoginPageInner />
      </PasswordPeekProvider>
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "oauth_failed" ? "That sign-in attempt didn't go through. Try again." : null,
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      await login({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      router.push("/library");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <BookletPeekMark />

        <div className="rounded-md border border-border bg-surface px-6 py-7">
          <h1 className="mb-6 font-serif text-xl font-semibold text-ink">Log in</h1>

          <OAuthButtons />

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-sans text-xs font-medium text-ink-muted">Email</span>
              <Input type="email" name="email" required autoFocus placeholder="you@example.com" />
            </label>
            {/* Explicit htmlFor/id, not a wrapping <label>: PasswordInput's
                own show/hide button lives inside it, and a wrapping label
                associates with -- and exposes to getByLabel -- everything
                nested inside it, the button included, not just the input. */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="font-sans text-xs font-medium text-ink-muted">
                  Password
                </label>
                <Link href="/forgot-password" className="font-sans text-xs font-medium text-accent">
                  Forgot password?
                </Link>
              </div>
              <PasswordInput id="password" name="password" required placeholder="••••••••" />
            </div>

            {error && <p className="font-sans text-sm text-red-500">{error}</p>}

            <Button type="submit" variant="primary" disabled={submitting} className="mt-2 w-full">
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center font-sans text-sm text-ink-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-accent">
            Create an account
          </Link>
        </p>
        <p className="mt-2 text-center font-sans text-sm text-ink-faint">
          Just here to read?{" "}
          <Link href="/library" className="font-medium text-accent">
            Skip this — no account needed
          </Link>
        </p>
      </div>
    </div>
  );
}

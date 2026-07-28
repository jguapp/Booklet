"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-provider";
import { ApiError } from "@/lib/api/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { resetPassword } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    const newPassword = String(new FormData(e.currentTarget).get("password") ?? "");
    try {
      await resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center font-serif text-xl font-semibold text-ink">
          Booklet
        </Link>

        <div className="rounded-md border border-border bg-surface px-6 py-7">
          <h1 className="mb-6 font-serif text-xl font-semibold text-ink">Set a new password</h1>

          {!token ? (
            <p className="font-sans text-sm text-red-500">
              This link is missing its reset token. Request a new one from the{" "}
              <Link href="/forgot-password" className="font-medium text-accent">
                forgot password
              </Link>{" "}
              page.
            </p>
          ) : done ? (
            <div className="flex flex-col gap-4">
              <p className="font-sans text-sm text-ink-muted">
                Your password has been reset. You have been signed out everywhere else for safety.
              </p>
              <Button variant="primary" onClick={() => router.push("/login")}>
                Log in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-sans text-xs font-medium text-ink-muted">New password</span>
                <Input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  autoFocus
                  placeholder="••••••••"
                />
              </label>

              {error && <p className="font-sans text-sm text-red-500">{error}</p>}

              <Button type="submit" variant="primary" disabled={submitting} className="mt-2 w-full">
                {submitting ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

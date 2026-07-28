"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-provider";

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    try {
      await requestPasswordReset(email);
    } finally {
      // Always show the same confirmation, whether or not the account exists.
      setSent(true);
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
          <h1 className="mb-6 font-serif text-xl font-semibold text-ink">Reset your password</h1>

          {sent ? (
            <p className="font-sans text-sm text-ink-muted">
              If an account exists for that email, a link to reset your password has been sent. It expires in 1
              hour.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-sans text-xs font-medium text-ink-muted">Email</span>
                <Input type="email" name="email" required autoFocus placeholder="you@example.com" />
              </label>

              <Button type="submit" variant="primary" disabled={submitting} className="mt-2 w-full">
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center font-sans text-sm text-ink-muted">
          <Link href="/login" className="font-medium text-accent">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { useAuth } from "@/lib/auth/auth-provider";
import { ApiError } from "@/lib/api/client";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      await signup({
        name: String(form.get("name") ?? ""),
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
        <Link href="/" className="mb-8 block text-center font-serif text-xl font-semibold text-ink">
          Booklet
        </Link>

        <div className="rounded-md border border-border bg-surface px-6 py-7">
          <h1 className="mb-1.5 font-serif text-xl font-semibold text-ink">Create an account</h1>
          <p className="mb-6 font-sans text-sm text-ink-muted">
            Only needed to sync your saves and highlights across devices — Booklet works fully
            offline without one.
          </p>

          <OAuthButtons />

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-sans text-xs font-medium text-ink-muted">Name</span>
              <Input type="text" name="name" required autoFocus placeholder="Your name" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-sans text-xs font-medium text-ink-muted">Email</span>
              <Input type="email" name="email" required placeholder="you@example.com" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-sans text-xs font-medium text-ink-muted">Password</span>
              <Input type="password" name="password" required minLength={8} placeholder="••••••••" />
            </label>

            {error && <p className="font-sans text-sm text-red-500">{error}</p>}

            <Button type="submit" variant="primary" disabled={submitting} className="mt-2 w-full">
              {submitting ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center font-sans text-sm text-ink-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent">
            Log in
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

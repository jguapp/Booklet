"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // No Auth backend yet -- this is where POST /api/auth/signup will go.
    setTimeout(() => router.push("/library"), 500);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center font-serif text-xl font-semibold text-ink">
          Booklet
        </Link>

        <div className="rounded-md border border-border bg-surface px-6 py-7">
          <h1 className="mb-6 font-serif text-xl font-semibold text-ink">Create an account</h1>

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
              <Input type="password" name="password" required placeholder="••••••••" />
            </label>

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
      </div>
    </div>
  );
}

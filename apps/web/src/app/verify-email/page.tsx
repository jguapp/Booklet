"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { ApiError } from "@/lib/api/client";

type Status = "verifying" | "success" | "error";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailPageInner />
    </Suspense>
  );
}

function VerifyEmailPageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { verifyEmail } = useAuth();
  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its verification token.");

  useEffect(() => {
    if (!token) return;
    verifyEmail(token)
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
      });
    // Only ever run once per token -- verifyEmail() isn't idempotent server-side (single-use token).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
      <Link href="/" className="mb-8 block font-serif text-xl font-semibold text-ink">
        Booklet
      </Link>

      <div className="w-full max-w-sm rounded-md border border-border bg-surface px-6 py-7">
        {status === "verifying" && <p className="font-sans text-sm text-ink-muted">Verifying…</p>}
        {status === "success" && (
          <>
            <p className="mb-4 font-sans text-sm text-ink">Your email is verified.</p>
            <Link href="/library" className="font-sans text-sm font-medium text-accent">
              Go to your library
            </Link>
          </>
        )}
        {status === "error" && <p className="font-sans text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}

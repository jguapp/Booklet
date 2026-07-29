"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";

// Landed on after the server-side Google/GitHub redirect chain
// (routes/auth.ts's oauth callback) already set the session cookie -- there's
// no token to read out of the URL, AuthProvider's own mount effect picks the
// session up via the same silent-refresh path used for "still signed in
// from last time". This page's only job is the one thing that path skips:
// running the local (IndexedDB) -> account data import that login()/signup()
// normally trigger inline, since this session was established by a redirect
// rather than either of those calls.
export default function OAuthCallbackPage() {
  const router = useRouter();
  const { status, syncLocalData } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (status === "loading") return;

    if (status !== "authenticated") {
      router.replace("/login?error=oauth_failed");
      return;
    }

    if (ranRef.current) return;
    ranRef.current = true;
    syncLocalData()
      .catch(() => undefined)
      .finally(() => router.replace("/library"));
  }, [status, syncLocalData, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
      <p className="font-sans text-sm text-ink-muted">Signing you in…</p>
    </div>
  );
}

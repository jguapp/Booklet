"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface OAuthProvidersResponse {
  google: boolean;
  github: boolean;
}

// Real, cross-origin browser navigations (ButtonLink -> next/link renders a
// plain <a> for an absolute external href) -- not apiFetch calls. The
// provider's consent screen is a page the user has to actually see and
// approve; a fetch can't take them there.
export function OAuthButtons() {
  const [providers, setProviders] = useState<OAuthProvidersResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<OAuthProvidersResponse>("/api/auth/oauth/providers", { auth: false })
      .then((res) => {
        if (!cancelled) setProviders(res);
      })
      .catch(() => {
        if (!cancelled) setProviders({ google: false, github: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!providers || (!providers.google && !providers.github)) return null;

  return (
    <div className="mb-5 flex flex-col gap-2">
      {providers.google && (
        <ButtonLink href={`${API_URL}/api/auth/oauth/google`} variant="secondary" className="w-full justify-center">
          Continue with Google
        </ButtonLink>
      )}
      {providers.github && (
        <ButtonLink href={`${API_URL}/api/auth/oauth/github`} variant="secondary" className="w-full justify-center">
          Continue with GitHub
        </ButtonLink>
      )}
      <div className="my-1 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="font-sans text-xs text-ink-faint">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

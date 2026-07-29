"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/error-monitoring";
import { Button, ButtonLink } from "@/components/ui/button";

// Next.js App Router convention: catches an error thrown while rendering
// any page or nested layout under this one (i.e. everywhere except the
// root layout itself, which global-error.tsx exists for instead -- this
// runs inside the normal layout, so unlike that file it can use the app's
// real design system rather than inline styles).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <p className="font-sans text-xs font-medium uppercase tracking-wide text-ink-faint">Error</p>
      <h1 className="font-serif text-2xl font-semibold text-ink">Something went wrong.</h1>
      <p className="max-w-sm font-sans text-sm text-ink-muted">
        That page hit an unexpected error. Your library and highlights are unaffected.
      </p>
      <div className="mt-2 flex gap-3">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/library" variant="secondary">
          Back to Library
        </ButtonLink>
      </div>
    </div>
  );
}

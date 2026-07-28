"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/error-monitoring";

// Next.js App Router convention: replaces the root layout when an error
// escapes every other boundary, so it must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "1.5rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <p style={{ fontSize: "1.125rem" }}>Something went wrong.</p>
          <button
            type="button"
            onClick={reset}
            style={{ borderRadius: "4px", border: "1px solid currentColor", padding: "0.5rem 1rem", background: "transparent", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { HealthResponse } from "@booklet/shared";

type State =
  | { phase: "loading" }
  | { phase: "ok"; data: HealthResponse }
  | { phase: "error"; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function HealthCheck() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/api/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`API responded with ${res.status}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        if (!cancelled) setState({ phase: "ok", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            phase: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") {
    return <p className="text-zinc-500">Checking API…</p>;
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <p className="font-medium">Could not reach the API.</p>
        <p className="text-sm">{state.message}</p>
        <p className="mt-1 text-sm">
          Is <code>pnpm dev:api</code> running at {API_URL}?
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      <p className="font-medium">API status: {state.data.status}</p>
      <p className="text-sm">as of {new Date(state.data.timestamp).toLocaleString()}</p>
    </div>
  );
}

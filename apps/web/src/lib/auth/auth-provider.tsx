"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type {
  AuthResponse,
  ImportResponse,
  LoginRequest,
  SignupRequest,
  UpdateSettingsRequest,
  UserProfile,
} from "@booklet/shared";
import { apiFetch, ApiError } from "@/lib/api/client";
import { clearAccessToken, getAccessToken, setAccessToken, silentRefresh } from "@/lib/auth/session";
import { migrateLocalDataToAccount } from "@/lib/data/sync";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  /** Account creation is optional -- this is only ever true once someone chooses to sync. */
  isAuthenticated: boolean;
  signup: (input: SignupRequest) => Promise<void>;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  updateSettings: (input: UpdateSettingsRequest) => Promise<void>;
  /** Result of the most recent local→account import (on signup/login, or a manual re-sync). */
  lastSyncResult: ImportResponse | null;
  /** Manual re-sync -- a safety net if the automatic import on login/signup ever fails partway. */
  syncLocalData: () => Promise<ImportResponse>;
  dismissSyncResult: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<ImportResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!getAccessToken()) {
        const refreshed = await silentRefresh();
        if (!refreshed) {
          if (!cancelled) setStatus("anonymous");
          return;
        }
      }
      try {
        const profile = await apiFetch<UserProfile>("/api/auth/me");
        if (!cancelled) {
          setUser(profile);
          setStatus("authenticated");
        }
      } catch {
        clearAccessToken();
        if (!cancelled) setStatus("anonymous");
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const runMigration = useCallback(async () => {
    try {
      const result = await migrateLocalDataToAccount();
      if (result.importedArticles > 0 || result.importedHighlights > 0) {
        setLastSyncResult(result);
      }
    } catch {
      // Best-effort -- local data is left untouched on failure (migrateLocalDataToAccount
      // only clears IndexedDB after a successful import), so syncLocalData() can retry later.
    }
  }, []);

  const signup = useCallback(
    async (input: SignupRequest) => {
      const res = await apiFetch<AuthResponse>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(input),
        auth: false,
      });
      setAccessToken(res.accessToken, res.accessTokenExpiresAt);
      await runMigration();
      setUser(res.user);
      setStatus("authenticated");
    },
    [runMigration],
  );

  const login = useCallback(
    async (input: LoginRequest) => {
      const res = await apiFetch<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
        auth: false,
      });
      setAccessToken(res.accessToken, res.accessTokenExpiresAt);
      await runMigration();
      setUser(res.user);
      setStatus("authenticated");
    },
    [runMigration],
  );

  const syncLocalData = useCallback(async () => {
    const result = await migrateLocalDataToAccount();
    setLastSyncResult(result);
    return result;
  }, []);

  const dismissSyncResult = useCallback(() => setLastSyncResult(null), []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", auth: false });
    } catch {
      // best-effort -- clear local state regardless
    }
    clearAccessToken();
    setUser(null);
    setLastSyncResult(null);
    setStatus("anonymous");
  }, []);

  const updateSettings = useCallback(async (input: UpdateSettingsRequest) => {
    const profile = await apiFetch<UserProfile>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setUser(profile);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        isAuthenticated: status === "authenticated",
        signup,
        login,
        logout,
        updateSettings,
        lastSyncResult,
        syncLocalData,
        dismissSyncResult,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export { ApiError };

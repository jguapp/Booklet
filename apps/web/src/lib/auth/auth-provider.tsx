"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type {
  AuthResponse,
  ForgotPasswordRequest,
  ImportResponse,
  LoginRequest,
  ResetPasswordRequest,
  SignupRequest,
  UpdateSettingsRequest,
  UserProfile,
  VerifyEmailRequest,
} from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";
import { clearAccessToken, getAccessToken, setAccessToken, silentRefresh } from "@/lib/auth/session";
import { migrateLocalDataToAccount, PartialMigrationError } from "@/lib/data/sync";
import { localArticles } from "@/lib/local/db";

type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface SyncFailure {
  /** How many articles are still sitting in IndexedDB, un-migrated. */
  remainingArticles: number;
  /** What did make it across before the failure, if anything. */
  partial: ImportResponse | null;
}

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
  /** Set when an import didn't fully land, so the library can say so and offer
   * a retry. Everything still listed here is still in IndexedDB -- the point
   * of surfacing it is that a silent failure looks exactly like "my library
   * was deleted when I signed up" (#164). */
  syncFailure: SyncFailure | null;
  /** Manual re-sync -- a safety net if the automatic import on login/signup ever fails partway. */
  syncLocalData: () => Promise<ImportResponse>;
  dismissSyncResult: () => void;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Only reached when the migration threw before it could report progress
 * (a bug, or IndexedDB itself failing) -- the batched path carries its own
 * count. Best-effort: if even this read fails there is nothing useful left
 * to say beyond "it didn't work". */
async function countLocalArticles(): Promise<number> {
  try {
    return (await localArticles.getAll()).length;
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<ImportResponse | null>(null);
  const [syncFailure, setSyncFailure] = useState<SyncFailure | null>(null);

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
      setSyncFailure(null);
      if (result.importedArticles > 0 || result.importedHighlights > 0) {
        setLastSyncResult(result);
      }
    } catch (err) {
      // Never swallowed. The data does survive -- migrateLocalDataToAccount
      // only drops a batch from IndexedDB once the server has accepted it --
      // but from behind the screen an unreported failure is indistinguishable
      // from "signing up deleted my library", because every module in
      // lib/data/* switches to reading from the server the moment status
      // becomes authenticated. Recording it lets the library say what
      // happened and offer the retry that was always possible (#164).
      const partial = err instanceof PartialMigrationError ? err.progress : null;
      const remaining =
        err instanceof PartialMigrationError ? err.remainingArticles : await countLocalArticles();
      setSyncFailure({ remainingArticles: remaining, partial });
      if (partial && (partial.importedArticles > 0 || partial.importedHighlights > 0)) {
        setLastSyncResult(partial);
      }
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
    // Deliberately not try/caught: this one is user-initiated (the retry on
    // the library's failure notice), so the caller shows the error and the
    // notice stays put until an attempt actually succeeds.
    const result = await migrateLocalDataToAccount();
    setLastSyncResult(result);
    setSyncFailure(null);
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
    setSyncFailure(null);
    setStatus("anonymous");
  }, []);

  const updateSettings = useCallback(async (input: UpdateSettingsRequest) => {
    const profile = await apiFetch<UserProfile>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setUser(profile);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const body: ForgotPasswordRequest = { email };
    await apiFetch("/api/auth/forgot-password", { method: "POST", body: JSON.stringify(body), auth: false });
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    const body: ResetPasswordRequest = { token, newPassword };
    await apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify(body), auth: false });
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    const body: VerifyEmailRequest = { token };
    const profile = await apiFetch<UserProfile>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify(body),
      auth: false,
    });
    // Only meaningful if this browser happens to also be signed in as that user.
    setUser((prev) => (prev && prev.id === profile.id ? profile : prev));
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    await apiFetch("/api/auth/resend-verification", { method: "POST" });
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
        syncFailure,
        syncLocalData,
        dismissSyncResult,
        requestPasswordReset,
        resetPassword,
        verifyEmail,
        resendVerificationEmail,
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

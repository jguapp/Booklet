"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type {
  AuthResponse,
  LoginRequest,
  SignupRequest,
  UpdateSettingsRequest,
  UserProfile,
} from "@booklet/shared";
import { apiFetch, ApiError } from "@/lib/api/client";
import { clearAccessToken, getAccessToken, setAccessToken, silentRefresh } from "@/lib/auth/session";

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);

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

  const signup = useCallback(async (input: SignupRequest) => {
    const res = await apiFetch<AuthResponse>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
      auth: false,
    });
    setAccessToken(res.accessToken, res.accessTokenExpiresAt);
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    const res = await apiFetch<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
      auth: false,
    });
    setAccessToken(res.accessToken, res.accessTokenExpiresAt);
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", auth: false });
    } catch {
      // best-effort -- clear local state regardless
    }
    clearAccessToken();
    setUser(null);
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
      value={{ status, user, isAuthenticated: status === "authenticated", signup, login, logout, updateSettings }}
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

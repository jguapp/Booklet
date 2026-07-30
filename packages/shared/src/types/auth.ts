import type { ResurfaceFrequency } from "../resurface";

/**
 * Account creation is entirely optional -- Booklet works fully offline,
 * local-only, without one. An account only exists to sync saves/highlights
 * across devices; these DTOs describe that sync API, not a hard requirement
 * to use the app.
 */
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  resurfaceFrequency: ResurfaceFrequency;
  highlightsPerDigest: number;
  /** Amazon's per-account "Send to Kindle" address -- null until set in Settings. */
  kindleEmail: string | null;
  createdAt: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: UserProfile;
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface UpdateSettingsRequest {
  name?: string;
  resurfaceFrequency?: ResurfaceFrequency;
  highlightsPerDigest?: number;
  /** Pass "" to clear it. */
  kindleEmail?: string;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  /** Whether this is the session behind the request that fetched the list. */
  current: boolean;
}

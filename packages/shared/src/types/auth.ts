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
  /**
   * False for an account created through OAuth that never set a password
   * (User.passwordHash is null). The client needs this to know which
   * confirmation DELETE /api/auth/me will accept -- password re-entry, or a
   * typed email address for accounts that have no password to re-enter.
   * The hash itself is of course never sent.
   */
  hasPassword: boolean;
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

/**
 * Body of DELETE /api/auth/me. Exactly one of these is the confirmation the
 * server will accept, and which one depends on the account rather than on
 * the caller's preference: `password` for an account that has one,
 * `confirmEmail` (the account's own address, typed out) for an OAuth-only
 * account where there is no password to check. Sending the other one is
 * refused rather than ignored -- see the route.
 */
export interface DeleteAccountRequest {
  password?: string;
  confirmEmail?: string;
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

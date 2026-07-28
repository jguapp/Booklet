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
  resurfaceFrequency: ResurfaceFrequency;
  highlightsPerDigest: number;
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
}

export interface ApiErrorResponse {
  error: string;
  message: string;
}

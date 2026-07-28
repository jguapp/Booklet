import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface AccessTokenPayload {
  sub: string;
}

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  return secret;
}

export function signAccessToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  const token = jwt.sign({ sub: userId } satisfies AccessTokenPayload, accessSecret(), {
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  });
  return { token, expiresAt };
}

/** Returns the userId encoded in the token, or null if it's missing/invalid/expired. */
export function verifyAccessToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, accessSecret()) as AccessTokenPayload;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Opaque bearer token for the refresh cookie -- only its hash is ever stored (Session.refreshTokenHash). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

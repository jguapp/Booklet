import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface AccessTokenPayload {
  sub: string;
}

/**
 * The shortest JWT_ACCESS_SECRET production will accept, in characters.
 *
 * 32 because that is what `.env.example` tells people to generate
 * (`randomBytes(32).toString("hex")`, which is 64 hex characters) and half of
 * that is still 128 bits if the value is actually random. The check cannot
 * measure randomness, only length, so this is a floor against the obviously
 * wrong -- "booklet", "changeme", a password someone typed -- not a claim
 * that a 32-character secret is strong.
 */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * Values that are long enough to pass the length check but are known not to
 * be secrets, because they are checked into this repository.
 *
 * Both entries are real, current values: `ci-test-secret-not-for-production`
 * is set for every job in .github/workflows/ci.yml, and
 * `verify-secret-not-for-production` is scripts/verify.mjs's default. They
 * are fine where they are -- nothing in CI signs a token anyone will ever
 * present -- but a copy-paste out of either file into a deploy's environment
 * is exactly the launch-day mistake #174 asked for a guard against, and both
 * clear 32 characters, so length alone would wave them through.
 *
 * Compared after lowercasing and trimming; a stray newline from a secrets
 * manager should not be what makes a known-bad value pass.
 */
const KNOWN_PLACEHOLDER_SECRETS = [
  "ci-test-secret-not-for-production",
  "verify-secret-not-for-production",
  "changeme",
  "secret",
  "your-secret-here",
];

/**
 * Refuses a JWT_ACCESS_SECRET that production must not run with (#174).
 *
 * Only in production, deliberately. Dev, test and CI all run on placeholders
 * -- this whole suite signs tokens with verify.mjs's default -- and a check
 * that fired there would either be turned off or worked around within a day,
 * which is how guards stop guarding anything. The failure it exists to catch
 * is a deploy that boots happily with a secret from a README, where every
 * access token in the system is forgeable by anyone who has read the repo.
 *
 * Exported (rather than only called below) so the tests can drive it directly
 * in both directions without needing a second process with a different
 * NODE_ENV.
 */
export function assertUsableAccessSecret(
  secret: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  if (nodeEnv !== "production") return;

  const normalized = secret.trim().toLowerCase();
  if (KNOWN_PLACEHOLDER_SECRETS.includes(normalized)) {
    throw new Error(
      "JWT_ACCESS_SECRET is a placeholder value checked into this repository, so every access token it signs is forgeable. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production (got ${secret.length}). ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
}

// At import time, not on the first signed token: a server that is going to
// refuse to issue tokens should refuse to start, rather than boot green, pass
// its health check, and then 500 on the first person who tries to log in.
// This module is imported transitively from app.ts via routes/auth.ts, so
// "imported" and "started" are the same moment. Guarded on the variable being
// present at all so that a tool importing this module purely for
// hashOpaqueToken in a non-production environment is unaffected -- the
// existing "is not set" throw below still covers the unset case at use time.
if (process.env.JWT_ACCESS_SECRET) {
  assertUsableAccessSecret(process.env.JWT_ACCESS_SECRET);
}

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  assertUsableAccessSecret(secret);
  return secret!;
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

/**
 * Same shape as the refresh token (opaque, only the hash stored server-side)
 * -- reused for password-reset and email-verification links so a leaked DB
 * row is never enough on its own to reset a password or confirm an email.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

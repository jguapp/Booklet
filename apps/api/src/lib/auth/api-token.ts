import { generateOpaqueToken, hashOpaqueToken } from "./tokens.js";

/** "blk_" makes a leaked/pasted token immediately recognizable as a
 * Booklet credential (same idea as GitHub's "ghp_", Stripe's "sk_") --
 * distinguishes it from the short-lived JWTs the web/extension clients
 * use, which never have a stable prefix since they're not meant to be
 * copy-pasted around. Hashing reuses the exact same opaque-token pattern
 * as refresh tokens/password-reset links (tokens.ts) -- SHA-256 is the
 * right tool here (not scrypt/bcrypt): the secret already has 256 bits of
 * its own entropy, so slow, salted password-hashing buys nothing extra
 * and just makes every request pay for it.
 */
const TOKEN_PREFIX = "blk_";

export function generateApiToken(): string {
  return `${TOKEN_PREFIX}${generateOpaqueToken()}`;
}

export function hashApiToken(token: string): string {
  return hashOpaqueToken(token);
}

export function looksLikeApiToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

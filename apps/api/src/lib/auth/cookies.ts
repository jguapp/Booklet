import type { FastifyReply } from "fastify";
import { REFRESH_TOKEN_TTL_MS } from "./tokens.js";

export const REFRESH_COOKIE_NAME = "booklet_refresh";

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
}

// Short-lived CSRF guard for the OAuth redirect round trip: set right
// before sending the browser to the provider, checked against the `state`
// query param the provider hands back to our callback -- without this, a
// callback URL crafted by an attacker (with a code they obtained some other
// way) would be indistinguishable from a real one.
export const OAUTH_STATE_COOKIE_NAME = "booklet_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function setOAuthStateCookie(reply: FastifyReply, state: string): void {
  reply.setCookie(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/oauth",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: "/api/auth/oauth" });
}

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

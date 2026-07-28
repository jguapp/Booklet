import type { FastifyInstance } from "fastify";
import type {
  AuthResponse,
  LoginRequest,
  RefreshResponse,
  SignupRequest,
  UpdateSettingsRequest,
  UserProfile,
} from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/auth/password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
} from "../lib/auth/tokens.js";
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "../lib/auth/cookies.js";
import { requireAuth } from "../lib/auth/context.js";

type UserRow = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;

function toUserProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    resurfaceFrequency: user.resurfaceFrequency,
    highlightsPerDigest: user.highlightsPerDigest,
    createdAt: user.createdAt.toISOString(),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function issueSession(
  app: FastifyInstance,
  reply: import("fastify").FastifyReply,
  userId: string,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<{ accessToken: string; accessTokenExpiresAt: Date }> {
  const refreshToken = generateRefreshToken();
  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  setRefreshCookie(reply, refreshToken);

  const { token, expiresAt } = signAccessToken(userId);
  return { accessToken: token, accessTokenExpiresAt: expiresAt };
}

// Credential guessing and signup spam are the concerns here, not general
// traffic -- much tighter than the API-wide default.
const AUTH_ATTEMPT_LIMIT = { max: 10, timeWindow: "15 minutes" };

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SignupRequest }>(
    "/api/auth/signup",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
    const { email, password, name } = request.body ?? {};

    if (typeof email !== "string" || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: "invalid_email", message: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 8) {
      return reply
        .code(400)
        .send({ error: "invalid_password", message: "Password must be at least 8 characters." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply
        .code(409)
        .send({ error: "email_taken", message: "An account with that email already exists." });
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        name: typeof name === "string" && name.trim() ? name.trim() : null,
      },
    });

    const { accessToken, accessTokenExpiresAt } = await issueSession(app, reply, user.id, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    });

    const body: AuthResponse = {
      user: toUserProfile(user),
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    };
    return reply.code(201).send(body);
    },
  );

  app.post<{ Body: LoginRequest }>(
    "/api/auth/login",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
    const { email, password } = request.body ?? {};
    const invalid = () =>
      reply.code(401).send({ error: "invalid_credentials", message: "Incorrect email or password." });

    if (typeof email !== "string" || typeof password !== "string") return invalid();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) return invalid();

    const { accessToken, accessTokenExpiresAt } = await issueSession(app, reply, user.id, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    });

    const body: AuthResponse = {
      user: toUserProfile(user),
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    };
    return reply.send(body);
    },
  );

  app.post(
    "/api/auth/refresh",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    const unauthorized = () => {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "unauthorized", message: "Sign in again." });
    };
    if (!token) return unauthorized();

    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(token) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return unauthorized();

    // Rotate: revoke the presented token and issue a fresh one, so a stolen
    // refresh cookie stops working the next time the real client refreshes.
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

    const { accessToken, accessTokenExpiresAt } = await issueSession(app, reply, session.userId, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    });

    const body: RefreshResponse = {
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    };
    return reply.send(body);
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (token) {
      await prisma.session
        .updateMany({
          where: { refreshTokenHash: hashRefreshToken(token), revokedAt: null },
          data: { revokedAt: new Date() },
        })
        .catch(() => undefined);
    }
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(401).send({ error: "unauthorized", message: "Sign in required." });
    const body: UserProfile = toUserProfile(user);
    return reply.send(body);
  });

  app.patch<{ Body: UpdateSettingsRequest }>(
    "/api/auth/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { name, resurfaceFrequency, highlightsPerDigest } = request.body ?? {};

      if (resurfaceFrequency !== undefined && resurfaceFrequency !== "DAILY" && resurfaceFrequency !== "WEEKLY") {
        return reply.code(400).send({ error: "invalid_frequency", message: "Invalid resurface frequency." });
      }
      if (
        highlightsPerDigest !== undefined &&
        (!Number.isInteger(highlightsPerDigest) || highlightsPerDigest < 1 || highlightsPerDigest > 50)
      ) {
        return reply
          .code(400)
          .send({ error: "invalid_highlights_per_digest", message: "Must be an integer between 1 and 50." });
      }

      const user = await prisma.user.update({
        where: { id: request.userId! },
        data: {
          ...(name !== undefined ? { name: name.trim() || null } : {}),
          ...(resurfaceFrequency !== undefined ? { resurfaceFrequency } : {}),
          ...(highlightsPerDigest !== undefined ? { highlightsPerDigest } : {}),
        },
      });

      const body: UserProfile = toUserProfile(user);
      return reply.send(body);
    },
  );
}

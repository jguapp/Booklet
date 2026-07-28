import type { FastifyInstance } from "fastify";
import type {
  AuthResponse,
  ForgotPasswordRequest,
  LoginRequest,
  RefreshResponse,
  ResetPasswordRequest,
  SignupRequest,
  UpdateSettingsRequest,
  UserProfile,
  VerifyEmailRequest,
} from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/auth/password.js";
import {
  generateOpaqueToken,
  generateRefreshToken,
  hashOpaqueToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
} from "../lib/auth/tokens.js";
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "../lib/auth/cookies.js";
import { requireAuth } from "../lib/auth/context.js";
import { sendEmail } from "../services/email-service.js";

type UserRow = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;

function toUserProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    resurfaceFrequency: user.resurfaceFrequency,
    highlightsPerDigest: user.highlightsPerDigest,
    createdAt: user.createdAt.toISOString(),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = generateOpaqueToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });
  const link = `${WEB_ORIGIN}/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: "Verify your Booklet email",
    text: `Confirm your email to finish setting up your Booklet account:\n\n${link}\n\nThis link expires in 24 hours.`,
  });
}

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

    // Best-effort -- the account is fully usable unverified, so a flaky
    // email provider shouldn't block signup.
    sendVerificationEmail(user.id, user.email).catch((err) => app.log.warn(err, "verification email failed"));

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

  app.post<{ Body: ForgotPasswordRequest }>(
    "/api/auth/forgot-password",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
      const email = request.body?.email;
      // Always 200, regardless of whether the account exists -- otherwise
      // this endpoint becomes a way to check which emails have accounts.
      if (typeof email === "string" && EMAIL_RE.test(email)) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
          const token = generateOpaqueToken();
          await prisma.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash: hashOpaqueToken(token),
              expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
            },
          });
          const link = `${WEB_ORIGIN}/reset-password?token=${token}`;
          await sendEmail({
            to: user.email,
            subject: "Reset your Booklet password",
            text: `Reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
          }).catch((err) => app.log.warn(err, "password reset email failed"));
        }
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.post<{ Body: ResetPasswordRequest }>(
    "/api/auth/reset-password",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
      const { token, newPassword } = request.body ?? {};
      const invalid = () =>
        reply.code(400).send({ error: "invalid_token", message: "That reset link is invalid or has expired." });

      if (typeof token !== "string" || !token) return invalid();
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return reply
          .code(400)
          .send({ error: "invalid_password", message: "Password must be at least 8 characters." });
      }

      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
      if (!record || record.usedAt || record.expiresAt < new Date()) return invalid();

      await prisma.$transaction([
        prisma.user.update({ where: { id: record.userId }, data: { passwordHash: hashPassword(newPassword) } }),
        prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
        // A password reset should invalidate every existing session -- if
        // the reset was needed because credentials leaked, a still-valid
        // refresh cookie elsewhere would defeat the point.
        prisma.session.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      return reply.code(200).send({ ok: true });
    },
  );

  app.post<{ Body: VerifyEmailRequest }>("/api/auth/verify-email", async (request, reply) => {
    const token = request.body?.token;
    const invalid = () =>
      reply.code(400).send({ error: "invalid_token", message: "That verification link is invalid or has expired." });

    if (typeof token !== "string" || !token) return invalid();

    const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) return invalid();

    const [user] = await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    const body: UserProfile = toUserProfile(user);
    return reply.send(body);
  });

  app.post(
    "/api/auth/resend-verification",
    { preHandler: requireAuth, config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId! } });
      if (user.emailVerifiedAt) {
        return reply.code(400).send({ error: "already_verified", message: "Your email is already verified." });
      }
      await sendVerificationEmail(user.id, user.email);
      return reply.code(200).send({ ok: true });
    },
  );
}

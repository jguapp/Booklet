import type { FastifyInstance } from "fastify";
import type {
  AuthResponse,
  DeleteAccountRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RefreshResponse,
  ResetPasswordRequest,
  SessionInfo,
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
import {
  clearOAuthStateCookie,
  clearRefreshCookie,
  OAUTH_STATE_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setOAuthStateCookie,
  setRefreshCookie,
} from "../lib/auth/cookies.js";
import { requireAuth } from "../lib/auth/context.js";
import { getOAuthProvider } from "../lib/auth/oauth.js";
import { sendEmail } from "../services/email-service.js";
import { maybePurgeExpiredAuthRows } from "../services/auth-cleanup.js";
import { deleteStoredFile } from "../services/storage-service.js";
import { recomputePublicHighlightStats } from "../services/aggregation-service.js";

type UserRow = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;

function toUserProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    resurfaceFrequency: user.resurfaceFrequency,
    highlightsPerDigest: user.highlightsPerDigest,
    kindleEmail: user.kindleEmail,
    createdAt: user.createdAt.toISOString(),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Upper bounds, not just the 8-char minimum. Every password below feeds
// scrypt, whose first stage HMACs the whole input -- without a cap, the
// only bound on that input is the 1MB body limit. 128 clears every
// password manager's output with room to spare (NIST asks verifiers to
// *allow* at least 64); 254 is RFC 5321's address ceiling.
const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
// This server's own public URL -- must exactly match the redirect URI
// registered with each OAuth provider (a mismatch is one of the most common
// "invalid_redirect_uri" support questions for this kind of flow).
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";
/**
 * The only addresses "Send to Kindle" will mail to.
 *
 * The field validated as any well-formed email address, which made
 * POST /api/articles/:id/send-to-kindle a general-purpose mail relay: set
 * kindleEmail to a stranger, import an article whose title and HTML you wrote
 * (POST /api/sync/import takes both verbatim), and this server sends your
 * document to them, from our envelope sender, with our SPF/DKIM on it. The
 * recipient list is the part that made it a relay rather than a nuisance, so
 * the recipient list is what is bounded.
 *
 * These two domains are the whole feature as documented -- the settings page
 * says "Your @kindle.com address, from Amazon's Manage Your Content and
 * Devices", and this route's own comment says @kindle.com/@free.kindle.com.
 * Narrowing to them takes nothing away that Send to Kindle ever did; an
 * address at any other domain was never going to reach a Kindle.
 */
const KINDLE_EMAIL_DOMAINS = ["kindle.com", "free.kindle.com"];

/** Exported because the check has to happen again where the mail is actually
 * sent (routes/articles.ts): validating only on write leaves every address
 * stored before this rule existed still deliverable. */
export function isKindleAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return KINDLE_EMAIL_DOMAINS.includes(email.slice(at + 1).toLowerCase());
}

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
//
// 100 per 15 minutes, raised from 10 (#170). Ten was sized for one person,
// but this keys on IP: behind one office NAT, one university, or a mobile
// carrier's CGNAT, hundreds of unrelated people present as the same address.
// Six of them mistyping a password once each plus one who retries four times
// spent the whole budget, and everyone at that address -- including people
// who had not tried to sign in at all -- got 429s for fifteen minutes. The
// attacker it was aimed at, meanwhile, has more addresses than the legitimate
// users do. 100 covers a shared address with real people behind it (a few
// dozen sign-ins, mistypes, signups and password resets in a quarter hour)
// and still cuts off a single host spraying one guess each across a list of
// accounts, which is the job actually left to the per-IP layer now that
// FAILED_LOGIN_LIMIT bounds guessing per account below. Signup and the
// password-reset routes have no account to key on, so this plus the API-wide
// 300/min is all the bound they get.
//
// Overridable only so the e2e suite can raise it: that suite signs up dozens
// of times from one address in a few minutes, which is exactly the shape this
// limit exists to stop, and there is no way to tell the two apart from
// inside the API. Same escape hatch GLOBAL_RATE_LIMIT_MAX and
// TTS_RATE_LIMIT_MAX already have.
const AUTH_ATTEMPT_LIMIT = {
  max: Number(process.env.AUTH_ATTEMPT_RATE_LIMIT_MAX) || 100,
  timeWindow: "15 minutes",
};

/**
 * Refresh is deliberately NOT on the budget above (#169).
 *
 * It looks like an auth route, but it is ordinary application traffic: the
 * web app calls it on load and whenever the access token expires. Sharing
 * the credential-guessing budget meant the app spent the user's password-
 * attempt allowance just by working -- a few tabs, or a dozen reloads in
 * fifteen minutes, and refresh started returning 429, which surfaces as
 * being logged out on a correct password having done nothing wrong. Since
 * the limiter keys on IP, everyone behind one office NAT or carrier CGNAT
 * shared those ten refreshes, making it an outage for them rather than a
 * slowdown.
 *
 * Nothing was gained for it, either. A refresh token is a high-entropy
 * random value in an httpOnly cookie -- there is no credential here to
 * guess -- and the API-wide 300/min limit is the real backstop against a
 * flood of invalid attempts. Signup, login and the password-reset routes
 * keep the tight limit, because those genuinely are guessable.
 */
const REFRESH_LIMIT = {
  max: Number(process.env.AUTH_REFRESH_RATE_LIMIT_MAX) || 120,
  timeWindow: "15 minutes",
};

/**
 * Failed logins are bounded per *account*, not only per IP (#170).
 *
 * A per-IP ceiling cannot bound credential guessing on its own. Addresses are
 * cheap to rent, so "N guesses per address" is a budget an attacker just buys
 * more of, while the people sharing one NAT pay its entire cost. Keyed on the
 * account, guesses against a given email are bounded no matter how many hosts
 * they arrive from -- which is the threat -- and one user burning their own
 * budget costs their neighbours nothing.
 *
 * This escalates a wait instead of locking the account. A hard lock hands
 * anyone who knows an email address a way to keep its owner signed out for as
 * long as they care to keep failing, so the lock becomes the attack. After
 * FAILED_LOGIN_LIMIT misses the next attempt waits 5s, then 10s, 20s, ...
 * capped at 15 minutes: sustained guessing drops to a few hundred tries a day
 * (useless against any password worth the name) while the account is never
 * more than fifteen minutes out of its owner's reach, and the strikes decay
 * entirely after an hour of quiet.
 *
 * The counter lives on the User row rather than in Redis or in process
 * memory. In-process would be no bound at all behind a load balancer -- it
 * would read "LIMIT failures per instance" -- and would reset on every
 * deploy. Redis is the conventional home and @fastify/rate-limit speaks it
 * directly, but REDIS_URL is optional here, so a Redis-backed counter would
 * simply not exist in the default deployment. Postgres is already required,
 * already shared across instances, and survives restarts. The cost is a write
 * per failed login, which is the one request we are happy to make expensive.
 */
const FAILED_LOGIN_LIMIT = Number(process.env.AUTH_FAILED_LOGIN_LIMIT) || 5;
const FAILED_LOGIN_BASE_DELAY_MS = 5_000;
const FAILED_LOGIN_MAX_DELAY_MS = 15 * 60 * 1000;
// Someone who mistyped their password five times last Tuesday should start
// today from zero; without a decay the counter is a slow-motion lockout.
const FAILED_LOGIN_DECAY_MS = 60 * 60 * 1000;

/**
 * The same wait, for emails that have no account -- otherwise it becomes an
 * account-enumeration oracle.
 *
 * Delaying only real accounts would make the 429 a far better membership
 * check than the login response itself: six wrong guesses, and whether you
 * get 401 or 429 tells you if that address is registered. The route below
 * deliberately returns one identical `invalid_credentials` for "no such user"
 * and "wrong password"; keying the delay on existence would have handed the
 * answer back through the side door.
 *
 * These keys are attacker-chosen and unbounded, so they must not become rows
 * in Postgres -- that trades an enumeration oracle for a way to fill the
 * database. They live in a capped, oldest-evicted map instead. It defends
 * nothing by itself (there is no account behind it); it only has to be
 * indistinguishable from the real path, and it is -- same thresholds, same
 * response, same header. Known gap: across multiple instances the real
 * counter is shared and this one is not, so an attacker who spreads guesses
 * across instances can still tell the two apart. Closing that needs the
 * shared store this deployment does not require yet.
 */
const UNKNOWN_EMAIL_FAILURE_CAP = 10_000;
const unknownEmailFailures = new Map<string, FailureState>();

type FailureState = { count: number; lastFailedAt: Date | null };

/** Strikes older than the decay window are gone, whoever is asking. */
function activeFailureCount(state: FailureState): number {
  if (!state.lastFailedAt) return 0;
  if (Date.now() - state.lastFailedAt.getTime() > FAILED_LOGIN_DECAY_MS) return 0;
  return state.count;
}

function readFailures(email: string, user: UserRow | null): FailureState {
  if (user) return { count: user.failedLoginCount, lastFailedAt: user.lastFailedLoginAt };
  return unknownEmailFailures.get(email.toLowerCase()) ?? { count: 0, lastFailedAt: null };
}

/** Seconds left on the wait, or 0 if this attempt may proceed. */
function loginRetryAfterSeconds(state: FailureState): number {
  const count = activeFailureCount(state);
  if (count < FAILED_LOGIN_LIMIT || !state.lastFailedAt) return 0;
  const wait = Math.min(FAILED_LOGIN_BASE_DELAY_MS * 2 ** (count - FAILED_LOGIN_LIMIT), FAILED_LOGIN_MAX_DELAY_MS);
  return Math.max(0, Math.ceil((state.lastFailedAt.getTime() + wait - Date.now()) / 1000));
}

async function recordFailedLogin(email: string, user: UserRow | null): Promise<void> {
  const next = activeFailureCount(readFailures(email, user)) + 1;
  const now = new Date();

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: next, lastFailedLoginAt: now },
    });
    return;
  }

  // Re-inserting moves the key to the back of Map's insertion order, so the
  // eviction below drops whichever email has been quiet longest rather than
  // the one currently under attack.
  const key = email.toLowerCase();
  unknownEmailFailures.delete(key);
  unknownEmailFailures.set(key, { count: next, lastFailedAt: now });
  while (unknownEmailFailures.size > UNKNOWN_EMAIL_FAILURE_CAP) {
    const oldest = unknownEmailFailures.keys().next().value;
    if (oldest === undefined) break;
    unknownEmailFailures.delete(oldest);
  }
}

// Two mistypes followed by the right password should leave no trace --
// otherwise the strikes accumulate across weeks of ordinary use and the wait
// eventually arrives for someone who has never actually been attacked.
async function clearFailedLogins(user: UserRow): Promise<void> {
  if (user.failedLoginCount === 0 && user.lastFailedLoginAt === null) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lastFailedLoginAt: null },
  });
}

// Verified against when the email has no account, so the response time does
// not answer the question the identical error body refuses to. scrypt is the
// dominant cost of a login; skipping it for unknown emails makes "no such
// user" measurably faster than "wrong password" from any client with a
// stopwatch.
let dummyPasswordHash: string | null = null;
function absentAccountHash(): string {
  dummyPasswordHash ??= hashPassword(generateOpaqueToken());
  return dummyPasswordHash;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Signup stays purely per-IP: there is no account yet to key a counter on,
  // and keying on the submitted email would only let an attacker exhaust a
  // budget for an address nobody has registered. The looser AUTH_ATTEMPT_LIMIT
  // and the API-wide 300/min are the real bound here (#170).
  app.post<{ Body: SignupRequest }>(
    "/api/auth/signup",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
    const { email, password, name } = request.body ?? {};

    if (typeof email !== "string" || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: "invalid_email", message: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
      return reply
        .code(400)
        .send({ error: "invalid_password", message: "Password must be 8-128 characters." });
    }
    if (name !== undefined && name !== null && (typeof name !== "string" || name.length > MAX_NAME_LENGTH)) {
      return reply.code(400).send({ error: "invalid_name", message: "Name is too long." });
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

    // Length caps use the same invalid() as a wrong password -- an
    // over-long guess deserves no distinct signal, and rejecting it here
    // means it never reaches scrypt.
    if (typeof email !== "string" || typeof password !== "string") return invalid();
    if (email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) return invalid();

    const user = await prisma.user.findUnique({ where: { email } });

    // Gate before checking the password, not after: the point is to make each
    // guess cost wall-clock time, and a wait an attacker can skip by guessing
    // right is not a bound on guessing.
    const retryAfter = loginRetryAfterSeconds(readFailures(email, user));
    if (retryAfter > 0) {
      return reply.code(429).header("Retry-After", String(retryAfter)).send({
        error: "too_many_attempts",
        message: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds.`,
      });
    }

    // A null passwordHash means this account was created via OAuth and has
    // never set one -- password login just isn't an option for it yet.
    const passwordMatches = verifyPassword(password, user?.passwordHash ?? absentAccountHash());
    if (!user || !user.passwordHash || !passwordMatches) {
      await recordFailedLogin(email, user);
      return invalid();
    }

    await clearFailedLogins(user);

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
    { config: { rateLimit: REFRESH_LIMIT } },
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

    // Hung off refresh because refresh is what creates the mess: rotation
    // below leaves a dead Session row behind every single time, and this is
    // the only route frequent enough to guarantee the sweep runs on a live
    // deployment without a scheduler to run it (S8). Internally throttled to
    // once an hour per process, so all but one refresh an hour pays nothing.
    //
    // After the token check, so an unauthenticated flood cannot reach it, and
    // before the rotation only because the sweep's cutoff is a week old --
    // there is nothing it could take that this request is about to rely on.
    await maybePurgeExpiredAuthRows(undefined, (err) => app.log.warn(err, "expired auth row sweep failed"));

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

  // Whether each provider has real credentials configured -- the client
  // uses this to decide whether to show a "Sign in with X" button at all,
  // rather than showing one that 404s.
  app.get("/api/auth/oauth/providers", async (_request, reply) => {
    return reply.send({
      google: getOAuthProvider("google")?.configured ?? false,
      github: getOAuthProvider("github")?.configured ?? false,
    });
  });

  app.get<{ Params: { provider: string } }>(
    "/api/auth/oauth/:provider",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
      const provider = getOAuthProvider(request.params.provider);
      if (!provider || !provider.configured) {
        return reply.code(404).send({ error: "unknown_provider", message: "That sign-in method isn't available." });
      }

      const state = generateOpaqueToken();
      setOAuthStateCookie(reply, state);
      const redirectUri = `${API_ORIGIN}/api/auth/oauth/${request.params.provider}/callback`;
      return reply.redirect(provider.authorizeUrl({ redirectUri, state }));
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/oauth/:provider/callback",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
      const failure = () => reply.redirect(`${WEB_ORIGIN}/login?error=oauth_failed`);

      const provider = getOAuthProvider(request.params.provider);
      if (!provider || !provider.configured) return failure();

      const cookieState = request.cookies[OAUTH_STATE_COOKIE_NAME];
      clearOAuthStateCookie(reply);
      const { code, state, error } = request.query;
      if (error || !code || !state || !cookieState || state !== cookieState) return failure();

      let profile;
      try {
        const redirectUri = `${API_ORIGIN}/api/auth/oauth/${request.params.provider}/callback`;
        profile = await provider.exchangeCode({ code, redirectUri });
      } catch (err) {
        app.log.warn(err, "oauth exchange failed");
        return failure();
      }

      // 1. Already linked -- sign in as whoever it's linked to.
      const existingLink = await prisma.oAuthAccount.findUnique({
        where: { provider_providerAccountId: { provider: request.params.provider, providerAccountId: profile.providerAccountId } },
      });

      let userId: string;
      if (existingLink) {
        userId = existingLink.userId;
      } else {
        const existingUser = await prisma.user.findUnique({ where: { email: profile.email } });
        // 2. No link yet, but a password account already owns this email --
        // only attach to it if the provider itself vouches the address is
        // verified, otherwise this would be a way to hijack an account by
        // registering an OAuth identity under someone else's unverified email.
        if (existingUser) {
          if (!profile.emailVerified) return failure();
          await prisma.oAuthAccount.create({
            data: { userId: existingUser.id, provider: request.params.provider, providerAccountId: profile.providerAccountId },
          });
          userId = existingUser.id;
          if (!existingUser.emailVerifiedAt) {
            await prisma.user.update({ where: { id: existingUser.id }, data: { emailVerifiedAt: new Date() } });
          }
        } else {
          // 3. Brand new account -- no password, sign-in is OAuth-only from here.
          const created = await prisma.user.create({
            data: {
              email: profile.email,
              passwordHash: null,
              name: profile.name,
              emailVerifiedAt: profile.emailVerified ? new Date() : null,
              oauthAccounts: {
                create: { provider: request.params.provider, providerAccountId: profile.providerAccountId },
              },
            },
          });
          userId = created.id;
          if (!profile.emailVerified) {
            sendVerificationEmail(created.id, created.email).catch((err) =>
              app.log.warn(err, "verification email failed"),
            );
          }
        }
      }

      await issueSession(app, reply, userId, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });
      // The web app's AuthProvider picks this session up itself on mount via
      // the refresh cookie just set above (same silent-refresh path used for
      // "still signed in from last time") -- no token needs to travel
      // through this redirect. /oauth-callback also triggers the
      // local-data-import step that login()/signup() normally do inline.
      return reply.redirect(`${WEB_ORIGIN}/oauth-callback`);
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
      const { name, resurfaceFrequency, highlightsPerDigest, kindleEmail } = request.body ?? {};

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
      if (kindleEmail !== undefined && kindleEmail.trim() !== "") {
        const trimmed = kindleEmail.trim();
        if (!EMAIL_RE.test(trimmed)) {
          return reply.code(400).send({ error: "invalid_kindle_email", message: "Enter a valid email address." });
        }
        if (!isKindleAddress(trimmed)) {
          return reply.code(400).send({
            error: "invalid_kindle_email",
            message: `Send to Kindle only delivers to Amazon addresses (${KINDLE_EMAIL_DOMAINS.map((d) => `@${d}`).join(" or ")}).`,
          });
        }
      }

      const user = await prisma.user.update({
        where: { id: request.userId! },
        data: {
          ...(name !== undefined ? { name: name.trim() || null } : {}),
          ...(resurfaceFrequency !== undefined ? { resurfaceFrequency } : {}),
          ...(highlightsPerDigest !== undefined ? { highlightsPerDigest } : {}),
          ...(kindleEmail !== undefined ? { kindleEmail: kindleEmail.trim() || null } : {}),
        },
      });

      const body: UserProfile = toUserProfile(user);
      return reply.send(body);
    },
  );

  /**
   * Delete this account and everything attached to it (#174).
   *
   * Immediate, not a 30-day soft delete. Three reasons, in order of weight:
   *
   * 1. Two of the acceptance criteria are "shared pages 404 immediately" and
   *    "PublicHighlightStat no longer counts the departing user". A grace
   *    period is precisely a window in which neither is true -- the Share
   *    rows are still there serving pages, and the aggregate is still
   *    counting a library its owner has asked to be rid of. A deletion that
   *    leaves your reading published for another month is not the thing
   *    anyone pressed the button for.
   * 2. The misclick this would protect against is already covered from the
   *    other side: export (exportAsMarkdownZip) has existed since before
   *    this route did, so "get your data out first" is a path a user can
   *    take, and the confirmation below is deliberately not a single click.
   * 3. Restorability would have to be a `deletedAt` column on User and a
   *    `deletedAt: null` clause in every query that reads a user -- a
   *    soft-delete that half the codebase forgets is worse than no
   *    soft-delete, because rows that look deleted keep being served.
   *
   * The cost, stated plainly: an attacker who has taken over an account can
   * destroy it, and there is no undo. That is a real loss, and it is the one
   * accepted here -- an attacker holding the password already has read access
   * to everything this account contains, which is the harm that cannot be
   * undone either way.
   *
   * On AUTH_ATTEMPT_LIMIT because it verifies a password. It is not an
   * unauthenticated guessing oracle (a valid access token is required to
   * reach it at all), which is also why a failure here deliberately does not
   * feed recordFailedLogin: someone who stole a token could otherwise run the
   * real owner's login into the escalating delay from #170.
   */
  app.delete<{ Body: DeleteAccountRequest }>(
    "/api/auth/me",
    { preHandler: requireAuth, config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.userId! } });
      if (!user) return reply.code(401).send({ error: "unauthorized", message: "Sign in required." });

      const { password, confirmEmail } = request.body ?? {};
      const refused = (message: string) => reply.code(403).send({ error: "confirmation_failed", message });

      // Same cap as login, same reason: an over-long value never reaches
      // scrypt, and it can't be a correct confirmation anyway.
      if (typeof password === "string" && password.length > MAX_PASSWORD_LENGTH) {
        return refused("That password is incorrect.");
      }

      if (user.passwordHash) {
        if (typeof password !== "string" || !verifyPassword(password, user.passwordHash)) {
          return refused("That password is incorrect.");
        }
      } else {
        // OAuth-only account (User.passwordHash is null): there is no
        // password to check, so the confirmation is typing the account's own
        // address. Weaker than a password -- the address is on screen the
        // whole time -- but it is a deliberate act rather than a click, which
        // is all a confirmation step can be here. Case- and whitespace-
        // insensitive, because the goal is intent, not dictation.
        if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
          return refused("Type your account's email address exactly to confirm.");
        }
      }

      // Step 1: the storage keys, BEFORE any row is deleted. Every table
      // cascades from User (verified against schema.prisma and the migration
      // DDL: every FK referencing "User"("id") is ON DELETE CASCADE), which
      // means these rows -- and the only record of which files belong to this
      // account -- are gone the instant step 2 runs. Read them first or the
      // bytes are unreachable forever.
      //
      // No `deletedAt: null` filter, unlike every read query in the app: a
      // trashed article's upload is still a file on disk.
      //
      // Same select and same flatMap as articles.ts's own deleteArticleFiles
      // (#173), which is module-private there. Duplicated rather than
      // exported across a route-module boundary for one caller; if a third
      // caller appears it belongs in storage-service.ts.
      const articles = await prisma.article.findMany({
        where: { userId: user.id },
        select: { fileStorageKey: true, audio: { select: { storageKey: true } } },
      });
      const storageKeys = articles
        .flatMap((article) => [article.fileStorageKey, article.audio?.storageKey])
        .filter((key): key is string => typeof key === "string" && key.length > 0);

      // Step 2: one delete, and the database takes the rest with it.
      await prisma.user.delete({ where: { id: user.id } });

      // Step 3: the files. Best-effort per key, matching how articles.ts
      // already treats storage deletion -- nothing references these any more,
      // so a failure here is an orphaned file to clean up later, not a reason
      // to tell someone their deletion failed when the account is already
      // gone.
      await Promise.all(
        storageKeys.map((key) =>
          deleteStoredFile(key).catch((err) => app.log.warn({ err, key }, "orphaned file after account deletion")),
        ),
      );

      // Step 4: the one aggregate that cannot cascade. PublicHighlightStat
      // stores no user ids on purpose (that is what makes it
      // non-deanonymizing), so deleting rows cannot possibly have updated it
      // -- a full rebuild is the only thing that drops this account's
      // contribution. Awaited, not fired and forgotten: "my highlights are
      // still being counted after I deleted my account" is the failure this
      // route exists to prevent, so it happens before the 204.
      await recomputePublicHighlightStats().catch((err) =>
        app.log.error({ err }, "public highlight aggregate still counts a deleted account"),
      );

      // The Session rows went with the cascade, so the refresh cookie in this
      // browser now points at nothing; clearing it stops every page load
      // starting with a failed refresh.
      clearRefreshCookie(reply);
      return reply.code(204).send();
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
      if (
        typeof newPassword !== "string" ||
        newPassword.length < 8 ||
        newPassword.length > MAX_PASSWORD_LENGTH
      ) {
        return reply
          .code(400)
          .send({ error: "invalid_password", message: "Password must be 8-128 characters." });
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

  // The one auth route that was left on the API-wide 300/minute rather than
  // the credential budget. Guessing a 256-bit token is not the threat -- it
  // is that this is the only unauthenticated route that reads a token table
  // and writes a User row, so it should cost what every other one costs.
  app.post<{ Body: VerifyEmailRequest }>(
    "/api/auth/verify-email",
    { config: { rateLimit: AUTH_ATTEMPT_LIMIT } },
    async (request, reply) => {
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
    },
  );

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

  app.get("/api/auth/sessions", { preHandler: requireAuth }, async (request, reply) => {
    const currentTokenHash = request.cookies[REFRESH_COOKIE_NAME]
      ? hashRefreshToken(request.cookies[REFRESH_COOKIE_NAME])
      : null;

    const sessions = await prisma.session.findMany({
      where: { userId: request.userId!, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    const body: SessionInfo[] = sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.refreshTokenHash === currentTokenHash,
    }));
    return reply.send(body);
  });

  app.delete<{ Params: { id: string } }>(
    "/api/auth/sessions/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await prisma.session.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!session) return reply.code(404).send({ error: "not_found", message: "Session not found." });

      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return reply.code(204).send();
    },
  );

  app.post("/api/auth/sessions/revoke-others", { preHandler: requireAuth }, async (request, reply) => {
    const currentTokenHash = request.cookies[REFRESH_COOKIE_NAME]
      ? hashRefreshToken(request.cookies[REFRESH_COOKIE_NAME])
      : null;

    const { count } = await prisma.session.updateMany({
      where: {
        userId: request.userId!,
        revokedAt: null,
        ...(currentTokenHash ? { refreshTokenHash: { not: currentTokenHash } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return reply.send({ revokedCount: count });
  });
}

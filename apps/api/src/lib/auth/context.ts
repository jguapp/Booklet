import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "./tokens.js";
import { hashApiToken, looksLikeApiToken } from "./api-token.js";
import { prisma } from "../prisma.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
    /** Set only when authenticated via a personal access token (not the
     * web/extension session JWT) -- lets a route (or a future scope check)
     * tell the two apart. Null for a normal session. */
    apiTokenScopes: string[] | null;
  }
}

/**
 * The one surface a personal access token authenticates on.
 *
 * A PAT is documented, minted and scoped as a credential for the versioned
 * public API (see routes/v1.ts and the developer settings page), and every
 * write route there is registered with requireWriteScope. Nothing enforced
 * that boundary: the token was accepted by the `onRequest` hook below for
 * *any* route, and the internal /api routes have no scope check at all
 * because they are only ever reached by a session. So a token minted with
 * scopes ["read"] -- handed to a third-party integration precisely because
 * it is supposed to be unable to change anything -- could PATCH and DELETE
 * articles through /api/articles, and worse: POST /api/tokens to mint itself
 * a fresh read+write token, POST /api/podcast/feed to mint a bearer URL for
 * the audio of the whole library, and DELETE /api/auth/me to destroy the
 * account. Confirmed by injection before this existed: 200, 201, 201, 204.
 *
 * Confining the credential is the fix rather than adding a scope check to
 * each internal route, for the same reason the podcast feed token is
 * confined to its own URL (see routes/podcast.ts): a per-route check has to
 * be remembered on every route added later, and this cannot be forgotten.
 * It also keeps a leaked PAT revocable -- a token that can mint another
 * token is not revocable at all, since revoking it leaves the one it made.
 */
const PAT_ROUTE_PREFIX = "/api/v1/";

/** Methods that cannot change state, so a read-only token may use them. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Matched against the *registered route pattern*, not `request.url`.
 *
 * The raw URL is attacker-shaped: a prefix test on it is a test on a string
 * the caller wrote, and anything that normalizes differently between this
 * check and the router (a `..` segment, an encoded slash) turns the check
 * and the routing into two different answers. routeOptions.url is whatever
 * the router actually matched, so the two cannot disagree. Absent (no route
 * matched -- a 404) means deny.
 */
function isVersionedApiRoute(request: FastifyRequest): boolean {
  return (request.routeOptions?.url ?? "").startsWith(PAT_ROUTE_PREFIX);
}

/**
 * Not a `fastify.register()` plugin on purpose -- it decorates the root
 * instance directly so `request.userId` is visible to every route without
 * dealing with fastify-plugin's encapsulation-breakout just for two lines.
 */
export async function setupAuthContext(app: FastifyInstance): Promise<void> {
  app.decorateRequest("userId", null);
  app.decorateRequest("apiTokenScopes", null);

  app.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const raw = header.slice("Bearer ".length);

    if (looksLikeApiToken(raw)) {
      // Left unauthenticated rather than rejected outright: several routes
      // (/api/extract, /api/tts, the public share pages) serve anonymous
      // callers, and answering 401 to a request that would have been served
      // without any header at all would break them for the sake of a better
      // error message. Routes that do need an account answer requireAuth's
      // own 401.
      if (!isVersionedApiRoute(request)) return;

      const record = await prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(raw) } });
      if (record && !record.revokedAt) {
        request.userId = record.userId;
        request.apiTokenScopes = record.scopes;
        // Fire-and-forget -- a lastUsedAt update failing/lagging shouldn't
        // hold up or fail the actual request it's just bookkeeping for.
        prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      }
      return;
    }

    request.userId = verifyAccessToken(raw);
  });

  /**
   * The same rule requireWriteScope states per route, enforced once for all
   * of them.
   *
   * requireWriteScope has to be remembered in each route's options, and a
   * v1 write route registered with `opts` instead of `writeOpts` would let a
   * read-only token through with nothing failing -- the mistake would only
   * be visible to someone reading the registration line. This hook keys on
   * the HTTP method instead, which the route cannot get wrong.
   */
  app.addHook("onRequest", async (request, reply) => {
    if (!request.apiTokenScopes || SAFE_METHODS.has(request.method)) return;
    if (request.apiTokenScopes.includes("write")) return;
    return reply.code(403).send({ error: "insufficient_scope", message: "This token doesn't have write access." });
  });
}

/** Route preHandler for /api/v1 write endpoints -- a read-only token
 * (scopes: ["read"]) can authenticate but not mutate anything. Session
 * (non-PAT) auth has no scopes to check, so it's always allowed through --
 * the web app itself isn't scope-restricted, only PATs are.
 *
 * Kept alongside the method-keyed hook in setupAuthContext, which enforces
 * the same rule globally, because this is where a reader of routes/v1.ts
 * sees that a route is a write. The hook is the guarantee; this is the
 * statement of intent. */
export async function requireWriteScope(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.apiTokenScopes && !request.apiTokenScopes.includes("write")) {
    reply.code(403).send({ error: "insufficient_scope", message: "This token doesn't have write access." });
  }
}

/** Route preHandler: 401s unless a valid access token was presented. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.userId) {
    reply.code(401).send({ error: "unauthorized", message: "Sign in required." });
  }
}

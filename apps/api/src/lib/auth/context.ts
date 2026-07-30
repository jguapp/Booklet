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
}

/** Route preHandler for /api/v1 write endpoints -- a read-only token
 * (scopes: ["read"]) can authenticate but not mutate anything. Session
 * (non-PAT) auth has no scopes to check, so it's always allowed through --
 * the web app itself isn't scope-restricted, only PATs are. */
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

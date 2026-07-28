import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

/**
 * Not a `fastify.register()` plugin on purpose -- it decorates the root
 * instance directly so `request.userId` is visible to every route without
 * dealing with fastify-plugin's encapsulation-breakout just for two lines.
 */
export async function setupAuthContext(app: FastifyInstance): Promise<void> {
  app.decorateRequest("userId", null);

  app.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      request.userId = verifyAccessToken(header.slice("Bearer ".length));
    }
  });
}

/** Route preHandler: 401s unless a valid access token was presented. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.userId) {
    reply.code(401).send({ error: "unauthorized", message: "Sign in required." });
  }
}

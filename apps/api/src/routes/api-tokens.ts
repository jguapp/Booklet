import type { FastifyInstance } from "fastify";
import type { ApiTokenSummary, CreateApiTokenRequest, CreateApiTokenResponse } from "@booklet/shared";
import { PODCAST_FEED_SCOPE } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { generateApiToken, hashApiToken } from "../lib/auth/api-token.js";

// PODCAST_FEED_SCOPE is deliberately absent: a feed token is handed out
// embedded in a URL (podcast clients cannot send headers), which means it
// ends up in client databases, sync services and access logs in a way a
// header-only PAT does not. A credential with that exposure must not also be
// mintable as something that can write to /api/v1.
const VALID_SCOPES = ["read", "write"];

/**
 * Feed tokens live in this table but are not personal access tokens, and the
 * two management surfaces stay separate -- which is exactly the "separately
 * revocable" the podcast feed needs (#154). Listing the feed token here would
 * put a "Revoke" button next to it that silently kills someone's podcast
 * subscription with no hint of what it was for; hiding it while still
 * accepting a DELETE for its id would be worse, since the developer page
 * would have a way to break the feed that it never shows. Podcast feed
 * tokens are minted and revoked only through /api/podcast/feed.
 */
const NOT_A_FEED_TOKEN = { NOT: { scopes: { has: PODCAST_FEED_SCOPE } } };

function toSummary(row: {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Management endpoints for a user's own personal access tokens --
 * authenticated by the normal web-app session (requireAuth), not by the
 * tokens themselves. The actual /api/v1 surface those tokens unlock lives
 * in routes/v1.ts.
 */
export async function registerApiTokenRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateApiTokenRequest }>(
    "/api/tokens",
    { preHandler: requireAuth },
    async (request, reply) => {
      const name = request.body?.name?.trim();
      if (!name) return reply.code(400).send({ error: "invalid_name", message: "A name is required." });

      const scopes = request.body?.scopes?.length ? request.body.scopes : ["read", "write"];
      if (!scopes.every((s) => VALID_SCOPES.includes(s))) {
        return reply.code(400).send({ error: "invalid_scopes", message: "Scopes must be 'read' and/or 'write'." });
      }

      const token = generateApiToken();
      const created = await prisma.apiToken.create({
        data: { userId: request.userId!, name, scopes, tokenHash: hashApiToken(token) },
      });

      const body: CreateApiTokenResponse = { ...toSummary(created), token };
      return reply.code(201).send(body);
    },
  );

  app.get("/api/tokens", { preHandler: requireAuth }, async (request, reply) => {
    const rows = await prisma.apiToken.findMany({
      where: { userId: request.userId!, revokedAt: null, ...NOT_A_FEED_TOKEN },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(rows.map(toSummary));
  });

  app.delete<{ Params: { id: string } }>(
    "/api/tokens/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.apiToken.findFirst({
        where: { id: request.params.id, userId: request.userId!, revokedAt: null, ...NOT_A_FEED_TOKEN },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Token not found." });
      await prisma.apiToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      return reply.code(204).send();
    },
  );
}

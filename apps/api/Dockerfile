# Builds and runs the Fastify API. Run from the repo root:
#   docker build -f apps/api/Dockerfile -t booklet-api .
#
# Written for correctness against this pnpm workspace (apps/api depends on
# packages/shared via the workspace protocol, so the whole workspace has to
# be present for `pnpm install` to link it) rather than for image size --
# it installs every workspace package's dependencies, including the mobile
# app's, which is heavier than an API image needs to be. A leaner version
# would use `pnpm deploy` (or turbo/nx's prune) to ship only apps/api and
# packages/shared into the final stage; not done here since a more complex
# multi-stage prune is more likely to hide a mistake than a straightforward
# one.
#
# The actual `docker build`/`docker run` commands are still unverified in
# this environment (Docker Desktop installed but its daemon needs WSL2,
# which isn't -- installing it needs a restart, out of scope to do
# unilaterally); see .github/workflows/ci.yml's docker-build job for that
# verification instead, which does run on a real runner. What *is* verified
# directly: `pnpm --filter @booklet/api build` (see scripts/build.mjs) then
# `node dist/index.js` under plain Node with no tsx/bundler help at
# runtime -- which is exactly what this image's CMD does -- actually boots
# Fastify and serves a real Prisma-backed request. That specific combination
# was broken before scripts/build.mjs and schema.prisma's
# importFileExtension existed (@booklet/shared resolves to raw, un-compiled
# TypeScript that only tsx/a bundler can load; the Prisma-generated client's
# own internal relative imports lacked the .js extension plain Node's ESM
# loader requires) -- confirmed by literally hitting that failure first.

FROM node:22-slim AS base
# Prisma's query engine needs libssl at runtime -- node:22-slim doesn't ship
# it, and the engine falls back to (and warns about) an assumed OpenSSL
# version without it. Needed in both stages: build for `prisma generate`,
# runtime for the server actually querying the database.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS build
# prisma.config.ts resolves DATABASE_URL eagerly just to *load*, even for
# `prisma generate`'s pure codegen (no connection actually made) --
# postinstall (pnpm install triggers it) fails without something here. Real
# value is supplied at `docker run` time (see docker-compose.yml); this
# placeholder never leaves the build stage.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public"
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @booklet/api exec prisma generate
RUN pnpm --filter @booklet/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

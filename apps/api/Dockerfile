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
# unilaterally); CI's docker-build job is what covered that instead, on a
# real runner. Note that job is currently dormant along with the rest of the
# Actions workflow -- see DEPLOYMENT.md's "Which CI config is live", and run
# the build by hand before trusting a change here. What *is* verified
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
# Bake Kokoro's ONNX weights into the image so no running container ever
# fetches them. Without this the ~90MB model downloads on the first
# read-aloud in every fresh container -- three times over, since the worker
# pool starts three processes that all cold-miss at once -- making the first
# request after a deploy a 10-60s wait and putting a core feature at the
# mercy of huggingface.co being reachable at request time.
#
# No ENV is needed to make this stick, and deliberately so: the installed
# @huggingface/transformers reads *no* cache environment variables at all
# (not HF_HOME, not TRANSFORMERS_CACHE, not HF_HUB_CACHE -- verified against
# its env.js, which hardcodes the path and only allows overriding it
# programmatically via env.cacheDir). It caches into
# node_modules/@huggingface/transformers/.cache/, and the runtime stage below
# copies /repo wholesale, node_modules included -- so running this here is
# sufficient on its own. Don't "fix" this by adding an HF_HOME; it would be
# silently ignored.
RUN node apps/api/scripts/prefetch-tts-model.mjs

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo

# Uploaded PDFs/EPUBs and generated podcast audio, moved off the application
# directory and onto a path a deployment can mount over (#173). Left where
# storage-service.ts's default puts it -- inside /repo -- every deploy
# replaced the container filesystem and destroyed every uploaded book while
# the database rows naming them survived. Mirrors postgres's own
# /var/lib/postgresql/data; docker-compose.yml mounts a named volume here.
#
# The directory is created here so the first upload isn't the thing that
# discovers it can't be made. This image declares no USER, so it runs as root
# and no chown is needed -- if a USER is ever added, this line has to grow a
# `chown` to it, or every upload fails EACCES on the mounted volume, which is
# owned by root the moment Docker creates it.
#
# Deliberately no `VOLUME` instruction: with no `-v`, that only gets you an
# anonymous volume, which is orphaned the moment the container is removed and
# is never reattached to the replacement. That looks like persistence in a
# restart test and loses everything on the redeploy this bug is about. The
# mount has to be named, and has to come from compose or the platform.
ENV FILE_STORAGE_PATH=/var/lib/booklet/storage
RUN mkdir -p /var/lib/booklet/storage

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

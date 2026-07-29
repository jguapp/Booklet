# Builds and runs the Next.js web app. Run from the repo root:
#   docker build -f apps/web/Dockerfile -t booklet-web .
#
# Uses Next's "standalone" output (see next.config.ts) -- a self-contained
# server bundle, so the runtime image doesn't need the full node_modules
# tree. Verified locally (twice now, across two different sessions) that
# `next build` actually produces the file layout this Dockerfile assumes --
# apps/web/Dockerfile's COPY paths were written by inspecting a real
# `.next/standalone` build, not guessed -- including that server.js ends up
# at exactly the path CMD expects and that .next/static and public/ really
# are missing from standalone/ and need their own COPY (both easy to get
# wrong, since standalone's whole point is *not* needing most of what a
# normal build produces). The `docker build`/`docker run` commands
# themselves are still unverified in this environment specifically (Docker
# Desktop installed but its daemon needs WSL2, which isn't -- installing it
# needs a restart, out of scope to do unilaterally); see
# .github/workflows/ci.yml's docker-build job for that verification
# instead, which does run on a real runner.
#
# NEXT_PUBLIC_API_URL is baked in at build time (Next.js inlines
# NEXT_PUBLIC_* vars into the client bundle) -- pass it as a build arg
# pointing at your deployed API before building, not as a runtime env var.

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
# `pnpm install` here is unfiltered (whole workspace, not just @booklet/web
# -- see the tradeoff noted above), so it still runs apps/api's postinstall
# too. That triggers `prisma generate`, which resolves DATABASE_URL just to
# load prisma.config.ts even though pure codegen never connects -- same fix
# as apps/api/Dockerfile, placeholder value that never leaves this stage
# (this image has no database access at runtime at all).
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public"
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @booklet/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

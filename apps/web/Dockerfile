# Builds and runs the Next.js web app. Run from the repo root:
#   docker build -f apps/web/Dockerfile -t booklet-web .
#
# Uses Next's "standalone" output (see next.config.ts) -- a self-contained
# server bundle, so the runtime image doesn't need the full node_modules
# tree. Verified locally that `next build` actually produces the file
# layout this Dockerfile assumes (apps/web/Dockerfile's COPY paths were
# written by inspecting a real `.next/standalone` build, not guessed) --
# building the *image* itself is unverified, no Docker in the environment
# this was written in.
#
# NEXT_PUBLIC_API_URL is baked in at build time (Next.js inlines
# NEXT_PUBLIC_* vars into the client bundle) -- pass it as a build arg
# pointing at your deployed API before building, not as a runtime env var.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
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

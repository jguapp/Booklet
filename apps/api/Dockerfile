# Builds and runs the Fastify API. Run from the repo root:
#   docker build -f apps/api/Dockerfile -t booklet-api .
#
# Written for correctness against this pnpm workspace (apps/api depends on
# packages/shared via the workspace protocol, so the whole workspace has to
# be present for `pnpm install` to link it) rather than for image size --
# it installs every workspace package's dependencies, including the mobile
# app's, which is heavier than an API image needs to be. A leaner version
# would use `pnpm deploy` (or turbo/nx's prune) to ship only apps/api and
# packages/shared into the final stage; not done here since this hasn't
# been build-tested (no Docker available in the environment this was
# written in) and a more complex multi-stage prune is more likely to hide
# a mistake than a straightforward one.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @booklet/api exec prisma generate
RUN pnpm --filter @booklet/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

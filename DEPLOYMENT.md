# Deployment

This is a starting point, not a verified runbook -- there's no Docker, no
cloud account, and no CI runner in the environment this was written in, so
none of it has actually been deployed anywhere. Treat every step here as
"reasoned through carefully," not "confirmed working."

## What you need

- A real PostgreSQL instance (not the `pglite` dev database -- see the main
  README's Getting Started section for why that exists and why it isn't
  for this)
- Somewhere to run the API (`apps/api`) as a long-lived Node process --
  it's a Fastify server, not a serverless function; don't try to deploy it
  to a platform that only runs request-scoped functions
- Somewhere to run the web app (`apps/web`) -- any Next.js host works
  (`output: "standalone"` is set in `next.config.ts` specifically so it
  isn't tied to one platform's build system)
- A JWT_ACCESS_SECRET (see `apps/api/.env.example` for how to generate one)

Optional, everything works without them (see the code comments where each
is read for the fallback behavior):

- `RESEND_API_KEY` -- without it, password reset / email verification /
  digest emails log to the console instead of sending
- `SENTRY_DSN` (API) / `NEXT_PUBLIC_SENTRY_DSN` (web) -- without them,
  error monitoring is a no-op

## Database

```bash
pnpm --filter @booklet/api exec prisma migrate deploy
```

Not `migrate dev` -- that wants a shadow database and interactive
confirmation, neither of which belong in a deploy step. `migrate deploy`
just applies whatever's in `apps/api/prisma/migrations/` that hasn't run
yet.

## Docker

`apps/api/Dockerfile` and `apps/web/Dockerfile` build each app; `docker-compose.yml`
wires them up with a real Postgres for local testing of the images
themselves. Comments in each file explain the specific tradeoffs (the api
image ships the whole repo rather than a pruned subset; the web image uses
Next's standalone output, verified against a real `next build`'s file
layout, but not build-tested end to end).

```bash
JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  docker compose up --build
```

## Environment-specific config to double-check before a real deploy

- **CORS**: `apps/api/src/app.ts` allows any `localhost:*` origin in dev
  and `chrome-extension://*` always (for the browser extension) -- in
  production it only allows the exact `WEB_ORIGIN` you set. Set it to
  your real deployed web app's origin.
- **Rate limiting**: in-memory (`@fastify/rate-limit`'s default store) --
  fine for one instance, silently stops being a real limit if you run more
  than one API instance behind a load balancer without switching to a
  shared store (Redis, via the plugin's `redis` option). Noted in the code
  where it's registered.
- **File storage**: `apps/api/src/services/storage-service.ts` writes
  PDF/EPUB uploads to local disk (`apps/api/storage/`). Fine for a single
  instance with a persistent volume; multiple instances or ephemeral
  containers need to swap this for S3 (or similar) -- the module's three
  functions (`saveFile`/`readStoredFile`/`deleteStoredFile`) are the only
  thing that needs replacing, per the comment at the top of that file.
- **`NEXT_PUBLIC_*` vars**: Next.js inlines these into the client bundle at
  *build* time, not runtime. `NEXT_PUBLIC_API_URL` and
  `NEXT_PUBLIC_SENTRY_DSN` need to be set when you build the web image, not
  just when you run it (see the Dockerfile's `ARG`s).

## What's explicitly not done here

- Actual hosting/provisioning -- this repo doesn't pick a cloud provider
  for you, on purpose; the API just needs "somewhere to run a Node
  process + Postgres reachable from it," which plenty of platforms cover
- TLS termination, secrets management, backups, autoscaling -- all
  infrastructure concerns for whatever you deploy onto, not this repo's
  job to solve generically
- CI actually running (`.github/workflows/ci.yml` exists and is
  syntax-checked, but this environment has no GitHub Actions runner to
  confirm it passes for real)

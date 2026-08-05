# Deployment

This is a starting point, not a verified runbook -- there's no cloud
account in the environment this was written in, so none of it has actually
been deployed anywhere for real. Treat every step here as "reasoned through
carefully and checked as far as this environment allows," not "confirmed
working in production." The Docker section below is more specific about
what that means in practice.

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
- `TTS_POOL_SIZE` (API, default `3`) -- Kokoro text-to-speech generates
  through this many real child processes (`apps/api/src/services/
  tts-pool.ts`), each holding its own quantized 82M-param model instance
  in memory for the process's whole lifetime, not per-request. Real but
  moderate memory cost per worker; size this to the host's actual
  headroom rather than leaving the default unexamined on a small instance.

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
image ships the whole repo rather than a pruned subset).

The actual `docker build`/`docker compose up` commands are unverified in
this specific environment: Docker Desktop is installed but its daemon
needs WSL2, which isn't installed here, and setting that up needs a
restart -- out of scope to do unilaterally. Two things stand in for that:

- `.github/workflows/ci.yml`'s `docker-build` job builds both images and
  boots the api one against a real Postgres service container on a real
  GitHub Actions runner, on every push/PR.
- The api image's actual production execution path -- `pnpm --filter
  @booklet/api build` (esbuild, see `apps/api/scripts/build.mjs`) then
  `node dist/index.js` under plain Node, no tsx or bundler doing module
  resolution favors at runtime, exactly what the image's `CMD` does -- was
  run directly (without Docker in between) against a real database and
  confirmed to actually boot Fastify and serve a Prisma-backed request.
  This is what caught two real bugs the Dockerfile alone wouldn't have
  surfaced without a build tool change: `@booklet/shared` resolves to raw,
  uncompiled TypeScript (fine for tsx/Next's bundler in dev; plain Node
  can't load it at all), and the Prisma-generated client's own internal
  relative imports were missing the `.js` extension plain Node's ESM
  loader requires (now forced via `schema.prisma`'s `importFileExtension`).

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
- Actually watching a GitHub Actions run complete: `.github/workflows/ci.yml`
  is real (not just syntax-checked) and includes typecheck/lint, unit and
  integration tests, web and extension e2e suites, and the docker-build job
  described above -- it runs automatically on every push to `main` and
  every PR, but confirming a specific run went green needs either repo
  access this environment doesn't have (no `gh` CLI, no API token) or you
  checking the Actions tab yourself

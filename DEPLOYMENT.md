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
- `REDIS_URL` (API) -- a shared, persistent second tier for the generated-
  speech cache (`apps/api/src/services/tts-cache.ts`). Without it the API
  uses only its in-process cache, which is correct but lost on every restart
  and every deploy, and not shared between instances -- meaning the first
  person to read anything after a release pays the full multi-second
  generation cost again for audio a previous instance had already produced.
  With it, that audio survives restarts and is shared across instances and
  across a user's devices. **Set a `maxmemory` and `allkeys-lru` on the Redis
  itself** (see `docker-compose.yml` for the shape) -- these entries are pure
  cache with a long TTL, so the right behavior under memory pressure is to
  evict the coldest, not Redis's default of refusing new writes. The API
  never blocks on Redis: lookups race a short timeout and a circuit breaker
  skips it entirely after a failure, so a down or slow Redis degrades to
  "no cache", never to "slow app".
- `TTS_REDIS_TTL_DAYS` (API, default `30`) -- how long cached audio survives
  in Redis without being read; refreshed on every hit.
- `TTS_RATE_LIMIT_MAX` (API, default `600` in production) -- requests per IP
  per 10 minutes against `/api/tts`. The default covers roughly 80 minutes of
  generated audio per IP; raise it if a shared NAT/office address legitimately
  hits it. **Read this together with `TRUST_PROXY` below** -- without that set
  correctly, this limit applies to your proxy rather than per user, and no
  value here is large enough.
- `TTS_CACHE_MAX_MB` (API, default `200`) -- caps the in-memory cache of
  already-generated speech audio (`apps/api/src/services/tts-cache.ts`),
  keyed by voice + speed + the exact text so replaying an article (or
  re-reading a paragraph) skips generation entirely instead of paying the
  full cost again. Held in the main server process's own memory (not a
  separate cache service), evicted LRU once this cap is hit, and lost on a
  restart -- it just repopulates as things get read again, not a real cost
  at this app's scale.

## Observability

Error tracking (Sentry) and performance tracing are separate, and both are
optional. Sentry answers "what broke"; the tracing below answers "what was
slow", which after a release's worth of read-aloud latency work is the
question there was previously no way to ask about real users at all.

- `OTEL_EXPORTER_OTLP_ENDPOINT` (API) -- where to send traces, e.g.
  `http://localhost:4318` for a local Datadog Agent or OpenTelemetry
  Collector. Without it, tracing is entirely off: no exporter, no background
  work, no spans (`apps/api/src/lib/telemetry.ts`). The instrumentation is
  OpenTelemetry rather than Datadog's own SDK deliberately -- Datadog is a
  first-class OTLP backend, so pointing this at Grafana/Tempo or Honeycomb
  later is a change to this variable rather than to any code.

  The spans worth knowing about are on `tts.generate_pooled`:
  `tts.queue_wait_ms` (waiting for a free worker) and `tts.generate_ms` (the
  model actually running) are recorded separately, because they mean
  different things and are fixed in different places -- queue wait means the
  pool is too small for the load, generation means the model is slow on this
  hardware. `tts.cache_tier` is `l1` (in-process), `l2` (Redis), or `miss`.
- `OTEL_SERVICE_NAME` (API, default `booklet-api`) -- the service name traces
  are grouped under.
- `NEXT_PUBLIC_DD_RUM_APPLICATION_ID` / `NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN`
  (web) -- enables Datadog RUM, which is what actually reports real-world
  time-to-first-audio (`apps/web/src/lib/rum.ts`). Reported as a `tts.ttfa`
  action tagged with `prewarm_hit`, so warm and cold plays can be read
  separately rather than averaged into a number that describes neither.
  Without both set, RUM is off and the SDK is never even downloaded.

  The RUM **client token** is publishable and write-only, which is what makes
  `NEXT_PUBLIC_` correct for it. A Datadog **API key** is not, and must never
  be given to the web app. Session replay is explicitly disabled: it would
  record whatever the reader is reading.
- `NEXT_PUBLIC_DD_SITE` (web, default `datadoghq.com`) -- set to your
  Datadog region's site (e.g. `datadoghq.eu`) if it isn't US1.

`/api/tts` also returns a `Server-Timing` header (`cache`, `queue`, `gen`)
on every successful response, readable in the browser regardless of whether
any of the above is configured. It carries `Timing-Allow-Origin` for the
requesting origin, without which a browser hides `Server-Timing` on a
cross-origin response -- and the API is always a different origin from the
web app here.

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
- **`TRUST_PROXY`**: set this to `true` if — and only if — the API sits
  behind a reverse proxy or load balancer you control (Fly, Railway, Render,
  nginx, Cloudflare; essentially every real deployment). Rate limiting keys
  on `request.ip`, and without `trustProxy` that resolves to the *proxy's*
  address rather than the client's, so **every user in the world shares a
  single rate-limit bucket** and read-aloud stops working for everyone within
  minutes of any real traffic. This is invisible locally and in
  `docker-compose` because neither has a proxy in front, so test it
  explicitly against your actual deployment. Leave it unset when nothing
  trusted sits in front: `X-Forwarded-For` is client-controlled, so trusting
  it without a proxy to overwrite it lets anyone bypass rate limiting by
  spoofing a fresh IP per request.
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

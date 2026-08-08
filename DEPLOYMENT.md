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
- **A mounted persistent disk for uploaded files, with `FILE_STORAGE_PATH`
  pointing at it** -- as non-optional as the database, and for the same
  reason: it holds user data that exists nowhere else. See "File storage"
  below.

Optional, everything works without them (see the code comments where each
is read for the fallback behavior):

- `PORT` (API, default `4000`) and `API_ORIGIN` (API, default
  `http://localhost:4000`) -- `API_ORIGIN` is this server's own public URL and
  must match the redirect URI registered with each OAuth provider exactly, so
  it is not optional once Google/GitHub sign-in is configured.
- `RESEND_API_KEY` -- without it, password reset / email verification /
  digest emails log to the console instead of sending
- `EMAIL_FROM` (API, default `Booklet <onboarding@resend.dev>`) -- the
  default is Resend's shared testing sender, which is not a domain you own.
  Set this to an address on a domain verified in your own Resend account
  before a real deploy; the default is for getting the flow working, not for
  sending to real users.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID` /
  `GITHUB_CLIENT_SECRET` (API) -- each provider's button only appears in the
  UI once its pair is set (`GET /api/auth/oauth/providers` reports which).
- `SENTRY_DSN` (API) / `NEXT_PUBLIC_SENTRY_DSN` (web) -- without them,
  error monitoring is a no-op
- `TTS_POOL_SIZE` (API, default: one worker per available core, capped at 3)
  -- Kokoro text-to-speech generates through this many real child processes
  (`apps/api/src/services/tts-pool.ts`), each holding its own quantized
  82M-param model instance in memory for the process's whole lifetime, not
  per-request. The default is derived from `availableParallelism()` rather
  than fixed, because a fixed 3 on a 2-vCPU host made three concurrent
  generations take 2.86x a single one instead of ~1x (#162) -- three processes
  each sizing their ONNX thread pool to the whole machine is contention, not
  concurrency. Real but moderate memory cost per worker; override only to size
  down on a small instance, since above 3 the player has nothing to do with
  the extra capacity.
- `TTS_INTRA_OP_THREADS` (API, default: the core count divided by the pool
  size) -- the ONNX intra-op thread budget given to each worker. The other
  half of the #162 fix; override only if you are deliberately co-locating the
  API with something else that needs the cores.
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
- `API_PUBLIC_URL` (API) -- the absolute base used for the podcast feed URL
  and every `<enclosure>` in it (`apps/api/src/routes/podcast.ts`). Derived
  from the request's own `Host` header by default, which is right in dev and
  in `docker-compose`. Set it explicitly behind a TLS-terminating proxy:
  `request.protocol` reads `http` there unless `TRUST_PROXY` is on, and an
  https feed handing out http enclosures is a downgrade iOS's ATS refuses to
  download at all.
- `PODCAST_VOICE` (API, default `af_heart`) -- the Kokoro voice every podcast
  episode is generated with. The feed picks one because a podcast client has
  no access to the reader's per-device voice preference. Changing it is a
  cache invalidation, not a migration: the voice is recorded on each
  `ArticleAudio` row, so episodes generated with the old one are rebuilt on
  the next feed fetch.

## Rate limits

Every limit here except `AUTH_FAILED_LOGIN_LIMIT` keys on the client IP, so
**read them together with `TRUST_PROXY` below** -- set that wrong and they all
apply to your proxy rather than per user, at which point no value is large
enough. Defaults are sized for a real deployment; the variables exist mainly
so the e2e suite, which drives the whole app from one address in a couple of
minutes, can raise them for its own run. `TTS_RATE_LIMIT_MAX` belongs to this
group too, and is documented with the other read-aloud knobs above.

- `GLOBAL_RATE_LIMIT_MAX` (API, default `300` per minute) -- the API-wide
  ceiling every route sits under, including the ones with a tighter budget of
  their own. This is what actually bounds a flood.
- `AUTH_ATTEMPT_RATE_LIMIT_MAX` (API, default `100` per 15 minutes) -- signup,
  login and the password-reset routes, the ones with a guessable credential.
  Raised from 10 in #170: ten was sized for one person, but behind an office
  NAT or a carrier's CGNAT hundreds of unrelated people present as one
  address, and six of them mistyping once each spent the whole budget for
  everybody.
- `AUTH_REFRESH_RATE_LIMIT_MAX` (API, default `120` per 15 minutes) --
  `/api/auth/refresh` only, deliberately *not* on the budget above (#169). It
  looks like an auth route but is ordinary traffic the web app issues on every
  load, so sharing the credential-guessing budget meant the app spent the
  user's password-attempt allowance just by working.
- `AUTH_FAILED_LOGIN_LIMIT` (API, default `5`) -- failed logins allowed per
  *account* before the next attempt starts waiting 5s, then 10s, 20s, capped
  at 15 minutes and decaying after an hour of quiet (#170). Unlike the others
  this does not key on IP, which is the point: addresses are cheap to rent, so
  a per-IP ceiling is a budget an attacker simply buys more of. It escalates a
  wait rather than locking the account, so knowing someone's email address is
  never a way to keep them signed out.
- `PUBLIC_SHARE_RATE_LIMIT_MAX` (API, default `120` per minute) -- the two
  routes anyone can reach with no session at all: `GET /api/public/shares/
  :slug` and `GET /api/public/seeds`. Tighter than the app-wide limit because
  it makes share-slug enumeration hopeless in wall-clock terms as well as
  arithmetic ones, on traffic with no account behind it.
- `TTS_WARM_RATE_LIMIT_MAX` (API, default `120` in production) -- the
  `/api/tts/warm` route, which returns no audio and so gets its own bucket:
  one reader-open legitimately fires one warm call plus a real chunk fetch,
  and those shouldn't compete for the same allowance.
- `EXTRACTION_ALLOW_PRIVATE_ADDRESSES` (API) -- **test-only.** Set to `"true"`
  it lets article extraction fetch private/loopback addresses, which is how
  the e2e suite hits its local fixture server instead of the real internet. It
  is ignored outright under `NODE_ENV=production` (`apps/api/src/lib/
  private-address.ts`), so the SSRF protection it relaxes is not overridable
  where it matters. Never set it in a deployment.

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

**Request logs are redacted, and must stay that way.** Two routes carry their
credential in the URL path -- `/podcast/:token/…` (a bearer token for the full
audio of a user's library, which survives a password change) and
`/api/public/shares/:slug` (the entire access control for a share page). Pino's
default `req` serializer logs `req.url` at info level, so every podcast poll
would write a working credential into the log stream, i.e. into whichever
aggregator has a much broader access list than the database does. The
serializer in `apps/api/src/app.ts` replaces just that segment
(`/podcast/[redacted]/feed.xml`) and leaves the rest of the path intact. If you
add a route with a secret in its path, add it there too; if you replace the
logger, keep the serializer.

`/api/tts` also returns a `Server-Timing` header (`cache`, `queue`, `gen`)
on every successful response, readable in the browser regardless of whether
any of the above is configured. It carries `Timing-Allow-Origin` for the
requesting origin, without which a browser hides `Server-Timing` on a
cross-origin response -- and the API is always a different origin from the
web app here.

## Health checks and shutdown

Two endpoints, answering two different questions. Pointing the wrong probe at
the wrong one is how a deploy takes the whole service down.

- **`GET /api/health` -- liveness.** Process-local: it returns `ok` plus TTS
  pool state and touches nothing outside this process. Point a *restart*
  probe here. It is deliberately not a database check, because failing this
  means "kill this container", and a Postgres blip would then roll every
  instance at once, turning a recoverable dependency outage into a full one.
  Note the corollary: **this endpoint returns `ok` on an instance where every
  real request is 500ing**, which is precisely why the next one exists.
- **`GET /api/ready` -- readiness.** Runs `SELECT 1` against Postgres with a
  2s ceiling and returns `200 {"status":"ready"}` or `503
  {"status":"unavailable","error":"database_unreachable"}`. Point the *load
  balancer* and the *rolling-deploy gate* here. Rotated credentials, an
  exhausted connection pool, or a network partition all show up here and
  nowhere else — without it, a deploy reads a green liveness check and drains
  the last instance that still worked. The 503 body deliberately carries no
  detail (the endpoint is unauthenticated by necessity, and Postgres errors
  name hosts and usernames); the actual error is logged as
  `readiness probe failed`.
- `docker-compose.yml`'s `api` service has a matching `healthcheck` block
  using `/api/ready`, with a 60s `start_period` because `prisma migrate
  deploy` runs before the server starts. Copy that shape onto whatever you
  actually deploy with.

**Shutdown drains.** `SIGTERM`/`SIGINT` closes the server first — in-flight
requests run to completion — then flushes telemetry, then exits, with a 12s
ceiling so one connection that never goes idle cannot hold a deploy open
forever (`closeWithTimeout` in `apps/api/src/app.ts`). Two things follow for
whatever runs this:

- **Give the platform's own kill timer more than 12s** (Kubernetes'
  `terminationGracePeriodSeconds`, Fly's `kill_timeout`, `docker stop -t`).
  Set it lower and the platform `SIGKILL`s mid-drain, which is the behaviour
  the drain replaced.
- **Still not drained: work that is not an HTTP request.** A podcast episode
  being generated when the signal arrives is lost — the TTS pool kills its
  workers on `SIGTERM` (`services/tts-pool.ts`) and the feed regenerates the
  episode on the next fetch. Fine, but it means a redeploy loop faster than
  generation can leave a popular feed never catching up.

## Database

```bash
pnpm --filter @booklet/api exec prisma migrate deploy
```

Not `migrate dev` -- that wants a shadow database and interactive
confirmation, neither of which belong in a deploy step. `migrate deploy`
just applies whatever's in `apps/api/prisma/migrations/` that hasn't run
yet.

## File storage

**This needs a mounted persistent disk, in exactly the sense the database
does. Without one the app destroys user data on the next deploy.**

`apps/api/src/services/storage-service.ts` writes two kinds of file to local
disk: the uploaded PDF/EPUB behind `Article.fileStorageKey`, and the
generated podcast enclosure behind `ArticleAudio.storageKey`. Both are named
by rows in Postgres, and neither is anywhere else -- the web app deliberately
clears its own IndexedDB copy of an uploaded book once the server has
accepted it, so after a signup migration the server holds the only copy of
files the user may no longer have at all.

- `FILE_STORAGE_PATH` (API, default `apps/api/storage/`) -- absolute path to
  write them under. **The default is a directory inside the application**,
  which is right for `pnpm dev` and catastrophic in a deployment: container
  filesystems are replaced on every deploy on every platform this is likely
  to run on (Fly, Railway, Render, Cloud Run, plain `docker compose up -d
  --build`), and often on restart. Set it to a mount point on a real volume
  and the library survives releases; leave it unset and the first routine
  redeploy after launch empties every reader while the library page still
  lists everything, because the rows are still there.
- In `docker-compose.yml` this is the `storage-data` named volume mounted at
  `/var/lib/booklet/storage`, declared the same way `postgres-data` and
  `redis-data` are. `apps/api/Dockerfile` creates that directory and sets
  `FILE_STORAGE_PATH` to it; on any other platform, attach a volume and point
  the variable at it yourself.
- **Back it up alongside Postgres, not separately.** A database backup
  restored next to a lost disk gives you rows pointing at files that don't
  exist -- a library that lists correctly and opens empty, which is worse
  than a visible failure. `GET /api/articles/:id/file` 404s, and podcast
  clients 404 on enclosures they already listed.
- **A mounted disk is a single-instance answer.** It works, completely, for
  one API process. It stops working the moment there are two: instance A
  cannot serve a file instance B wrote, so uploads and podcast enclosures
  start failing for whichever half of the requests land on the wrong box.
  Object storage (S3/R2/GCS) is the real fix, and this module was written to
  make it a change to three functions rather than to their callers -- but it
  is not done here. Until it is, run one API instance.

## Docker

`apps/api/Dockerfile` and `apps/web/Dockerfile` build each app; `docker-compose.yml`
wires them up with a real Postgres for local testing of the images
themselves. Comments in each file explain the specific tradeoffs (the api
image ships the whole repo rather than a pruned subset).

The actual `docker build`/`docker compose up` commands are unverified in
this specific environment: Docker Desktop is installed but its daemon
needs WSL2, which isn't installed here, and setting that up needs a
restart -- out of scope to do unilaterally. Two things stand in for that:

- A `docker-build` job builds both images and boots the api one against a
  real throwaway Postgres container. It exists in both CI configs
  (`.github/workflows/ci.yml` and `.gitlab-ci.yml`), and its GitHub Actions
  form is the one that has actually run on a real runner -- see "Which CI
  config is live" below before assuming it still does.
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

- **CORS / `WEB_ORIGIN`**: `apps/api/src/app.ts` allows any `localhost:*`
  origin in dev and `chrome-extension://*` always (for the browser
  extension) -- in production it only allows the exact `WEB_ORIGIN` you set.
  Set it to your real deployed web app's origin. **The API now refuses to
  start under `NODE_ENV=production` if it is unset or malformed**
  (`apps/api/src/lib/cors.ts`), same treatment `JWT_ACCESS_SECRET` gets, and
  for the same reason: the old behaviour was a server that started fine,
  logged nothing, answered `curl` correctly (curl sends no `Origin`) and left
  the web app completely broken with only browser-console errors. It must be
  exactly `scheme://host[:port]`: **a trailing slash fails the check**,
  because a browser's `Origin` header never has one, and so does anything
  with a path or query. The one thing the guard cannot see is an `http` vs
  `https` mismatch against what the browser actually sends — if CORS still
  fails on a value that booted, check the scheme first.
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

  There is no guard for this one, because nothing inside the process can know
  what sits in front of it -- so it is instrumented instead. The API logs the
  resolved value once at startup (`startup: trust proxy resolved`) and, on the
  first request it serves, whether that request carried `X-Forwarded-For`
  alongside the `request.ip` every rate limit keys on (`startup: first request
  proxy shape`). **Read those two lines after any deploy.** `xForwardedFor:
  true` with `trustProxy: false` means every user is in one bucket; the
  reverse means `X-Forwarded-For` is unfiltered client input and rate limiting
  is bypassable. `ip` matching your proxy's address on every request is the
  same first failure seen from the other side.
- **Rate limiting**: in-memory (`@fastify/rate-limit`'s default store) --
  fine for one instance, silently stops being a real limit if you run more
  than one API instance behind a load balancer without switching to a
  shared store (Redis, via the plugin's `redis` option). Noted in the code
  where it's registered.
- **`FILE_STORAGE_PATH`**: the one item in this list that loses data rather
  than degrading an experience, and the one that fires without anyone doing
  anything wrong -- shipping a routine change is enough. Set it to a mounted
  persistent disk before the first deploy, not after. Full detail in "File
  storage" above.
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
- Actually watching a CI run complete: both pipelines are real (not just
  syntax-checked) and each includes typecheck/lint, unit and integration
  tests, web and extension e2e suites, and the docker-build job described
  above -- but confirming a specific run went green needs either repo access
  this environment doesn't have (no `gh` CLI, no API token) or you checking
  the pipeline yourself. Which one to check is the next section.

## Which CI config is live

**Two full pipelines exist in this repository and it is not safe to assume
either is currently running on your pushes.** They are equivalent in coverage
-- the same seven jobs -- so this is a question of where they execute, not of
what they check:

- `.github/workflows/ci.yml` -- was the live pipeline, and is the one whose
  runs have actually gone green on real hardware. **The Actions allowance for
  this repository is exhausted**, so it is dormant: the file is still valid
  and still triggers, the minutes to run it are gone.
- `.gitlab-ci.yml` -- the intended replacement, a port rather than a copy
  (service hostnames, service readiness and Docker-in-Docker networking all
  genuinely differ). It has never run on a GitLab runner, because the
  repository lives on GitHub. Until it is moved or mirrored to GitLab it
  "sits in the repository harmlessly and runs nothing," in the words of
  [`docs/CI_GITLAB.md`](docs/CI_GITLAB.md) -- read that file before switching,
  particularly the section on minutes: GitLab.com's free tier is **smaller**
  than Actions', not larger, and a self-hosted runner is the only option that
  actually solves the problem that prompted the move.

So the honest current state is that **nothing is verifying pushes
automatically**. Until one pipeline is genuinely live, `pnpm verify` is the
stand-in: it runs everything checkable without a running service and then
names what it skipped, including `docker-build`, which is the check that has
caught the most real bugs and which no local command covers.

Do not delete either config on that basis. Deleting the Actions workflow
throws away the only pipeline with a proven-green history for a replacement
that has never executed; deleting the GitLab one throws away the migration
work and the minutes analysis behind it. The drift between them is the real
risk, and it has already started -- see the note at the top of
`.github/workflows/ci.yml`.

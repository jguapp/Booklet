# GitLab CI/CD

The pipeline lives in [`.gitlab-ci.yml`](../.gitlab-ci.yml). It is a port of
`.github/workflows/ci.yml` — same seven jobs, same reasoning, adapted where
GitLab genuinely behaves differently.

## Read this first: minutes

The move to GitLab was prompted by running out of GitHub Actions minutes. It is
worth being clear that **GitLab.com's free tier is smaller, not larger**:

| | Free tier, private project |
|---|---|
| GitHub Actions | 2,000 minutes/month |
| GitLab.com shared runners | 400 compute minutes/month |

This pipeline costs roughly **20–25 minutes per full run** (`test-web-e2e`
alone is ~9–10 of that). On GitLab.com's shared runners that is about
**16 runs a month** before the allowance is gone.

So if the goal is "stop running out", shared runners will not achieve it. The
options that actually do:

1. **Register a self-hosted runner.** Free, unlimited minutes — you only pay for
   the machine, and any always-on box or cheap VPS will do. This is almost
   certainly the right answer here, and it also makes `test-web-e2e` much faster
   than a 2-vCPU shared runner.
   ```
   # on the machine that will run jobs
   gitlab-runner register --url https://gitlab.com --token <project runner token>
   # choose the "docker" executor, default image node:22-bookworm
   ```
   `docker-build` additionally needs `privileged = true` in the runner's
   `config.toml` for Docker-in-Docker.
2. **Keep using GitHub Actions** and buy minutes, or make the repository public
   (Actions is free for public repositories, and so are GitLab shared runners).

The pipeline is already written to waste as little as possible: superseded
pipelines cancel, docs-only commits skip entirely, and the benchmark no longer
runs per-merge-request. Those changes matter more on a small allowance, not
less.

## Connecting a GitHub-hosted repository

The repository currently lives on GitHub. GitLab CI/CD only runs on GitLab, so
the code has to reach GitLab somehow:

- **Move the repository to GitLab** — simplest, if you are switching outright.
- **Mirror it.** On GitLab: *New project → Import project → Repository by URL*,
  then *Settings → Repository → Mirroring repositories* for ongoing pull
  mirroring. Pull mirroring on the free tier updates on a schedule (roughly
  every 30 minutes) rather than instantly, so pipelines lag pushes.
  *Note:* "CI/CD for external repositories", which gives GitHub-integrated
  status checks and instant triggering, is a **Premium** feature.

Until one of those is in place, `.gitlab-ci.yml` sits in the repository
harmlessly and runs nothing.

## Project settings that the file cannot set itself

- **Settings → CI/CD → General pipelines → Auto-cancel redundant pipelines.**
  Must be enabled. Every job sets `interruptible: true`, which is necessary but
  not sufficient — without the project setting, pushing five times still runs
  five pipelines to completion. This is the single biggest source of wasted
  minutes.
- **Runner must allow privileged mode** for `docker-build` (Docker-in-Docker).
  GitLab.com's shared runners already do.

## What changed in the port, and why

Three differences are structural rather than cosmetic:

1. **Service hostnames.** GitHub maps a service container to `localhost`;
   GitLab gives it a hostname. Every `DATABASE_URL` for a job with Postgres
   points at `postgres:5432`, not `localhost:5432`.
2. **No service health checks.** GitHub had `--health-cmd` with retries. GitLab
   starts the container and moves on, so each Postgres job begins with an
   explicit `wait-on tcp:postgres:5432`.
3. **Docker-in-Docker networking.** Under dind, `-p 4000:4000` publishes on the
   dind container, not on the job — so `localhost:4000` from the job refuses the
   connection. The API smoke test therefore runs on a shared docker network and
   is probed by a throwaway `curlimages/curl` container.

Two smaller ones:

- **pnpm store location.** GitLab can only cache paths inside the project
  directory, so `before_script` relocates the store to
  `$CI_PROJECT_DIR/.pnpm-store` (gitignored). Without this the cache silently
  stores nothing.
- **No `sudo`.** The `node:22-bookworm` image already runs as root, so
  `apt-get install xvfb` is called directly.

### The docs-only skip is inverted

GitHub has `paths-ignore`. GitLab's `changes:` matches when *any* listed path
changed, so an ignore-list would also skip a merge request touching docs **and**
code — the common case, and the wrong outcome. The `workflow:rules` therefore
list the paths that *should* trigger a run. A docs-only merge request matches
nothing and gets no pipeline.

Same caveat as the Actions version: if a pipeline is ever made a required check
for merging, this must become a job that runs and no-ops, or a docs-only merge
request can never merge.

## Verification

The parts that can be checked without a GitLab runner were run locally against
this repository, command for command:

| | |
|---|---|
| `before_script` (corepack → store-dir → `pnpm install --frozen-lockfile`) | passes |
| `typecheck-and-lint` (all four typechecks, lint, esbuild bundle) | passes |
| `test-unit` (shared 115, web 40) | passes |
| `test-api` against a host literally named `postgres` | 249 passed, 1 skipped |
| `wait-on tcp:postgres:5432` | resolves and returns |

One thing that surfaced only by running it: relocating the pnpm store makes
pnpm want to purge `node_modules`, and it **aborts without a TTY** unless `CI`
is set. GitLab sets `CI=true` automatically so the pipeline is fine, but the
same commands run by hand will stop unless you export it.

Not verifiable here: `docker-build` (no Docker daemon in the dev sandbox),
`bench-tts-ttfa` and parts of `test-web-e2e` (they need huggingface.co and other
hosts this sandbox blocks). Those ran green on GitHub Actions on the same
commits.

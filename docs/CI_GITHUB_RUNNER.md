# CI on a self-hosted GitHub Actions runner

Booklet's CI (`.github/workflows/ci.yml`) runs on a **self-hosted runner** — a
machine you own, registered to the repository — instead of GitHub-hosted VMs.

## Why

GitHub only bills minutes for _GitHub-hosted_ runners. A runner you host is
**free and unmetered**. That is the whole reason for the move: the hosted
Actions allowance, and GitLab's (smaller) free tier, both ran out mid-branch
and left pushes silently unverified. A self-hosted runner has no meter to run
out of. The cost moves from a per-minute bill to a machine you keep running —
an old laptop, a spare box, or a small always-on VPS (~$5–12/mo) all work.

There is no longer a GitLab pipeline. It was removed with this change; this is
the one and only CI config.

## What the runner machine needs

The runner _registers_ without these, but jobs will fail without them, so
install them first:

- **Linux, x64 or arm64.** (The workflow's `runs-on: [self-hosted, linux, x64]`
  labels select an x64 runner. On ARM, change `x64` → `arm64` in both
  `.github/workflows/ci.yml` and when registering.)
- **Docker**, and the runner's user in the `docker` group. Two jobs need it:
  the `services:` Postgres containers (`test-api`, `test-web-e2e`,
  `test-extension-e2e`) and `docker-build`.
- **Passwordless sudo** for the runner's user. The `test-web-e2e` and
  `test-extension-e2e` jobs run `apt-get`/`xvfb` and `playwright install
  --with-deps`, which need it.
- **git**, **curl**, and a C toolchain (`build-essential`) — the API has native
  dependencies (onnxruntime, canvas) that may compile on `pnpm install`.
- Node and pnpm are **not** prerequisites — the workflow's `setup-node` /
  `pnpm/action-setup` steps provision them into the runner's tool cache.

A one-time provisioning on Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y docker.io git curl build-essential
sudo usermod -aG docker "$USER"    # log out/in for this to take effect
# Give the runner user passwordless sudo (adjust the username):
echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/github-runner
```

## Registering the runner

1. Open **`https://github.com/jguapp/Booklet/settings/actions/runners/new`**
   and copy the `--token` value from the "Configure" box (it is short-lived,
   ~1 hour).
2. On the runner machine, from a checkout of this repo:

   ```bash
   RUNNER_TOKEN=<paste-token> ./scripts/register-github-runner.sh
   ```

   The script detects your architecture, downloads the latest runner, registers
   it with the repo, and installs it as a **systemd service** so it survives
   reboots and logouts. The runner process runs as your (non-root) user — CI
   jobs should never run as root.
3. Confirm it shows as **Idle** at
   `https://github.com/jguapp/Booklet/settings/actions/runners`. The next push
   to a PR or to `main` runs on it.

Managing it later:

```bash
cd ~/actions-runner
sudo ./svc.sh status     # is it running?
sudo ./svc.sh stop       # pause CI (jobs will queue until you start it again)
sudo ./svc.sh start
```

## Running jobs in parallel

One runner runs **one job at a time**, so the seven CI jobs serialize (a full
run is ~20–25 min end to end when serial). To parallelize, register more
runners — the same script, a fresh token each, and a distinct directory:

```bash
RUNNER_DIR=~/actions-runner-2 RUNNER_NAME=booklet-2 RUNNER_TOKEN=<new-token> \
  ./scripts/register-github-runner.sh
```

GitHub distributes queued jobs across all Idle runners that match the labels.
Three runners covers the widest jobs (the three e2e/`services:` jobs) running
at once.

## Security notes

A self-hosted runner executes whatever a workflow tells it to, on your machine.
Two things worth knowing:

- **Keep it on a private repository, or restrict who can trigger it.** On a
  public repo, a fork's pull request could run arbitrary code on your runner.
  Booklet is private, which is the safe case; if that ever changes, set
  _Settings → Actions → Fork pull request workflows_ to require approval before
  running.
- **Prefer a disposable machine or a container** for the runner if you can, so
  a bad build can't reach anything you care about. A dedicated VPS or a VM is
  ideal; your daily-driver laptop is the least ideal.

## Verifying the same checks locally

Whether or not a runner is online, `pnpm verify` runs everything checkable
without a live service and names what it skipped — including `docker-build`,
which no local command fully covers. It is the stand-in when you want the
signal before pushing. See `DEPLOYMENT.md`.

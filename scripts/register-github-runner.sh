#!/usr/bin/env bash
#
# Register this machine as a self-hosted GitHub Actions runner for Booklet.
#
# Why this exists: GitHub only meters minutes for *GitHub-hosted* runners.
# A runner you host yourself is free and unmetered -- which is the whole point
# of moving here after the hosted allowance (and GitLab's smaller free tier)
# kept running out mid-branch. See docs/CI_GITHUB_RUNNER.md for the full setup,
# including the prerequisites this script does NOT install for you (Docker,
# Node's build toolchain, passwordless sudo).
#
# Usage:
#   RUNNER_TOKEN=<token> ./scripts/register-github-runner.sh
#     or
#   ./scripts/register-github-runner.sh <token>
#
# Get <token> from:
#   https://github.com/jguapp/Booklet/settings/actions/runners/new
# (the "Configure" box shows a `--token ...` value). It is short-lived, ~1h --
# generate a fresh one each time you register a runner. Nothing here is stored
# in the repo; the token is used once, to register, and then discarded.
#
# Registering more than one runner (each in its own directory, each a separate
# fresh token) lets the seven CI jobs run in parallel instead of serially --
# run this script again from a different RUNNER_DIR with a new token.

set -euo pipefail

# --- inputs ----------------------------------------------------------------

REPO_URL="${REPO_URL:-https://github.com/jguapp/Booklet}"
RUNNER_TOKEN="${RUNNER_TOKEN:-${1:-}}"
# The labels the workflow's `runs-on: [self-hosted, linux, x64]` selects on.
# `self-hosted` is applied automatically by config.sh; linux/x64 are the
# defaults for this platform. If your box is ARM, the workflow's `x64` label
# won't match -- change it there and here to `arm64`.
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64}"
# A stable name so re-running is recognisable in the repo's runner list.
RUNNER_NAME="${RUNNER_NAME:-booklet-$(hostname -s 2>/dev/null || hostname)}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"

if [[ -z "$RUNNER_TOKEN" ]]; then
  echo "error: no registration token." >&2
  echo "  RUNNER_TOKEN=<token> $0   (get one at ${REPO_URL}/settings/actions/runners/new)" >&2
  exit 1
fi

# --- platform detection ----------------------------------------------------

case "$(uname -m)" in
  x86_64 | amd64) RUNNER_ARCH="x64" ;;
  aarch64 | arm64) RUNNER_ARCH="arm64" ;;
  *)
    echo "error: unsupported architecture $(uname -m). GitHub ships runners for x64 and arm64 only." >&2
    exit 1
    ;;
esac
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "error: this script targets Linux. On macOS/Windows follow the manual steps in the repo's runner setup page." >&2
  exit 1
fi

# --- friendly prerequisite check (warn, don't block) -----------------------
# The runner will *register* without these, but jobs will fail without them.
# Better to say so now than to have someone chase a red `services:` container
# an hour later.
missing=()
command -v docker >/dev/null 2>&1 || missing+=("docker (needed for the Postgres service containers and the docker-build job)")
command -v git >/dev/null 2>&1 || missing+=("git")
sudo -n true 2>/dev/null || missing+=("passwordless sudo (the xvfb and playwright --with-deps steps use it)")
if ((${#missing[@]})); then
  echo "warning: this machine is missing things CI jobs need:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "  Register anyway, but see docs/CI_GITHUB_RUNNER.md and install them before trusting a green run." >&2
  echo >&2
fi

# --- fetch the latest runner release ---------------------------------------

echo "Looking up the latest actions/runner release..."
LATEST_TAG="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
  | grep -oE '"tag_name":\s*"v[0-9.]+"' | head -1 | grep -oE '[0-9.]+')"
if [[ -z "${LATEST_TAG:-}" ]]; then
  echo "error: could not determine the latest runner version from the GitHub API." >&2
  echo "  Set RUNNER_VERSION=x.y.z explicitly and re-run to pin it by hand." >&2
  exit 1
fi
RUNNER_VERSION="${RUNNER_VERSION:-$LATEST_TAG}"
TARBALL="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"

# --- download + extract ----------------------------------------------------

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [[ ! -x ./config.sh ]]; then
  echo "Downloading runner ${RUNNER_VERSION} (${RUNNER_ARCH})..."
  curl -fsSL -o "$TARBALL" "$URL"
  tar xzf "$TARBALL"
  rm -f "$TARBALL"
else
  echo "Runner already extracted in ${RUNNER_DIR}; reconfiguring."
fi

# --- configure -------------------------------------------------------------
# --unattended: no prompts. --replace: re-registering the same name just
# updates it instead of erroring, so re-running this script is safe.
echo "Registering '${RUNNER_NAME}' with ${REPO_URL} (labels: ${RUNNER_LABELS})..."
./config.sh \
  --url "$REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --unattended \
  --replace

# --- install as a service so it survives reboots and logouts ---------------
# svc.sh needs root to write the systemd unit; the runner itself still runs as
# the invoking (non-root) user, which is what you want -- CI jobs should not
# run as root.
echo "Installing the runner as a systemd service..."
sudo ./svc.sh install "$(whoami)"
sudo ./svc.sh start

echo
echo "Done. '${RUNNER_NAME}' should now show as Idle at:"
echo "  ${REPO_URL}/settings/actions/runners"
echo "It will pick up jobs from .github/workflows/ci.yml on the next push."
echo "Manage it with:  cd ${RUNNER_DIR} && sudo ./svc.sh {status,stop,start}"

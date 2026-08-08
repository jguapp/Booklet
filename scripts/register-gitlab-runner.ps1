# Registers a machine as a self-hosted GitLab runner for this project.
#
# Why this exists: GitLab.com's shared-runner minutes ran out. Every job in the
# pipeline failed at once with `ci_quota_exceeded` and `runner: NONE`, which
# looks alarming but is an account limit, not a code failure -- the same wall
# that ended the GitHub Actions era and prompted the move here in the first
# place. A self-hosted runner has no minute quota, so this is the durable fix
# rather than buying minutes twice.
#
#   1. Install the runner binary (once):
#        New-Item -ItemType Directory -Force C:\GitLab-Runner
#        Invoke-WebRequest `
#          -Uri https://gitlab-runner-downloads.s3.amazonaws.com/latest/binaries/gitlab-runner-windows-amd64.exe `
#          -OutFile C:\GitLab-Runner\gitlab-runner.exe -UseBasicParsing
#
#   2. Create a runner in GitLab and copy its token:
#        Settings > CI/CD > Runners > "New project runner"
#        Tick "Run untagged jobs" -- no job in .gitlab-ci.yml carries tags, so
#        an untagged-only runner would sit idle while every job queued forever.
#        Choose platform Linux, not Windows: the executor below runs each job
#        inside a Linux container, so the host OS is irrelevant to the jobs.
#
#   3. pwsh -File scripts/register-gitlab-runner.ps1 -Token glrt-xxxxxxxxxxxx
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$RunnerDir = "C:\GitLab-Runner",
  [string]$Description = "booklet-local"
)

$ErrorActionPreference = "Stop"
$exe = Join-Path $RunnerDir "gitlab-runner.exe"
if (-not (Test-Path $exe)) { throw "gitlab-runner.exe not found at $exe -- see step 1 in this file's header." }

# Docker executor, not shell. .gitlab-ci.yml is written against docker and
# depends on both halves of it: a per-job `image:` (node:22-bookworm, the
# Playwright image, docker:27-cli) and `services:` for Postgres, which the
# shell executor does not implement at all. A shell runner would quietly run
# every job against whatever happens to be installed on the host and start no
# Postgres -- a green pipeline that proved nothing, which is worse than a red
# one.
& $exe register `
  --non-interactive `
  --url "https://gitlab.com/" `
  --token $Token `
  --executor "docker" `
  --docker-image "node:22-bookworm" `
  --description $Description `
  --docker-privileged `
  --docker-volumes "/certs/client" `
  --docker-shm-size 2147483648

# --docker-privileged plus the /certs/client volume exist for docker-build,
# which runs Docker-in-Docker; without them that job cannot start a daemon and
# fails before it builds anything.
#
# shm-size 2GB is for the Playwright jobs. Chromium's default 64MB /dev/shm is
# not enough for real pages, and it fails as intermittent "Target closed"
# errors that name nothing about the real cause.

Write-Host ""
Write-Host "Registered. Config: $(Join-Path $RunnerDir 'config.toml')"
Write-Host "Run in the foreground:  $exe run"
Write-Host "Or install as a service (needs an elevated shell):"
Write-Host "  $exe install; $exe start"

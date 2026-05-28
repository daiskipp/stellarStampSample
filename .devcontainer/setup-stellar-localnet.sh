#!/usr/bin/env bash
# Ensure the stellar-localnet sibling container is running.
#
# docker-compose `depends_on` only starts dependencies on the initial `up`.
# After a manual `docker stop`, host reboot, or other state where the sibling
# has exited, `devcontainer restart` (which only restarts the dev service)
# won't bring stellar-localnet back. The `restart: unless-stopped` policy in
# docker-compose.yml covers daemon-level restarts; this script covers the
# manual-stop case and acts as a defensive idempotent post-start step.
#
# The container is located by compose service label so we don't have to
# hardcode the project name (which tracks the host's checkout directory and
# differs between clones — `stampsample_devcontainer-…`, `stamp_devcontainer-…`,
# plain `devcontainer-…`).

set -uo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "[setup-stellar-localnet] docker CLI not available; skipping"
  exit 0
fi

CID=$(docker ps -a \
  --filter "label=com.docker.compose.service=stellar-localnet" \
  --format '{{.ID}} {{.Label "com.docker.compose.project"}}' \
  | awk '{print $1}' \
  | head -n1)

if [ -z "${CID:-}" ]; then
  echo "[setup-stellar-localnet] no stellar-localnet sibling container found; skipping"
  exit 0
fi

STATE=$(docker inspect -f '{{.State.Status}}' "$CID" 2>/dev/null || echo "unknown")
echo "[setup-stellar-localnet] container=$CID state=$STATE"

if [ "$STATE" = "running" ]; then
  exit 0
fi

echo "[setup-stellar-localnet] starting…"
if docker start "$CID" >/dev/null; then
  echo "[setup-stellar-localnet] started"
else
  echo "[setup-stellar-localnet] docker start failed (non-fatal)" >&2
  exit 1
fi

#!/usr/bin/env bash
set -uo pipefail

LOG_DIR="${HOME}/.cache/stampsample-devcontainer"
LOG_FILE="${LOG_DIR}/setup-all.log"
mkdir -p "$LOG_DIR"

run_step() {
  local name="$1"
  shift

  echo "[$(date -Is)] setup step start: $name"
  if "$@"; then
    echo "[$(date -Is)] setup step ok: $name"
  else
    local status=$?
    echo "[$(date -Is)] setup step failed ($status): $name" >&2
    return "$status"
  fi
}

status=0

{
  echo "[$(date -Is)] setup-all start"
  run_step docker-sock bash .devcontainer/setup-docker-sock.sh || status=1
  run_step stellar-localnet bash .devcontainer/setup-stellar-localnet.sh || status=1
  run_step stellar-cli bash .devcontainer/setup-stellar-cli.sh || status=1
  run_step ai-clis bash .devcontainer/setup-ai-clis.sh || status=1
  echo "[$(date -Is)] setup-all done status=$status"
} 2>&1 | tee -a "$LOG_FILE"

exit "$status"

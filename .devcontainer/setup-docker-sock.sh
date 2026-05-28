#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${HOME}/.cache/stampsample-devcontainer"
LOG_FILE="${LOG_DIR}/setup-docker-sock.log"
SOCKET_PATH="${DOCKER_HOST#unix://}"

if [[ "$SOCKET_PATH" == "$DOCKER_HOST" ]]; then
  SOCKET_PATH="/var/run/docker.sock"
fi

mkdir -p "$LOG_DIR"

{
  echo "[$(date -Is)] setup-docker-sock start"
  echo "USER=${USER:-unknown}"
  echo "DOCKER_HOST=${DOCKER_HOST:-unset}"
  echo "SOCKET_PATH=$SOCKET_PATH"

  if [[ ! -S "$SOCKET_PATH" ]]; then
    echo "Docker socket not found; skipping permission setup."
    echo "[$(date -Is)] setup-docker-sock done"
    exit 0
  fi

  if docker ps >/dev/null 2>&1; then
    echo "Docker socket is already accessible."
    echo "[$(date -Is)] setup-docker-sock done"
    exit 0
  fi

  echo "Docker socket is not accessible; applying devcontainer socket permissions."
  sudo chmod 666 "$SOCKET_PATH"

  docker ps >/dev/null
  echo "Docker socket is accessible."
  echo "[$(date -Is)] setup-docker-sock done"
} 2>&1 | tee -a "$LOG_FILE"

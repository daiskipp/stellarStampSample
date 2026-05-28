#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${HOME}/.cache/stampsample-devcontainer"
LOG_FILE="${LOG_DIR}/setup-stellar-cli.log"
INSTALL_DIR="${HOME}/.local/bin"

mkdir -p "$LOG_DIR" "$INSTALL_DIR"

{
  echo "[$(date -Is)] setup-stellar-cli start"
  echo "HOME=$HOME"
  echo "USER=${USER:-unknown}"
  echo "INSTALL_DIR=$INSTALL_DIR"

  export PATH="$INSTALL_DIR:$PATH"

  if command -v stellar >/dev/null 2>&1; then
    echo "Stellar CLI already installed: $(stellar version | head -n 1)"
    echo "[$(date -Is)] setup-stellar-cli done"
    exit 0
  fi

  echo "Installing Stellar CLI..."
  curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh -s -- --user --install-deps

  echo "Stellar CLI installed:"
  stellar version | head -n 1
  echo "[$(date -Is)] setup-stellar-cli done"
} 2>&1 | tee -a "$LOG_FILE"

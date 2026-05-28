#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${HOME}/.cache/stampsample-devcontainer"
LOG_FILE="${LOG_DIR}/setup-ai-clis.log"
NPM_GLOBAL_DIR="${HOME}/.npm-global"

unset NPM_CONFIG_PREFIX
mkdir -p "$LOG_DIR" "$NPM_GLOBAL_DIR"

{
  echo "[$(date -Is)] setup-ai-clis start"
  echo "HOME=$HOME"
  echo "USER=${USER:-unknown}"
  echo "NPM_GLOBAL_DIR=$NPM_GLOBAL_DIR"
  echo "node=$(command -v node || true)"
  echo "npm=$(command -v npm || true)"

  export PATH="$NPM_GLOBAL_DIR/bin:$PATH"

  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is missing. Rebuild the devcontainer after installing the Node feature." >&2
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is missing. Rebuild the devcontainer after installing the Node feature." >&2
    exit 1
  fi

  if ! command -v claude >/dev/null 2>&1; then
    echo "Installing Claude Code..."
    if [[ -w /usr/local/lib/node_modules && -w /usr/local/bin ]]; then
      npm install -g @anthropic-ai/claude-code
    else
      npm install --prefix "$NPM_GLOBAL_DIR" -g @anthropic-ai/claude-code
    fi
  else
    echo "Claude Code already installed: $(claude --version)"
  fi

  echo "AI CLI tools available:"
  claude --version
  echo "[$(date -Is)] setup-ai-clis done"
} 2>&1 | tee -a "$LOG_FILE"

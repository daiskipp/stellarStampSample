#!/usr/bin/env bash
set -euo pipefail

# Reproducibly fetch + build smart-account-kit from source.
#
# npm's published smart-account-kit (0.2.10) is ABI-incompatible with the
# current OpenZeppelin Stellar account contract; this project uses the
# unpublished 0.3.0 (regenerated bindings) wired via `file:` from
# .oz-build/smart-account-kit (gitignored). Run this BEFORE the root
# `pnpm install` on a clean clone, otherwise the `file:` deps don't resolve.
#
# Idempotent. Requires: git, pnpm, network (build:bindings fetches the OZ
# account contract spec from the network in demo/.env — public Testnet by
# default; the Testnet OZ account WASM 8537b8… shares the ABI we deploy on
# localnet, so the generated bindings match).
#
# Pin override:  KIT_COMMIT=<sha> bash scripts/build-kit.sh

cd "$(dirname "$0")/.."

KIT_REPO="${KIT_REPO:-https://github.com/kalepail/smart-account-kit}"
KIT_COMMIT="${KIT_COMMIT:-6f1c035}"   # version 0.3.0 (no upstream tags)
KIT_DIR=".oz-build/smart-account-kit"

mkdir -p .oz-build

if [ ! -d "$KIT_DIR/.git" ]; then
  echo "Cloning $KIT_REPO -> $KIT_DIR"
  git clone --filter=blob:none "$KIT_REPO" "$KIT_DIR"
else
  echo "Updating existing $KIT_DIR"
  git -C "$KIT_DIR" fetch --quiet origin
fi

echo "Checking out pinned commit $KIT_COMMIT"
git -C "$KIT_DIR" checkout --quiet "$KIT_COMMIT"

# build:bindings reads demo/.env (Testnet defaults are correct here).
if [ ! -f "$KIT_DIR/demo/.env" ]; then
  cp "$KIT_DIR/demo/.env.example" "$KIT_DIR/demo/.env"
  echo "Created $KIT_DIR/demo/.env from .env.example"
fi

echo "Installing kit deps..."
( cd "$KIT_DIR" && CI=true pnpm install )

echo "Building kit (bindings + tsc)..."
( cd "$KIT_DIR" && pnpm run build:all )

# Verify the artifacts the repo's `file:` deps + pnpm override point at.
test -f "$KIT_DIR/dist/index.js" \
  || { echo "ERROR: $KIT_DIR/dist/index.js missing after build" >&2; exit 1; }
test -f "$KIT_DIR/packages/smart-account-kit-bindings/dist/index.js" \
  || { echo "ERROR: smart-account-kit-bindings/dist/index.js missing" >&2; exit 1; }

echo ""
echo "smart-account-kit built ($(node -e "console.log(require('./$KIT_DIR/package.json').version)") @ $KIT_COMMIT)."
echo "Next: CI=true pnpm install   (resolves the file: deps at the repo root)"

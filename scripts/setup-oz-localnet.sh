#!/usr/bin/env bash
set -euo pipefail

# Deploy the OZ smart-account infra (`account.wasm` upload +
# `webauthn_verifier.wasm` deploy) to the devcontainer localnet and write the
# resulting hash / contract id into every env file that the dicekey apps and
# the sa-harness read.
#
# Why this exists: `tools/sa-harness/.env` lists OZ infra contract addresses
# that were originally deployed by hand and persisted in the stellar-data
# docker volume. Wiping that volume (host reboot, manual `docker volume rm`,
# fresh clone) drops the contracts but leaves the now-stale ids in .env, so
# `kit.createWallet` fails because `VITE_ACCOUNT_WASM_HASH` is not on the
# ledger. This script restores the infra in an idempotent way so a fresh
# localnet "just works".
#
# Idempotency:
#   - `stellar contract upload --wasm account.wasm` is deterministic (hash is
#     content-addressed); re-uploading the same bytes is a no-op on the ledger.
#   - `stellar contract deploy --wasm webauthn_verifier.wasm` creates a NEW
#     contract every call. We only redeploy when
#     `VITE_WEBAUTHN_VERIFIER_ADDRESS` is blank in tools/sa-harness/.env;
#     blank that line (or the whole VITE_ACCOUNT_WASM_HASH) to force a
#     redeploy after a volume reset.
#
# Coverage: only the 2 OZ contracts strictly required by the dicekey flow are
# handled here (smart-account.ts:63-64 hard-checks VITE_ACCOUNT_WASM_HASH +
# VITE_WEBAUTHN_VERIFIER_ADDRESS). ed25519 verifier / native SAC / policy
# contracts are unused on localnet (autoFund is skipped per harness.ts:94-97)
# and are intentionally NOT touched.

cd "$(dirname "$0")/.."
source scripts/_env.sh

NETWORK="${NETWORK:-localnet}"
SOURCE="${DEPLOY_SOURCE:-deployer}"
KIT_WASM_DIR=".oz-build/kit-wasm"
ACCOUNT_WASM="${KIT_WASM_DIR}/account.wasm"
WEBAUTHN_VERIFIER_WASM="${KIT_WASM_DIR}/webauthn_verifier.wasm"

# Same env file set as deploy-localnet.sh — keep them in sync so a single OZ
# infra change propagates to harness + apps + .env.localnet together.
ENV_FILES=(
  ".env.localnet"
  "tools/sa-harness/.env"
  "apps/customer-app/.env"
  "apps/staff-app/.env"
)

echo "=== OZ smart-account infra (network=$NETWORK) ==="

[ -f "$ACCOUNT_WASM" ] || {
  echo "ERROR: $ACCOUNT_WASM missing. Run: bash scripts/build-kit.sh" >&2
  exit 1
}
[ -f "$WEBAUTHN_VERIFIER_WASM" ] || {
  echo "ERROR: $WEBAUTHN_VERIFIER_WASM missing. Run: bash scripts/build-kit.sh" >&2
  exit 1
}

# Ensure the deployer identity exists and is funded (mirrors deploy-localnet).
stellar keys address "$SOURCE" >/dev/null 2>&1 || {
  echo "Generating identity '$SOURCE'..."
  stellar keys generate "$SOURCE" --network "$NETWORK"
}
DADDR=$(stellar keys address "$SOURCE")
curl -s -m 20 "http://stellar-localnet:8000/friendbot?addr=${DADDR}" -o /dev/null || true

# Read the first non-empty value of $1 across ENV_FILES — used so subsequent
# runs respect an already-deployed webauthn_verifier id.
read_env_kv() {
  local key="$1" f v
  for f in "${ENV_FILES[@]}"; do
    [ -f "$f" ] || continue
    v=$(grep -E "^${key}=" "$f" | head -n1 | cut -d= -f2- || true)
    if [ -n "${v:-}" ]; then printf '%s' "$v"; return 0; fi
  done
  return 0
}

# In-place K=V replacement (copy of deploy-localnet.sh's helper). Values are
# content-addressed hex / C-addresses → no shell-special chars to worry about.
set_kv() {
  local key="$1" val="$2" file="$3" line tmp
  if grep -qE "^${key}=" "$file"; then
    tmp="$(mktemp)"
    while IFS= read -r line || [ -n "$line" ]; do
      if [ "${line%%=*}" = "$key" ]; then echo "${key}=${val}"; else echo "$line"; fi
    done < "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "Uploading account.wasm (idempotent: content-addressed)..."
ACCOUNT_HASH=$(stellar contract upload \
  --wasm "$ACCOUNT_WASM" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  2>/dev/null | tr -d '[:space:]')
if [ -z "$ACCOUNT_HASH" ]; then
  echo "ERROR: stellar contract upload returned an empty hash" >&2
  exit 1
fi
echo "  -> hash=$ACCOUNT_HASH"

EXISTING_VERIFIER=$(read_env_kv VITE_WEBAUTHN_VERIFIER_ADDRESS)
VERIFIER_ID=""
if [ -n "${EXISTING_VERIFIER:-}" ]; then
  # Probe on-chain existence: `contract fetch` returns the deployed wasm if
  # the contract is live, fails if the volume was wiped and the id is stale.
  if stellar contract fetch \
        --id "$EXISTING_VERIFIER" \
        --network "$NETWORK" \
        >/dev/null 2>&1; then
    echo "webauthn_verifier $EXISTING_VERIFIER is live on $NETWORK; skipping deploy."
    VERIFIER_ID="$EXISTING_VERIFIER"
  else
    echo "webauthn_verifier $EXISTING_VERIFIER not on chain (stale id from a wiped volume); redeploying..."
  fi
fi

if [ -z "$VERIFIER_ID" ]; then
  echo "Deploying webauthn_verifier.wasm..."
  VERIFIER_ID=$(stellar contract deploy \
    --wasm "$WEBAUTHN_VERIFIER_WASM" \
    --source "$SOURCE" \
    --network "$NETWORK")
  echo "  -> $VERIFIER_ID"
fi

for f in "${ENV_FILES[@]}"; do
  [ -f "$f" ] || continue
  set_kv VITE_ACCOUNT_WASM_HASH         "$ACCOUNT_HASH" "$f"
  set_kv VITE_WEBAUTHN_VERIFIER_ADDRESS "$VERIFIER_ID"  "$f"
  echo "Updated $f"
done

echo "Done."

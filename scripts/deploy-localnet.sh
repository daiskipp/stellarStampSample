#!/usr/bin/env bash
set -euo pipefail

# Deploy the 5 dicekey contracts to the devcontainer localnet and update the
# VITE_*_CONTRACT lines in .env.localnet and tools/sa-harness/.env in place
# (the OZ smart-account infra / HQ SA lines are preserved).
#
# Prereqs: localnet up (stellar-localnet:8000), `localnet` network alias,
# `deployer` identity funded. Run scripts/generate-bindings.sh + the sa-setup
# harness afterwards.

cd "$(dirname "$0")/.."
source scripts/_env.sh

NETWORK="${NETWORK:-localnet}"
SOURCE="${DEPLOY_SOURCE:-deployer}"
WASM_DIR="target/wasm32v1-none/release"
# The app .env files must track the fresh contract ids too: staff-app's
# issueStamp() builds its dicekey bindings from VITE_*_CONTRACT, so a stale id
# there would target an old (or archived) contract even though the harness
# bootstrap used the new one.
ENV_FILES=(
  ".env.localnet"
  "tools/sa-harness/.env"
  "apps/customer-app/.env"
  "apps/staff-app/.env"
)

echo "=== dicekey Coffee Stamps - localnet deploy (network=$NETWORK) ==="

stellar keys address "$SOURCE" >/dev/null 2>&1 || {
  echo "Generating identity '$SOURCE'..."
  stellar keys generate "$SOURCE" --network "$NETWORK"
}
DADDR=$(stellar keys address "$SOURCE")
curl -s -m 20 "http://stellar-localnet:8000/friendbot?addr=${DADDR}" -o /dev/null || true

echo "Building contracts (stellar contract build -> wasm32v1-none)..."
# Must be wasm32v1-none: newer rustc emits Soroban-incompatible wasm under
# wasm32-unknown-unknown (state-changing calls trap UnreachableCodeReached).
stellar contract build >/dev/null

declare -A IDS
for c in dicekey_visit_stamps dicekey_beans_token dicekey_benefits dicekey_badges dicekey_reward_policy; do
  wasm="${WASM_DIR}/${c}.wasm"
  [ -f "$wasm" ] || { echo "ERROR: $wasm missing"; exit 1; }
  echo "Deploying ${c}..."
  IDS[$c]=$(stellar contract deploy --wasm "$wasm" --source "$SOURCE" --network "$NETWORK")
  echo "  -> ${IDS[$c]}"
done

set_kv() { # key value file
  local key="$1" val="$2" file="$3"
  if grep -qE "^${key}=" "$file"; then
    # in-place replace, value may contain no special chars (C-addresses)
    local tmp; tmp="$(mktemp)"
    while IFS= read -r line || [ -n "$line" ]; do
      if [ "${line%%=*}" = "$key" ]; then echo "${key}=${val}"; else echo "$line"; fi
    done < "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

for f in "${ENV_FILES[@]}"; do
  [ -f "$f" ] || continue
  set_kv VITE_VISIT_STAMPS_CONTRACT "${IDS[dicekey_visit_stamps]}" "$f"
  set_kv VITE_BEANS_TOKEN_CONTRACT  "${IDS[dicekey_beans_token]}"  "$f"
  set_kv VITE_BENEFITS_CONTRACT     "${IDS[dicekey_benefits]}"     "$f"
  set_kv VITE_BADGES_CONTRACT       "${IDS[dicekey_badges]}"       "$f"
  set_kv VITE_REWARD_POLICY_CONTRACT "${IDS[dicekey_reward_policy]}" "$f"
  # Redeploy invalidates prior admin wiring; sa-setup re-initializes & re-wires.
  set_kv VITE_HQ_SMART_ACCOUNT "" "$f"
  set_kv VITE_HQ_ROOT_CREDENTIAL_ID "" "$f"
  set_kv VITE_HQ_STAFF_CONTEXT_RULE_ID "" "$f"
  set_kv VITE_HQ_STAFF_BENEFITS_RULE_ID "" "$f"
  set_kv VITE_DEMO_CUSTOMER_SA "" "$f"
  echo "Updated $f"
done

echo "Done. Next: scripts/generate-bindings.sh then the sa-setup harness."

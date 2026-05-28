#!/usr/bin/env bash
set -euo pipefail

# Deploy the 5 dicekey contracts to Stellar Testnet and write a fresh
# .env.testnet (complete schema, HQ SA / staff-rule keys left blank for
# scripts/sa-setup-testnet.mjs to fill).
#
# Usage:
#   bash scripts/deploy-testnet.sh
#
# Prereqs:
#   - stellar CLI installed (Soroban CLI)
#   - cargo installed (stellar contract build invokes it)
#   - a `testnet` network alias configured on the stellar CLI
#
# Build target:
#   wasm32v1-none via `stellar contract build`. `cargo build --release
#   --target wasm32-unknown-unknown` (the previous approach) emits
#   Soroban-incompatible wasm under the devcontainer rustc and every
#   state-changing entrypoint traps `UnreachableCodeReached` post-deploy.

# 🔴 The devcontainer / nix-shell exports STELLAR_RPC_URL=http://stellar-localnet:8000/rpc
#    and STELLAR_NETWORK_PASSPHRASE="Standalone Network ; February 2017" so localnet
#    flows work without `--network localnet`. Those env vars SILENTLY OVERRIDE
#    `--network testnet` on the stellar CLI — every `stellar contract deploy
#    --network testnet` then actually targets localnet, while the harness/kit
#    (reading VITE_RPC_URL from .env.testnet) talks to public Testnet. The
#    cross-network split traps "Error(Storage, MissingValue): non-existing
#    contract instance" on initialize.
unset STELLAR_RPC_URL STELLAR_NETWORK_PASSPHRASE STELLAR_FRIENDBOT_URL STELLAR_NETWORK

cd "$(dirname "$0")/.."

NETWORK="testnet"
SOURCE="dicekey-admin"
WASM_DIR="target/wasm32v1-none/release"
ENV_FILE=".env.testnet"

echo "=== dicekey Coffee Stamps - Testnet Deploy ==="

# --- Pre-flight: tooling -----------------------------------------------------
command -v stellar >/dev/null 2>&1 || {
  echo "ERROR: stellar CLI not found in PATH" >&2
  exit 1
}
command -v cargo >/dev/null 2>&1 || {
  echo "ERROR: cargo not found in PATH (stellar contract build needs it)" >&2
  exit 1
}

# --- Step 1: Identity --------------------------------------------------------
if stellar keys address "$SOURCE" >/dev/null 2>&1; then
  echo "Using existing identity '$SOURCE'"
else
  echo "Creating identity '$SOURCE'..."
  stellar keys generate "$SOURCE" --network "$NETWORK"
fi
ADMIN_ADDRESS=$(stellar keys address "$SOURCE")
echo "Admin G-address: ${ADMIN_ADDRESS}"

# Idempotent friendbot top-up. `stellar keys fund` is a no-op on an
# already-funded account.
echo "Funding via friendbot (idempotent)..."
stellar keys fund "$SOURCE" --network "$NETWORK" || true

# --- Step 2: Build (wasm32v1-none) ------------------------------------------
echo "Building contracts (stellar contract build -> wasm32v1-none)..."
stellar contract build >/dev/null

# --- Step 3: Deploy ----------------------------------------------------------
CONTRACTS=(
  dicekey_visit_stamps
  dicekey_beans_token
  dicekey_benefits
  dicekey_badges
  dicekey_reward_policy
)

declare -A CONTRACT_IDS
for c in "${CONTRACTS[@]}"; do
  wasm="${WASM_DIR}/${c}.wasm"
  [ -f "$wasm" ] || { echo "ERROR: $wasm missing (build did not produce it)" >&2; exit 1; }
  echo "Deploying ${c}..."
  CONTRACT_IDS[$c]=$(stellar contract deploy \
    --wasm "$wasm" \
    --network "$NETWORK" \
    --source "$SOURCE")
  echo "  -> ${CONTRACT_IDS[$c]}"
done

echo ""
echo "=== Deployed Contract IDs ==="
for c in "${CONTRACTS[@]}"; do
  echo "${c}: ${CONTRACT_IDS[$c]}"
done

# --- Step 4: Write .env.testnet ---------------------------------------------
# Back up any existing file so an accidental re-run doesn't lose HQ SA values
# written there by scripts/sa-setup-testnet.mjs.
if [ -f "$ENV_FILE" ]; then
  BAK="${ENV_FILE}.bak"
  echo "Backing up existing ${ENV_FILE} -> ${BAK}"
  mv "$ENV_FILE" "$BAK"
fi

cat > "$ENV_FILE" <<EOF
# dicekey Coffee Stamps - Testnet Deployment
# Deployed: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Tx source / fee payer (G-address, kept for stellar CLI invocations): ${ADMIN_ADDRESS}
#
# The contract admin is the dicekey HQ Smart Account (a C-address),
# populated below by scripts/sa-setup-testnet.mjs once the HQ SA is created.
# Until then VITE_HQ_SMART_ACCOUNT is blank and downstream tools must abort.

VITE_NETWORK=testnet
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_FRIENDBOT_URL=https://friendbot.stellar.org

# Contracts (this deploy)
VITE_VISIT_STAMPS_CONTRACT=${CONTRACT_IDS[dicekey_visit_stamps]}
VITE_BEANS_TOKEN_CONTRACT=${CONTRACT_IDS[dicekey_beans_token]}
VITE_BENEFITS_CONTRACT=${CONTRACT_IDS[dicekey_benefits]}
VITE_BADGES_CONTRACT=${CONTRACT_IDS[dicekey_badges]}
VITE_REWARD_POLICY_CONTRACT=${CONTRACT_IDS[dicekey_reward_policy]}

# Deployer / fee payer (G-address). Kept for tooling that still references it.
VITE_DEPLOYER_ADDRESS=${ADMIN_ADDRESS}

# --- smart-account-kit (OpenZeppelin Stellar accounts) Testnet infra ---
# Source: smart-account-kit demo/.env.example (stable across kit 0.2.x/main).
VITE_ACCOUNT_WASM_HASH=8537b8166c0078440a5324c12f6db48d6340d157c306a54c5ea81405abcc2611
VITE_WEBAUTHN_VERIFIER_ADDRESS=CCMR63YE5T7MPWREF3PC5XNTTGXFSB4GYUGUIT5POHP2UGCS65TBIUUU
VITE_ED25519_VERIFIER_ADDRESS=CCJOUKLCZVCXS4VIBBEA7S3SPWZQS5DPE5A4YG67RA3Z7E3SJZAUJFQA
VITE_NATIVE_TOKEN_CONTRACT=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
VITE_THRESHOLD_POLICY_ADDRESS=CB2WQXF2XXDGUV2CTVQ23RLN3ESI3IY5KKX3KVXWBNRTTWDHZM76NVKJ
VITE_SPENDING_LIMIT_POLICY_ADDRESS=CBBZ2XP4LBDEO2EELTZKJSPQZDREFKCULL6CKIUQO53S42RZABOYQUK3
VITE_WEIGHTED_THRESHOLD_POLICY_ADDRESS=CCF65VXVORNOZBRR3EG3GZYSFS3ALDG44CDYN5T5KRWKYX6RXLKLXER4

# HQ Smart Account + staff rules + customer SA (populated by
# scripts/sa-setup-testnet.mjs). Keys are pre-created (blank) so the runner's
# in-place regex replace finds them; otherwise it falls back to append.
VITE_HQ_SMART_ACCOUNT=
VITE_HQ_ROOT_CREDENTIAL_ID=
VITE_HQ_STAFF_CONTEXT_RULE_ID=
VITE_HQ_STAFF_RULE_IDS=
VITE_HQ_STAFF_BENEFITS_RULE_ID=
VITE_DEMO_CUSTOMER_SA=

# WebAuthn relying party. CF Pages deploys override per host via
# apps/*/.env.production (see apps/*/.env.production.example).
VITE_RP_ID=localhost
VITE_RP_NAME=dicekey Coffee Stamps

# Kit relayer endpoint. When set, smart-account-kit POSTs invokeHostFunction
# submissions here instead of the rpc; localnet leaves it blank so the kit
# falls back to direct rpc. CF Pages env vars override at build time
# (https://dicekey-relayer.<account>.workers.dev/relayer when worker is wired).
# The kit fetches this URL verbatim — include the full /relayer suffix.
VITE_WORKER_URL=
EOF

# 🟡 Mirror the master Testnet env into tools/sa-harness/ so that `pnpm
#    --filter sa-harness dev --mode testnet` (called by `just testnet`) picks
#    up the freshly deployed contract ids without sa-setup-testnet.mjs having
#    to write to it mid-run (HMR mid-run tears down Playwright). deploy-* is
#    always the right write window because the harness isn't running yet.
cp "$ENV_FILE" tools/sa-harness/.env.testnet
echo "Mirrored ${ENV_FILE} -> tools/sa-harness/.env.testnet"

# 🔴 Harness production build (consumed by scripts/build-pages.sh → dist-pages/setup/)
#    needs the WebAuthn rpId set to the CF Pages host so the HQ root passkey
#    created at https://<host>/setup/ matches the rpId apps/staff-app uses for
#    enrollDevice on https://<host>/staff/. The Public Suffix List puts
#    *.pages.dev each on its own eTLD+1, so subdomain sharing is impossible —
#    setup and staff MUST live on the same origin. localhost / CDP smoke
#    stays on .env.testnet (rpId=localhost) above; only the production build
#    flips the rpId.
sed 's|^VITE_RP_ID=.*|VITE_RP_ID=dicekey-coffee-stamps.pages.dev|' "$ENV_FILE" \
  > tools/sa-harness/.env.production
echo "Mirrored ${ENV_FILE} -> tools/sa-harness/.env.production (rpId overridden to dicekey-coffee-stamps.pages.dev)"

# 🔴 Sync the 6 deploy-coupled keys (5 contract ids + deployer G-address) into
#    apps/{customer,staff}-app/.env.production. Without this, a fresh
#    deploy-testnet leaves apps pointing at the previous run's contracts —
#    staff-app's issue() trap "UnreachableCodeReached" because the new HQ is
#    not admin of the old visit-stamps. HQ 7-key block (`VITE_HQ_*`) stays
#    manual via the harness /setup/ Step-4 copy; rpId stays at the per-app
#    fixed pages.dev value. Contract ids are uppercase base32 (A-Z, 2-7) so
#    `|` is a safe sed delimiter.
sync_apps_contract_ids() {
  local target="$1"
  if [ ! -f "$target" ]; then
    echo "Skipping ${target} (does not exist — copy from .env.production.example first)"
    return 0
  fi
  for key in \
    VITE_VISIT_STAMPS_CONTRACT \
    VITE_BEANS_TOKEN_CONTRACT \
    VITE_BENEFITS_CONTRACT \
    VITE_BADGES_CONTRACT \
    VITE_REWARD_POLICY_CONTRACT \
    VITE_DEPLOYER_ADDRESS
  do
    value=$(grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
    [ -z "$value" ] && continue
    if grep -q "^${key}=" "$target"; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$target"
    else
      echo "${key}=${value}" >> "$target"
    fi
  done
  echo "Synced 6 deploy keys -> ${target} (HQ_* + RP_ID untouched)"
}
sync_apps_contract_ids apps/customer-app/.env.production
sync_apps_contract_ids apps/staff-app/.env.production

echo ""
echo "Contract IDs saved to ${ENV_FILE}"
echo ""
echo "Next: bash scripts/generate-bindings.sh   (will pick up the new ids)"
echo "      node scripts/sa-setup-testnet.mjs   (fills HQ SA / staff rules)"
echo ""
echo "Or all of the above in one shot:  just testnet"

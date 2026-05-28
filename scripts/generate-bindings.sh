#!/usr/bin/env bash
set -euo pipefail

# Generate TypeScript bindings from deployed Soroban contracts.
#
# Network/env are parameterized:
#   ENV_FILE  (default: .env.localnet, falls back to .env.testnet)
#   NETWORK   (default: localnet for .env.localnet, else testnet)
#
# Prerequisites: contracts deployed and the env file present with contract IDs.

ENV_FILE="${ENV_FILE:-.env.localnet}"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f .env.testnet ]; then
    ENV_FILE=".env.testnet"
  else
    echo "ERROR: $ENV_FILE not found. Deploy contracts first."
    exit 1
  fi
fi

# shellcheck source=scripts/_env.sh
source "$(dirname "$0")/_env.sh"
load_env "$ENV_FILE"

if [ "$ENV_FILE" = ".env.testnet" ]; then
  NETWORK="${NETWORK:-testnet}"
  # 🔴 See scripts/deploy-testnet.sh for the full story: the devcontainer
  #    shell pins STELLAR_RPC_URL/STELLAR_NETWORK_PASSPHRASE to localnet so
  #    `--network testnet` is silently overridden. Unset them here too, else
  #    bindings get embedded with localnet contract ids that the Testnet
  #    harness can never reach.
  unset STELLAR_RPC_URL STELLAR_NETWORK_PASSPHRASE STELLAR_FRIENDBOT_URL STELLAR_NETWORK
else
  NETWORK="${NETWORK:-localnet}"
fi

OUTPUT_DIR="packages/contracts/src"
mkdir -p "$OUTPUT_DIR"

echo "=== Generating TypeScript bindings (env=$ENV_FILE network=$NETWORK) ==="

declare -A CONTRACTS
CONTRACTS=(
  [visit-stamps]=$VITE_VISIT_STAMPS_CONTRACT
  [beans-token]=$VITE_BEANS_TOKEN_CONTRACT
  [benefits]=$VITE_BENEFITS_CONTRACT
  [badges]=$VITE_BADGES_CONTRACT
  [reward-policy]=$VITE_REWARD_POLICY_CONTRACT
)

for name in "${!CONTRACTS[@]}"; do
  contract_id="${CONTRACTS[$name]}"
  echo "Generating bindings for ${name} (${contract_id})..."
  stellar contract bindings typescript \
    --network "$NETWORK" \
    --contract-id "$contract_id" \
    --output-dir "${OUTPUT_DIR}/${name}" \
    --overwrite \
    2>&1
done

echo ""
echo "Bindings generated in ${OUTPUT_DIR}/"

# Compile each binding to its dist/ (its own tsconfig disables noUnusedLocals).
# The @dicekey/contracts aggregator imports the emitted .d.ts/.js so strict
# consumers (customer-app) don't choke on codegen's unused imports.
echo "Compiling bindings to dist/..."
pnpm --filter @dicekey/contracts build

echo "Done!"

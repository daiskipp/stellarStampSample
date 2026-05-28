# justfile — atomic recipes for the localnet One-Shot Pipeline.
# Composite recipes (e.g. `just localnet`) are added in task 003.
#
# Each recipe is a thin wrap over an existing script referenced in CLAUDE.md
# "Commands" so that `just <name>` and the bash command behave identically.

set shell := ["bash", "-cu"]

# 🔵 Show the recipe list when invoked with no arguments.
default:
    @just --list --unsorted

# 🔵 Build Soroban contracts to wasm32v1-none (only supported target).
build:
    stellar contract build

# 🔵 Run the 46 cargo contract tests (depends on build — contractimport!).
test-contracts: build
    cargo test

# Deploy / restore OZ smart-account infra (account.wasm upload +
#   webauthn_verifier) on localnet. Idempotent: probes on-chain existence
#   and skips when the contracts are already live. Required after every
#   fresh-volume reset.

# 🔵 OZ smart-account infra (idempotent).
[doc("Upload account.wasm + deploy webauthn_verifier on localnet (idempotent)")]
setup-oz-localnet:
    bash scripts/setup-oz-localnet.sh

# 🔵 Fresh-deploy the 5 dicekey contracts to localnet and sync .env files.
deploy-localnet:
    bash scripts/deploy-localnet.sh

# 🔴 Fresh-deploy the 5 dicekey contracts to Stellar Testnet and write
#    .env.testnet. IRREVERSIBLE: every invocation leaves 5 new contracts on
#    public Testnet. The 5-second sleep is a deliberate abort window for
#    direct invocations (`just deploy-testnet` or its parent `just testnet`).
[doc("Fresh-deploy 5 dicekey contracts to Stellar Testnet (IRREVERSIBLE)")]
deploy-testnet:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "=== TESTNET DEPLOY — IRREVERSIBLE. 5 contracts will be deployed to"
    echo "    Stellar Testnet (public). Ctrl-C within 5s to abort. ==="
    sleep 5
    bash scripts/deploy-testnet.sh

# 🔵 Regenerate TS bindings and build @dicekey/contracts.
bindings:
    bash scripts/generate-bindings.sh

# Generated bindings embed contract ids verbatim — switching networks REQUIRES
# regen, so localnet and Testnet have separate recipes instead of a hidden
# default that drifts. (just shows the single comment line directly above the
# recipe as the doc string, so keep the user-facing summary on that line.)

# 🔴 Regenerate TS bindings from .env.testnet (Testnet contract ids).
bindings-testnet:
    ENV_FILE=.env.testnet bash scripts/generate-bindings.sh

# Same Vite dev server backs both: sa-setup.mjs drives it via CDP for
# automation, and the host-browser UI (`just hq-setup` below) exposes it
# manually. Pick the alias that matches your intent for readability.
[doc("Start the in-browser kit harness on :5180 (foreground; CDP-automation alias)")]
sa-harness:
    pnpm --filter sa-harness dev

# 🔵 Run the one-shot SA setup (requires sa-harness on :5180).
sa-setup:
    node scripts/sa-setup.mjs

# 🔵 Open the in-browser HQ setup UI on :5180 (host browser, real Touch ID /
#   Windows Hello / DevTools Virtual Authenticator). Pair with
#   `just deploy-localnet` or scripts/deploy-testnet.sh beforehand — this UI
#   does not deploy contracts, it only sets up the HQ Smart Account, init/wire,
#   and staff context rules, then emits the .env values to paste into the apps.
#
#   Also spawns scripts/rpc-https-proxy.mjs on :8443 because the host browser's
#   kit (loaded via sa-harness/.env VITE_RPC_PROXY_URL) requires HTTPS to talk
#   to the http localnet RPC at stellar-localnet:8000. just localnet wires the
#   same proxy via sa-setup.mjs; here we wire it directly because the user
#   drives the UI manually instead of through Playwright.
[doc("Start the HQ setup UI for host-browser passkey-driven Smart Account setup")]
hq-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "[just hq-setup] starting rpc-https-proxy on :8443 (0.0.0.0)…"
    # 🟡 PROXY_HOST=0.0.0.0 makes the proxy reachable from the host browser
    #    through Orbstack/Docker port mapping. Default 127.0.0.1 only serves
    #    in-devcontainer callers like sa-setup.mjs.
    PROXY_HOST=0.0.0.0 node scripts/rpc-https-proxy.mjs &
    PROXY_PID=$!
    # 🟡 Kill the proxy on success, failure, or SIGINT so port 8443 never leaks.
    trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT
    # 🟡 Brief settle so the proxy is bind-accepting before the first kit call.
    sleep 1
    echo "[just hq-setup] starting sa-harness on :5180 (open http://localhost:5180/)…"
    echo "[just hq-setup] FIRST TIME ONLY: open https://localhost:8443/rpc in the host browser"
    echo "                and accept the self-signed certificate warning before clicking"
    echo "                Step 1 in the setup UI."
    pnpm --filter sa-harness dev

# NB: an earlier draft of this file shipped a `hq-setup-testnet` recipe that
#     ran sa-harness locally at http://localhost:5180/ for HQ bootstrap on
#     Testnet. It was removed because WebAuthn pins the rpId of every
#     credential to its creating origin (localhost), and `pages.dev` is on
#     the Public Suffix List, so a localhost-rpId HQ root passkey can NEVER
#     be presented to apps/staff-app at https://*.pages.dev/staff/. The HQ
#     bootstrap UI now ships as part of the CF Pages deploy at /setup/ — see
#     `just pages` + docs/dev/plans/hq-setup-testnet/runbook.md.

# Composite: the CLAUDE.md One-Shot Pipeline (localnet) in a single command.
#   `build → deploy-localnet → bindings` chains via just's recipe dependencies
#   (just resolves these serially in declaration order, matching the
#   "順序必須" requirement). The harness is bg-spawned, waited for via the
#   Vite "Local:" needle (mirrors e2e/global-setup.ts:49 waitForStdout, 40 s
#   timeout), then sa-setup runs, then trap-on-EXIT kills the harness with
#   SIGTERM so Vite's cleanup runs even if sa-setup fails or the recipe is
#   interrupted.

# 🔵 One-shot localnet pipeline.
[doc("One-shot localnet pipeline: build → oz-infra → deploy → bindings → harness → sa-setup")]
localnet: build setup-oz-localnet deploy-localnet bindings
    #!/usr/bin/env bash
    set -euo pipefail
    HARNESS_LOG=$(mktemp -t sa-harness.XXXXXX.log)
    echo "[just localnet] starting sa-harness (log: $HARNESS_LOG)…"
    pnpm --filter sa-harness dev >"$HARNESS_LOG" 2>&1 &
    HARNESS_PID=$!
    # 🟡 trap covers both success (sa-setup completed) and failure (set -e or
    #    SIGINT) paths so port 5180 never leaks.
    trap 'kill "$HARNESS_PID" 2>/dev/null || true; rm -f "$HARNESS_LOG"' EXIT
    # 🟡 Same 40 s budget as e2e/global-setup.ts; "Local:" is Vite's ready
    #    marker. grep first / sleep last so an immediate-ready harness skips
    #    the wait entirely.
    for _ in $(seq 1 40); do
        grep -q "Local:" "$HARNESS_LOG" && break
        sleep 1
    done
    # 🟡 Vite prints "Local:" slightly before the socket is bind-accepting.
    #    global-setup.ts waits 2.5 s; 2 s is enough for sa-setup's first fetch.
    sleep 2
    echo "[just localnet] running sa-setup…"
    node scripts/sa-setup.mjs
    echo "[just localnet] done."

# Cloudflare Pages: 1 host shared deploy.
# Both apps land on the same .pages.dev origin so they can share the
# VITE_RP_ID — a single WebAuthn passkey enrolled at
# dicekey-coffee-stamps.pages.dev works for customer and staff alike.
# Sub-paths can't share an RP_ID across two .pages.dev projects (pages.dev
# is in the Public Suffix List), so the only way to do 1-host is to merge
# both apps' dist into a single tree.

# 🔵 Build customer-app and staff-app into a merged dist-pages/ tree.
[doc("Build customer-app + staff-app(/staff/) into a merged dist-pages/")]
build-pages:
    bash scripts/build-pages.sh

# 🔵 Deploy dist-pages/ to Cloudflare Pages (project: dicekey-coffee-stamps).
# Prereqs: `just build-pages` ran; `pnpm exec wrangler login` succeeded once.
# --branch=main forces a production deploy so the canonical
# https://dicekey-coffee-stamps.pages.dev/ URL receives it (otherwise wrangler
# uses the current git branch and creates a preview-only URL).
[doc("Deploy dist-pages/ to Cloudflare Pages production (requires wrangler login)")]
deploy-pages:
    pnpm exec wrangler pages deploy dist-pages \
        --project-name=dicekey-coffee-stamps \
        --branch=main

# 🔵 Composite: build then deploy.
[doc("Build + deploy in one shot")]
pages: build-pages deploy-pages

# Composite: the Testnet counterpart of `just localnet`. Differences:
#   - No setup-oz-localnet (OZ Testnet infra is SDF-published; deploy-testnet.sh
#     already bakes the public verifier / policy addresses into .env.testnet).
#   - harness is started with --mode testnet so Vite layers .env.testnet over
#     .env. deploy-testnet.sh has already mirrored the master .env.testnet to
#     tools/sa-harness/.env.testnet so the harness sees fresh contract ids.
#   - sa-setup-testnet.mjs detects the running harness via HARNESS_URL probe
#     and skips its own startHarness/syncHarnessEnv path.
# NOT idempotent: every invocation does a fresh deploy of 5 contracts to public
# Testnet (cost = friendbot fund + ledger footprint). Re-run only when starting
# from a fresh state.

# 🔴 One-shot testnet pipeline.
[doc("One-shot testnet pipeline (IRREVERSIBLE deploy): build → deploy-testnet → bindings-testnet → harness(--mode testnet) → sa-setup-testnet")]
testnet: build deploy-testnet bindings-testnet
    #!/usr/bin/env bash
    set -euo pipefail
    # 🟡 Refuse to run if :5180 is already bound. A stale harness (e.g. left
    #    over from `just hq-setup` or `just localnet`) would silently survive
    #    `pnpm dev --mode testnet` (strictPort:true makes the new spawn die),
    #    and sa-setup-testnet's "harness already up — skipping spawn" probe
    #    would then drive the WRONG harness — localnet contracts at localnet
    #    addresses, but using fresh Testnet env. The result is initialize
    #    traps on already-initialized localnet contracts.
    if ss -ltn 'sport = :5180' 2>/dev/null | grep -q LISTEN; then
        echo "ERROR: port 5180 is already in use by another sa-harness." >&2
        echo "       Kill it first (e.g. pkill -f 'sa-harness') and retry." >&2
        exit 1
    fi
    HARNESS_LOG=$(mktemp -t sa-harness-testnet.XXXXXX.log)
    echo "[just testnet] starting sa-harness --mode testnet (log: $HARNESS_LOG)…"
    pnpm --filter sa-harness dev --mode testnet >"$HARNESS_LOG" 2>&1 &
    HARNESS_PID=$!
    trap 'kill "$HARNESS_PID" 2>/dev/null || true; rm -f "$HARNESS_LOG"' EXIT
    for _ in $(seq 1 40); do
        grep -q "Local:" "$HARNESS_LOG" && break
        sleep 1
    done
    sleep 2
    echo "[just testnet] running sa-setup-testnet…"
    node scripts/sa-setup-testnet.mjs
    echo "[just testnet] done."

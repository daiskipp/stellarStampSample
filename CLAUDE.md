# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# dicekey Coffee Stamps

Stellar/Soroban 上のコーヒー店スタンプカード・リワードアプリのサンプル実装。
Rust Soroban contracts + TypeScript (Vite/React) PWA frontend. Authentication is
passkey (WebAuthn) Smart Accounts (OpenZeppelin Stellar `accounts` via
`smart-account-kit`). Validated end-to-end on the **devcontainer localnet**.

- **設計書**: `docs/v0.1.md`; detailed specs in `docs/design/dicekey-coffee-stamps/`
  (incl. `smart-account-integration.md` — the authoritative integration design)
  and `docs/spec/dicekey-coffee-stamps/`.

## Tech Stack

| Layer | Technology |
|---|---|
| Contracts | Rust + soroban-sdk 22.0.5, Cargo workspace |
| Frontend | Vite 6 + React 19 + TypeScript 5.8, pnpm workspace |
| Stellar client | `@stellar/stellar-sdk` 15.x |
| Auth | Passkeys (WebAuthn) + OZ Smart Account via `smart-account-kit` 0.3.0 **built from source** (`.oz-build/smart-account-kit`, wired by `file:`) |
| Tool Mgmt | devcontainer (Dockerfile pins Node / just) + Nix flake (Rust / Node / just); pnpm via corepack |
| Test | `cargo test` (46) + Playwright E2E (`pnpm test:e2e`, real localnet + CDP virtual authenticator) |

## Architecture

### Soroban contracts (`contracts/`)
5 contracts. Contract addresses are stored at runtime (set by admin after
deploy), not hardcoded.

- `contracts/shared/` — library crate (`dicekey-shared`): `TokenMeta`,
  `DicekeyError`, and the **admin pattern** — single admin under
  `DataKey::Admin`, enforced via `shared::require_admin(env, caller)`
  (`caller.require_auth()` + admin compare). Every state-changing entrypoint
  takes `admin: Address`. The admin is the **HQ Smart Account C-address**, so
  `require_auth()` delegates to its `__check_auth` (passkey + context rules).
- `dicekey-visit-stamps` — 来店スタンプ (SEP-50 SBT). `issue()` increments
  counts, auto-mints 10 beans (if `BeansContract` set), then calls
  `reward-policy.on_stamp_issued(admin, to, new_count)` (if `PolicyContract`
  set). It **passes the new count** — the policy must NOT call back
  `stamp_count` (Soroban forbids contract re-entry).
- `dicekey-beans-token` — リワードトークン (SEP-41 FT): `mint`(admin),
  `transfer`, `approve`/`allowance`/`transfer_from`, `burn`/`burn_from`. dec 0.
- `dicekey-benefits` — 特典券 NFT (SEP-50, transferable/giftable, optional
  `expires_at`). No `burn_from` — only `owner` can burn.
- `dicekey-badges` — 称号バッジ SBT (one badge per `kind` per user).
- `dicekey-reward-policy` — `on_stamp_issued(admin, user, stamp_count)` (count
  passed in, no re-entry); `10visit_bonus`→benefit, `100visit_master`→badge;
  manual `check_morning_policy`/`check_spring_policy`. Claimed-guard prevents
  double reward.

Cross-contract flow on one stamp issuance (each arrow is a separate
`admin.require_auth` → 3 auth contexts on the HQ Smart Account):
```
visit-stamps.issue(admin=HQ-SA, to=customer-SA, venue)
  ├─ beans-token.mint(admin, to, 10)
  └─ reward-policy.on_stamp_issued(admin, to, new_count)
       ├─ benefits.mint(...)   [stamp_count ≥ 10, once]
       └─ badges.issue(...)    [stamp_count ≥ 100, once]
```

### Smart Account model (proven on localnet, U2)
- **Customer**: own Smart Account created by their passkey (`kit.createWallet`).
  Holds stamps/beans/benefits/badges at its C-address.
- **HQ Smart Account** = admin of all 5 dicekey contracts. Staff are passkey
  signers on it. Because `issue()` makes 3 `admin.require_auth` calls (issue,
  mint, on_stamp_issued), OZ `__check_auth` needs `AuthPayload.context_rule_ids`
  **index-aligned to the 3 auth_contexts** (else `SmartAccountError #3014
  ContextRuleIdsLengthMismatch`). So the staff passkey is registered on
  **3 CallContract context rules** (visit-stamps, beans-token, reward-policy)
  and issuing calls `signAndSubmitTx(tx, { credentialId: staffCred,
  resolveContextRuleIds: () => [r_vs, r_beans, r_policy] })`. A single rule is
  NOT sufficient. The staff sign-in connects as HQ with the **HQ root
  credential** (never `connectWallet` a staff credential — the kit overrides
  the contractId from the credential's storage); the staff passkey is used only
  as the `credentialId` in `signAndSubmit`. OZ context-rule name max = 20 bytes.

### Apps & packages
- `apps/customer-app/` (5173) — passkey → own SA, real on-chain reads (mock removed).
- `apps/staff-app/` (5174) — enroll device (HQ-root-authorized) + venue + staff
  passkey → issue via HQ SA (case-C). Use Beans/Receive Benefit are minimal
  + TODO (contract limits: beans needs customer `approve`; benefits has no
  `burn_from`).
- `packages/sdk/` (`@dicekey/sdk`) — `getConfig/setConfig/TESTNET_CONFIG`,
  `createKit/getKit/signAndSubmitTx` (kit wrapper; `SignSubmitOptions` incl.
  `resolveContextRuleIds`), read helpers (`getStampCount`/`getBeansBalance`,
  simulate, C-address-safe). Legacy `build*Tx` return `xdr.Operation` (off the
  write path; `signAndSubmit` needs `AssembledTransaction`).
- `packages/contracts/` (`@dicekey/contracts`) — `makeDicekeyClients(...)`.
  Imports each binding's **compiled `./<c>/dist/index.js`** (codegen's unused
  imports trip strict consumers' `noUnusedLocals`; per-binding tsconfig + `.d.ts`
  under `skipLibCheck` avoids it). Re-run `scripts/generate-bindings.sh`.
- `packages/ui-components/` — icons + `tokens.css`.
- `tools/sa-harness/` — in-browser kit harness; `scripts/sa-setup.mjs` drives it
  via Playwright + CDP virtual authenticator. **The working reference for kit usage.**

## Commands

```bash
# Clean clone / after devcontainer rebuild
bash scripts/build-kit.sh        # build smart-account-kit 0.3.0 from source (before pnpm install)
pnpm install
```

### just (推奨インターフェース)

```bash
just                              # recipe list
just build                        # stellar contract build (→ target/wasm32v1-none/release/*.wasm)
just test-contracts               # build + cargo test (46 tests)
just localnet                     # One-shot pipeline: build → deploy → bindings → harness → sa-setup (U2)
just testnet                      # IRREVERSIBLE Testnet counterpart: build → deploy-testnet → bindings → harness(--mode testnet) → sa-setup-testnet (1 stamp). Each run leaves 5 new contracts on public Testnet
just pages                        # build customer / staff / setup (sa-harness) → CF Pages production. HQ bootstrap on Testnet runs at https://<host>/setup/ (real passkey). See docs/dev/plans/hq-setup-testnet/runbook.md
just sa-harness                   # in-browser kit harness only (:5180)
just sa-setup                     # bootstrap HQ SA / customer / 1 stamp against an already-running harness
```

### just を経由しない場合 (参考)

<details>
<summary>同等の bash 直叩き手順</summary>

```bash
# Contracts — build to wasm32v1-none via `stellar contract build` (NOT cargo)
stellar contract build          # → target/wasm32v1-none/release/*.wasm
cargo test                      # 46 tests; needs the wasm above first (contractimport!)
cargo test -p dicekey-reward-policy                              # one crate
cargo test -p dicekey-visit-stamps auto_mint_beans_on_issue      # one test

# localnet end-to-end (ONE-SHOT — see gotchas). Each run, in order:
bash scripts/deploy-localnet.sh        # stellar contract build + deploy 5, sync .env*
bash scripts/generate-bindings.sh      # TS bindings + `pnpm --filter @dicekey/contracts build`
pnpm --filter sa-harness dev           # restart so Vite reloads .env (port 5180), foreground
node scripts/sa-setup.mjs              # HQ SA + 3 staff rules + init + wire + customer + issue (U2)

# Testnet end-to-end (ONE-SHOT, IRREVERSIBLE — see gotchas). Same shape, no
# OZ-infra step (SDF-published addresses are baked into deploy-testnet.sh):
bash scripts/deploy-testnet.sh         # stellar contract build + deploy 5 to Testnet, write .env.testnet + mirror to tools/sa-harness/.env.testnet
bash scripts/generate-bindings.sh      # TS bindings (same script; reads .env.testnet via VITE_NETWORK)
pnpm --filter sa-harness dev --mode testnet   # Vite reads .env.testnet (port 5180), foreground
node scripts/sa-setup-testnet.mjs      # HQ SA + 3 staff rules + init + wire + customer + issue (1 stamp smoke)
```

</details>

```bash
pnpm build                      # tsc -b && vite build, both apps (strict)
pnpm test:e2e                   # globalSetup runs the one-shot pipeline; 2 specs, real localnet (independent of `just localnet`)
```

## Gotchas

- **Build target is `wasm32v1-none`, via `stellar contract build`.** With the
  devcontainer's rustc, `cargo build --target wasm32-unknown-unknown` emits
  Soroban-incompatible wasm — every state-changing call traps
  `Error(WasmVm, InvalidAction) "UnreachableCodeReached"` (reads still work).
  `cargo test` still needs the wasm built first; `contractimport!` paths point
  to `target/wasm32v1-none/release/`.
- **`smart-account-kit` is the unpublished 0.3.0 built from source.** npm's
  `0.2.10` is ABI-incompatible with the current OZ account contract. It's at
  `.oz-build/smart-account-kit` (gitignored), wired via `file:` (pnpm-workspace
  override for its `smart-account-kit-bindings`). Don't `pnpm add
  smart-account-kit`. On a clean clone run **`bash scripts/build-kit.sh`
  BEFORE `pnpm install`** (idempotent; pins commit; needs network — its
  `build:bindings` fetches the OZ account spec from Testnet).
- **One-shot pipeline.** Both `sa-setup.mjs` (localnet) and
  `sa-setup-testnet.mjs` (Testnet) initialize the dicekey contracts with that
  run's HQ SA, so re-running against the same contracts traps
  (`already initialized` assert = UnreachableCodeReached). Always
  `deploy-*.sh` (fresh) → `generate-bindings.sh` → restart sa-harness → run,
  as one pass. `just localnet` / `just testnet` chain this automatically.
- **kit needs HTTPS RPC.** localnet RPC is http; `@stellar/stellar-sdk`/kit
  reject it. `scripts/rpc-https-proxy.mjs` (https://127.0.0.1:8443/rpc) shims
  it; app `.env`/harness point kit there.
- **kit fee payer** is a fixed key `GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N`
  (no relayer); friendbot-fund it on localnet before kit ops.
- **CDP headless Chromium** occasionally SIGSEGVs at launch — just retry.
- Devcontainer localnet hostname is `stellar-localnet:8000` from the dev
  container (NOT `localhost`); passphrase `Standalone Network ; February 2017`.
- No lint/format tooling configured; type-check is `tsc -b` (strict +
  `noUnusedLocals`/`noUnusedParameters` in both apps). `pnpm test` filters
  `packages/*` (no real scripts) — use `cargo test` / `pnpm test:e2e`.
- **devcontainer / nix-shell `STELLAR_*` env vars pin to localnet.**
  `STELLAR_RPC_URL=http://stellar-localnet:8000/rpc` +
  `STELLAR_NETWORK_PASSPHRASE="Standalone Network ; February 2017"` are
  exported so localnet flows JustWork(tm) without `--network` flags. They
  SILENTLY OVERRIDE `--network testnet` on the stellar CLI — calling
  `stellar contract deploy --wasm … --network testnet` then deploys to
  localnet, while the kit (reading `VITE_RPC_URL` from `.env.testnet`)
  talks to public Testnet. The cross-network split traps
  `Error(Storage, MissingValue): "non-existing value for contract instance"`
  on initialize. `scripts/deploy-testnet.sh` and
  `scripts/generate-bindings.sh` `unset` these env vars at the top of
  the Testnet path; if you add a new Testnet-targeting script,
  unset them or pass `--rpc-url` + `--network-passphrase` explicitly.
- **Testnet path (`just testnet`) mirrors localnet** but each run is
  IRREVERSIBLE (5 new contracts on public Testnet). `pnpm test:e2e` stays
  localnet-only — friendbot rate limits, TTL extend, and OZ Testnet public
  address drift would make Testnet E2E unreliable. The kit's published
  Testnet `VITE_ACCOUNT_WASM_HASH` / `VITE_WEBAUTHN_VERIFIER_ADDRESS` (baked
  into `scripts/deploy-testnet.sh`) can be invalidated by SDF Testnet resets
  or kit-side WASM updates — re-verify with a smoke `just testnet` after a
  long gap. Contract TTL also expires after ~24 days of inactivity;
  `stellar contract extend` before demos. CF Pages deployment uses
  `apps/*/.env.production` (template at `*.env.production.example`); the
  RP_ID there must match the deployed host.
- **HQ root passkey lives only on its creating authenticator AND its creating
  rpId.** Sign-in from a different device / browser is impossible (WebAuthn
  secret stays in the secure enclave), AND a passkey minted with rpId=A is
  invisible to a relying party using rpId=B. `pages.dev` is on the Public
  Suffix List so two `*.pages.dev` projects can't share an rpId, and a
  localhost-rpId passkey is unusable from any public origin. The HQ
  bootstrap UI is therefore co-deployed with the apps at
  `https://<host>/setup/` (sa-harness, built by `scripts/build-pages.sh`
  with `--base=/setup/`, reads `tools/sa-harness/.env.production` where
  `deploy-testnet.sh` pins `VITE_RP_ID=<host>`). One operator, one host,
  one Chrome — `setup/` mints the HQ root credential and `/staff/`
  consumes it on the same origin. The setup UI auto-disables once
  `VITE_HQ_SMART_ACCOUNT` is filled to keep the bootstrap a single-shot.

## Conventions

- Rust contracts in `contracts/`; TS packages in `packages/`, apps in `apps/`.
- 言語: code & comments in English; documentation may be Japanese. Commit
  messages in English. Conversational replies to the user: Japanese.

# dicekey Coffee Stamps

Stellar/Soroban 上のコーヒー店スタンプカード・リワードアプリのサンプル実装。

## Overview

dicekey Coffee（架空のコーヒーチェーン）が顧客に対して提供するスタンプカード・リワードシステム。来店するたびにスタンプが貯まり、自動でリワードが解放される。

## Architecture

```
┌─────────────────────────────────────────────────┐
│ dicekey Coffee Smart Account (admin)               │
└──────────────┬──────────────────────────────────┘
               │
    ┌──────────┼──────────┐──────────┐
    ▼          ▼          ▼          ▼
┌────────┐┌────────┐┌────────┐┌────────┐
│ Visit  ││ Beans  ││Benefits││ Badges │
│ Stamps ││ Token  ││  NFT   ││  SBT   │
│ (SBT)  ││ (FT)   ││        ││        │
└────┬───┘└────────┘└────────┘└────────┘
     │                  ▲          ▲
     ▼                  │          │
┌─────────────────────────────────────┐
│ Reward Policy Engine                │
│  - 10 visits → free drink voucher  │
│  - 100 visits → coffee master badge│
│  - 20 morning → morning master     │
│  - 5 spring → spring 2026 badge    │
└─────────────────────────────────────┘
```

### Contracts (Soroban/Rust)

| Contract | Standard | Description |
|---|---|---|
| `dicekey-visit-stamps` | SEP-50 SBT | 来店記録 (non-transferable) |
| `dicekey-beans-token` | SEP-41 FT | リワードポイント (transferable) |
| `dicekey-benefits` | SEP-50 NFT | 特典券 (giftable) |
| `dicekey-badges` | SEP-50 SBT | 称号バッジ (non-transferable) |
| `dicekey-reward-policy` | Custom | Policy 評価・自動報酬 |

### Cross-contract Flow

```
stamp issue → auto-mint 10 beans
            → policy evaluation
                → mint benefit NFT (at 10 visits)
                → issue badge SBT (at 100 visits)
```

### Apps (Vite + React + TypeScript)

| App | Port | Description |
|---|---|---|
| `customer-app` | 5173 | 顧客向け PWA (stamps, rewards, badges) |
| `staff-app` | 5174 | スタッフ向け PWA (stamp issue, benefit receive, beans redeem) |

## Tech Stack

| Layer | Technology |
|---|---|
| Contracts | Rust + soroban-sdk 22.x |
| Frontend | Vite 6 + React 19 + TypeScript |
| Auth | Passkeys (WebAuthn) + Smart Account |
| Testing | cargo test (46) + Playwright E2E (22) |
| Package Mgmt | Cargo workspace + pnpm workspace |
| Tool Mgmt | devcontainer (Dockerfile pins Node / just) + Nix flake (Rust / Node / just); pnpm via corepack |
| Task Runner | [`just`](https://just.systems) (see `justfile`) |

## Quick Start

### Prerequisites

- Rust with the **`wasm32v1-none`** target (`rustup target add wasm32v1-none`)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
- Node.js 20+ (pnpm via corepack)
- [`just`](https://just.systems) (provided by the devcontainer / Nix flake)
- The devcontainer (provides the local Stellar network, Chromium, toolchain)

### Setup

```bash
# REQUIRED before `pnpm install` on a clean clone: smart-account-kit is the
# unpublished 0.3.0 built from source (npm's 0.2.10 is ABI-incompatible) and
# wired via file: from .oz-build/ (gitignored). Idempotent; needs network.
bash scripts/build-kit.sh

pnpm install

# Build contracts (wasm32v1-none) + run the 46 cargo tests
just build           # alias for `stellar contract build`
just test-contracts  # `cargo test` (depends on build)

# Frontend dev servers
pnpm dev:customer    # http://localhost:5173
pnpm dev:staff       # http://localhost:5174

# Discover the other recipes
just                 # list all recipes (see also `justfile`)
```

### Smart Account のセットアップ

認証は passkey + OZ Smart Account。HQ Smart Account は **ホスト OS の
ブラウザで作成する**のがデフォルトです (Touch ID / Windows Hello /
DevTools Virtual Authenticator)。

```bash
# kit fee payer を friendbot で funding (一度だけ。localnet 再起動時のみ再実行)
curl "http://stellar-localnet:8000/friendbot?addr=GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N"

# 1. 5 つの dicekey contracts を localnet にデプロイ (Testnet は `just testnet` or scripts/deploy-testnet.sh)
just deploy-localnet

# 2. TS bindings 再生成
just bindings

# 3. HQ setup UI を起動
just hq-setup
```

ホスト OS の Chrome で `http://localhost:5180/` を開き、UI の 4 ステップを
実行します:

1. **Create HQ Wallet** — Touch ID で HQ root passkey を作成
2. **Initialize + Wire** — 5 contracts の admin を HQ に設定
3. **Setup Staff Rules** — staff 用の 4 つの context rule を作成
4. **Copy `.env`** — 出力されたブロックを `apps/staff-app/.env` /
   `apps/customer-app/.env` の該当行に貼り付け

`.env` を更新したら apps の dev server を起動 (or 再起動):

```bash
pnpm dev:customer    # http://localhost:5173
pnpm dev:staff       # http://localhost:5174
```

同じホストブラウザで staff-app の「この端末を登録」を実行すると、
作成済みの HQ root passkey が同じ authenticator にあるので、QR ダイアログ
を経由せずに enroll が完了します。

#### platform 認証機が無い環境 (Linux ホスト等)

Mac/Win の Touch ID/Windows Hello が使えない場合は、Chrome の
**DevTools Virtual Authenticator** で代替:

- DevTools → 三点メニュー → More tools → **WebAuthn**
- "Enable virtual authenticator environment" を ON
- "New authenticator" → Protocol: `ctap2`、Transport: `internal`、
  "Supports resident keys" / "Supports user verification" を **両方 ON**

以降は同じ setup UI ステップを実行できます。

### 自動化: CI / E2E

CDP virtual authenticator で end-to-end の動作確認を一発で回したい場合:

```bash
just localnet   # build → deploy → bindings → harness 起動 → sa-setup.mjs
                # → expect: U2 PASS, stamp_count=1, beans_balance=10

pnpm test:e2e   # Playwright globalSetup が同じパイプラインを走らせる。
                # customer-app + staff-app の specs が real passkey flow を
                # CDP virtual authenticator 経由で実行。Chromium のみ。
```

`just localnet` と `just hq-setup` は **どちらも `apps/*/.env` の HQ 系を
書き換える**ので、同時に使わず用途で切り替えてください。

### Testnet path

```bash
just testnet            # build → deploy-testnet → bindings → harness(--mode testnet)
                        # → sa-setup-testnet.mjs (1 stamp smoke on public Testnet)
just pages              # build customer / staff / setup(sa-harness) → CF Pages
                        # → 実機 passkey で HQ ブートストラップ → staff-app sign-in
```

**IRREVERSIBLE**: `just testnet` と `just pages` の前段 (`just deploy-testnet`)
は毎回 5 つの dicekey contracts を新規に Testnet にデプロイします
(`scripts/deploy-testnet.sh` 冒頭に 5 秒の abort window あり)。

使い分け:

- `just testnet` — CDP 仮想 authenticator で 1 stamp smoke までを自動実行。
  実機 passkey は使えないため CF Pages 上の staff-app からの sign-in は
  成立しない (HQ root credential が devcontainer 内の仮想 authenticator
  にしか存在しないため)。Testnet 上のコントラクト到達性 / TTL 確認用途。
- **HQ 実機ブートストラップ** — `https://<host>/setup/` に同梱された
  sa-harness UI から、ホスト OS の Chrome の実機 Touch ID / Windows Hello で
  HQ SA を作成。同じ origin (`<host>`) の `/staff/` から `enrollDevice` +
  sign-in が成立する (WebAuthn rpId 整合のため同一 origin 必須 —
  `pages.dev` は Public Suffix List 上なので subdomain では共有不可)。
  詳細手順は [`docs/dev/plans/hq-setup-testnet/runbook.md`](docs/dev/plans/hq-setup-testnet/runbook.md)。

sa-setup-testnet.mjs は `.env.testnet` に HQ Smart Account / staff rules /
demo customer SA / 1 stamp 発行までを書き戻します。apps の env は触らない
ので、apps を Testnet 向けに動かしたいときは `apps/*/.env.production`
(template: `apps/*/.env.production.example`) を作成し、`/setup/` UI の
Step 4 で出力される 7 行をコピーして反映します。`tools/sa-harness/.env.production`
は `deploy-testnet.sh` が自動生成します。`pnpm test:e2e` は localnet 専用の
ままです (friendbot rate / Testnet RPC fragility 回避)。

## Project Structure

```
dicekey-coffee-stamps/
├── contracts/
│   ├── shared/                  Common types & admin helpers
│   ├── dicekey-visit-stamps/       SEP-50 SBT (10 tests)
│   ├── dicekey-beans-token/        SEP-41 FT (10 tests)
│   ├── dicekey-benefits/           SEP-50 NFT (9 tests)
│   ├── dicekey-badges/             SEP-50 SBT (8 tests)
│   └── dicekey-reward-policy/      Policy engine (9 tests)
├── apps/
│   ├── customer-app/            Customer PWA
│   └── staff-app/               Staff PWA
├── packages/
│   ├── sdk/                     Soroban RPC client
│   ├── contracts/               Generated bindings
│   └── ui-components/           Shared components
├── scripts/
│   ├── deploy-localnet.sh       Fresh-deploy 5 contracts to localnet + sync .env
│   ├── deploy-testnet.sh        Fresh-deploy 5 contracts to public Testnet
│   ├── sa-setup.mjs             localnet: HQ SA + 3 staff rules + init+wire + customer + 1 stamp
│   ├── sa-setup-testnet.mjs     Testnet counterpart of sa-setup.mjs (same flow)
│   ├── generate-bindings.sh     Generate TS bindings + build @dicekey/contracts
│   ├── rpc-https-proxy.mjs      localnet only: HTTPS shim for kit's RPC requirement
│   └── build-kit.sh             Build smart-account-kit 0.3.0 from source (before pnpm install)
├── e2e/                         Playwright E2E tests
└── docs/
    └── v0.1.md                  Design document
```

## Demo Walkthrough

1. **Staff: Issue stamp** — Staff app → Issue Stamp → Generate QR
2. **Customer: Receive stamp** — Customer app shows new stamp + 10 beans
3. **Auto reward** — At 10 stamps, a free drink voucher appears automatically
4. **Gift benefit** — Customer → Rewards → Gift → Send to friend
5. **Redeem at store** — Staff app → Receive Benefit → Customer scans
6. **Use beans** — Staff app → Use Beans → Select drink → Customer confirms

## Design Document

See [docs/v0.1.md](docs/v0.1.md) for the full design specification.

## License

MIT

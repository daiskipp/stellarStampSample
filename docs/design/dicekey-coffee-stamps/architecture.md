# dicekey Coffee Stamps アーキテクチャ設計（逆生成）

## 分析概要

| 項目 | 値 |
|---|---|
| **分析日時** | 2026-05-19 |
| **アーキテクチャパターン** | Modular Monorepo + On-chain Domain Logic |
| **レイヤー数** | 4 (Contract / SDK / Shared UI / App) |

---

## システム概要

### アーキテクチャパターン

**On-chain Domain Logic + Off-chain Presentation** パターンを採用。ビジネスロジック（スタンプ発行、報酬評価、トークン管理）は全て Soroban スマートコントラクト上に実装され、フロントエンドは RPC 経由でコントラクトを呼び出す薄い Presentation 層として機能する。

```
┌─────────────────────────────────────────────────────┐
│                   Presentation Layer                │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ customer-app │  │  staff-app   │   React 19 PWA  │
│  │  (5 pages)   │  │  (5 pages)   │   Vite 6        │
│  └──────┬───────┘  └──────┬───────┘                 │
│         └────────┬────────┘                         │
│          ┌───────┴───────┐                          │
│          │  ui-components │  Design System           │
│          └───────┬───────┘                          │
│          ┌───────┴───────┐                          │
│          │      SDK      │  Transaction Builders     │
│          └───────┬───────┘                          │
├──────────────────┼──────────────────────────────────┤
│         Soroban RPC (JSON-RPC over HTTPS)           │
├──────────────────┼──────────────────────────────────┤
│                  │  Domain Layer (On-chain)          │
│  ┌───────────────┴───────────────────────┐          │
│  │         dicekey-visit-stamps             │          │
│  │    (Stamp Issuance + Auto-wiring)     │          │
│  └──┬────────────────┬───────────────────┘          │
│     │                │                              │
│  ┌──┴──────────┐  ┌──┴──────────────────┐           │
│  │  dicekey-  │  │ dicekey-reward-policy │           │
│  │ beans-token│  │  (Policy Engine)     │           │
│  │ (SEP-41 FT)│  └──┬──────────┬───────┘           │
│  └────────────┘     │          │                    │
│               ┌─────┴───┐  ┌──┴────────┐           │
│               │ dicekey- │  │ dicekey-  │           │
│               │benefits  │  │  badges   │            │
│               │(NFT/SEP │  │(SBT/SEP  │            │
│               │  -50)   │  │  -50)     │            │
│               └─────────┘  └──────────┘             │
│                                                     │
│  ┌─────────────────────────────────────┐            │
│  │          dicekey-shared                │            │
│  │  (TokenMeta, DicekeyError, Admin)      │            │
│  └─────────────────────────────────────┘            │
└─────────────────────────────────────────────────────┘
```

---

## 技術スタック

### On-chain (Domain Layer)

| 項目 | 技術 | バージョン |
|---|---|---|
| **言語** | Rust | Edition 2021 |
| **スマートコントラクト SDK** | soroban-sdk | 22.0.5 |
| **ブロックチェーン** | Stellar / Soroban | Testnet |
| **ビルドターゲット** | wasm32-unknown-unknown | — |
| **ワークスペース管理** | Cargo workspace | resolver 2 |

### Off-chain (Presentation Layer)

| 項目 | 技術 | バージョン |
|---|---|---|
| **UI フレームワーク** | React | 19 |
| **言語** | TypeScript | 5.8 |
| **ビルドツール** | Vite | 6.3 |
| **Stellar SDK** | @stellar/stellar-sdk | 15.1.0 |
| **パッケージ管理** | pnpm workspace | — |
| **ツール管理** | mise | — |
| **E2E テスト** | Playwright | 1.60+ |

### デザインシステム

| 項目 | 値 |
|---|---|
| **カラーテーマ** | Warm Paper (Coffee-inspired) |
| **Display フォント** | DM Serif Display + Noto Sans JP |
| **Body フォント** | Noto Sans JP + system-ui |
| **Mono フォント** | JetBrains Mono |
| **アイコン** | カスタム SVG (25+ exports) |

---

## モノレポ構成

```
StampSample/
├── Cargo.toml                    # Rust workspace root
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml           # workspace packages 定義
├── mise.toml                     # ツールバージョン管理
├── playwright.config.ts          # E2E テスト設定
│
├── contracts/                    # === On-chain Domain ===
│   ├── shared/                   # 共通ライブラリ (TokenMeta, DicekeyError, Admin)
│   │   └── src/lib.rs            # 59 lines
│   ├── dicekey-visit-stamps/        # 来店スタンプ (SEP-50 SBT)
│   │   └── src/lib.rs            # 431 lines
│   ├── dicekey-beans-token/         # Beans トークン (SEP-41 FT)
│   │   └── src/lib.rs            # 363 lines
│   ├── dicekey-benefits/            # 特典券 NFT (SEP-50, transferable)
│   │   └── src/lib.rs            # 423 lines
│   ├── dicekey-badges/              # 称号バッジ SBT (SEP-50, non-transferable)
│   │   └── src/lib.rs            # 291 lines
│   └── dicekey-reward-policy/       # ポリシーエンジン (4 policies)
│       └── src/lib.rs            # 450 lines
│
├── packages/                     # === Shared Packages ===
│   ├── sdk/                      # Stellar SDK ラッパー
│   │   └── src/
│   │       ├── config.ts         # NetworkConfig, contract addresses
│   │       ├── client.ts         # SorobanRpc.Server singleton
│   │       ├── visit-stamps.ts   # Stamp tx builders + queries
│   │       ├── beans-token.ts    # Beans tx builders + queries
│   │       └── index.ts          # Re-exports
│   ├── ui-components/            # デザインシステム
│   │   └── src/
│   │       ├── Icons.tsx          # 25+ SVG icon components
│   │       ├── tokens.css         # CSS custom properties
│   │       └── index.ts           # Re-exports
│   └── contracts/                # 自動生成 TypeScript バインディング
│
├── apps/                         # === Presentation Layer ===
│   ├── customer-app/             # 顧客 PWA (port 5173)
│   │   └── src/
│   │       ├── App.tsx            # Router + TabBar + ErrorBoundary
│   │       ├── contexts/
│   │       │   └── AuthContext.tsx # Passkey auth state
│   │       ├── lib/
│   │       │   └── passkey.ts     # WebAuthn helpers
│   │       └── pages/
│   │           ├── LoginPage.tsx
│   │           ├── HomePage.tsx
│   │           ├── StampsPage.tsx
│   │           ├── RewardsPage.tsx
│   │           └── SettingsPage.tsx
│   └── staff-app/                # スタッフ PWA (port 5174)
│       └── src/
│           ├── App.tsx            # Router + TopNav + ErrorBoundary
│           ├── contexts/
│           │   └── StaffAuthContext.tsx
│           └── pages/
│               ├── StaffLoginPage.tsx
│               ├── DashboardPage.tsx
│               ├── IssueStampPage.tsx
│               ├── ReceiveBenefitPage.tsx
│               └── UseBeansPage.tsx
│
├── e2e/                          # === E2E Tests ===
│   ├── customer-app.spec.ts      # 16 tests
│   └── staff-app.spec.ts         # 9 tests
│
├── scripts/                      # === Deploy & Operations ===
│   ├── deploy-localnet.sh        # 5-contract deployment to devcontainer localnet
│   ├── deploy-testnet.sh         # 5-contract deployment to public Stellar Testnet
│   ├── sa-setup.mjs              # localnet: HQ SA + init + wire + customer + 1 stamp
│   ├── sa-setup-testnet.mjs      # Testnet counterpart of sa-setup.mjs
│   ├── generate-bindings.sh      # TypeScript binding generation
│   └── build-kit.sh              # smart-account-kit 0.3.0 source build
│
└── docs/                         # === Documentation ===
    └── v0.1.md                   # 設計仕様書
```

---

## レイヤー責務分析

### Layer 1: Shared Library (`contracts/shared`)

**責務:** 全コントラクト共通のデータ型・エラー型・管理者認証ユーティリティの提供。

| コンポーネント | 責務 |
|---|---|
| `TokenMeta` | NFT/SBT のメタデータ構造体 (name, description, image_uri, extra_uri) |
| `VenueId` | 店舗識別子の型エイリアス (String) |
| `DicekeyError` | 統一エラーコード (NotAuthorized=1 〜 PolicyNotMet=6) |
| `get_admin` / `set_admin` / `require_admin` | Admin アドレス管理と認証強制 |

### Layer 2: Domain Contracts (`contracts/*`)

**責務:** ビジネスロジックの完全なオンチェーン実装。

| コントラクト | 責務 | 標準 | 行数 |
|---|---|---|---|
| `dicekey-visit-stamps` | スタンプ発行・管理 + 自動 Beans ミント + ポリシー評価トリガー | SEP-50 (SBT) | 431 |
| `dicekey-beans-token` | リワードトークン管理 (送金・承認・バーン) | SEP-41 (FT) | 363 |
| `dicekey-benefits` | 特典券ライフサイクル (発行・譲渡・利用・有効期限) | SEP-50 (NFT) | 423 |
| `dicekey-badges` | 称号バッジ発行 (重複防止・Soulbound) | SEP-50 (SBT) | 291 |
| `dicekey-reward-policy` | ポリシー評価エンジン (閾値判定・クレーム追跡・報酬発行) | Custom | 450 |

### Layer 3: SDK + UI Components (`packages/*`)

**責務:** オフチェーンアプリ向けの抽象化層。

| パッケージ | 責務 |
|---|---|
| `sdk` | Soroban RPC 接続管理、トランザクションビルダー、コントラクトクエリ |
| `ui-components` | デザイントークン (CSS variables)、共有 SVG アイコンコンポーネント |
| `contracts` | 自動生成された TypeScript バインディング |

### Layer 4: Applications (`apps/*`)

**責務:** ユーザー向け Presentation 層。

| アプリ | ビューポート | ページ数 | 認証方式 |
|---|---|---|---|
| `customer-app` | Mobile (390x844) | 5 (Login, Home, Stamps, Rewards, Settings) | Passkey (WebAuthn) |
| `staff-app` | Tablet (1100x800) | 5 (Login, Dashboard, IssueStamp, UseBeans, ReceiveBenefit) | Venue 選択 + Passkey |

---

## デザインパターン

### コントラクト層

| パターン | 使用箇所 | 説明 |
|---|---|---|
| **Observer / Event-Driven** | visit-stamps → policy | スタンプ発行イベントがポリシー評価をトリガー |
| **Strategy** | reward-policy | 4 つのポリシーを個別に評価・発動 |
| **Guard (Initialization)** | 全コントラクト | `Initialized` フラグによる二重初期化防止 |
| **Claim Tracking** | reward-policy | `Claimed(Address, String)` で二重報酬防止 |
| **Reentrancy Guard** | reward-policy | クロスコントラクト呼び出し前にステート更新 |
| **Soulbound Enforcement** | stamps, badges | `transfer()` を panic で拒否 |
| **Singleton Admin** | shared | 単一 admin アドレスによるアクセス制御 |

### フロントエンド層

| パターン | 使用箇所 | 説明 |
|---|---|---|
| **Context Provider** | AuthContext, StaffAuthContext | React Context API による認証状態管理 |
| **State Machine** | IssueStampPage (idle→showing→done) | QR 生成フローの状態遷移管理 |
| **Singleton** | sdk/client.ts | Soroban RPC Server のシングルトンインスタンス |
| **Facade** | sdk/*.ts | コントラクト操作のトランザクションビルダーによる簡素化 |
| **Barrel Export** | */index.ts | パッケージ公開 API の集約 |

---

## セキュリティ設計

### 認証・認可

| 層 | 方式 | 詳細 |
|---|---|---|
| **On-chain** | Stellar `require_auth()` | 全ユーザー操作で Stellar トランザクション署名を要求 |
| **On-chain (Admin)** | `require_admin()` | admin アドレス一致 + `require_auth()` の二重チェック |
| **Off-chain** | WebAuthn Passkey | Platform authenticator, ES256 (P-256), User verification required |
| **Off-chain (Staff)** | Venue-based session | LocalStorage 永続化, 店舗スコープ |

### 資産保護

| 保護対象 | 方式 |
|---|---|
| Soulbound トークン | `transfer()` panic (stamps, badges) |
| 二重報酬 | `Claimed(Address, String)` storage + check-before-mint |
| リエントランシー | State update before cross-contract call |
| 有効期限 | `expires_at` チェック (benefits) |
| 残高不足 | `assert!(balance >= amount)` |
| 二重初期化 | `Initialized` guard flag |

### エラーコード体系

```rust
pub enum DicekeyError {
    NotAuthorized = 1,  // 権限不足
    AlreadyClaimed = 2, // 二重クレーム
    Expired = 3,        // 有効期限切れ
    NotFound = 4,       // リソース未発見
    InvalidInput = 5,   // 入力値不正
    PolicyNotMet = 6,   // ポリシー条件未充足
}
```

---

## ビルド最適化

### Rust / WASM ビルド

```toml
[profile.release]
opt-level = "z"          # バイナリサイズ最小化
overflow-checks = true   # オーバーフロー検出
debug = 0                # デバッグ情報なし
strip = "symbols"        # シンボルテーブル除去
debug-assertions = false # デバッグアサーション無効
panic = "abort"          # panic 時即座に abort
codegen-units = 1        # 単一コード生成ユニット (最適化最大化)
lto = true               # Link-Time Optimization
```

### Vite ビルド

- `@vitejs/plugin-react` による React Fast Refresh
- 環境変数は `VITE_*` プレフィクスで注入
- customer-app: port 5173, staff-app: port 5174

---

## テスト戦略

### テストピラミッド

```
         ┌──────────┐
         │  E2E (25)│  Playwright
         │ customer │  (UI integration)
         │ + staff  │
         ├──────────┤
         │  Unit +  │  cargo test
         │Integration│  (contract logic)
         │  (46)    │
         └──────────┘
```

| レベル | ツール | 件数 | カバー範囲 |
|---|---|---|---|
| **Unit / Integration** | cargo test + soroban_sdk::testutils | 46 | コントラクトロジック全般 (正常系/異常系/イベント/クロスコントラクト) |
| **E2E** | Playwright | 25 | ユーザーフロー (認証/画面遷移/ビジネス操作/セッション) |

### テスト手法

- **Mock Auth**: `env.mock_all_auths()` でコントラクトテスト時の認証をスキップ
- **WASM Import**: ポリシーテストでは全コントラクト WASM をインポートして統合テスト
- **Demo Mode**: E2E テストはデモモードで実行 (Testnet 依存なし)
- **外部サーバー**: Playwright は起動済み dev server に接続 (`webServer` 設定なし)

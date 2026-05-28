# dicekey Coffee Stamps — Smart Account 統合設計

**ステータス**: 実装着手前ドラフト（調査完了 / 設計確定待ち）
**作成日**: 2026-05-19
**位置づけ**: `kalepail/smart-account-kit` + OpenZeppelin `stellar-contracts` (accounts) を dicekey Coffee Stamps に統合し「Testnet 上で動くデモ」を完成させるための実装可能設計
**対象**: customer-app / staff-app の両方、Stellar Testnet

> 本ドキュメントは調査と設計のみ。コード変更は後続タスク (2〜7) で実施する。
> 推測は「未確定事項」として明示し、確認できた事項には出典 URL を付与している。

---

## 1. 概要とゴール

### 1.1 ゴール

- customer-app / staff-app の認証を「localStorage 平文鍵 + デモログイン」から、**WebAuthn passkey で守られた Soroban Smart Account（C アドレス）** に完全置き換える。
- 5 つの dicekey コントラクト (`visit-stamps` / `beans-token` / `benefits` / `badges` / `reward-policy`) の `admin` を、**dicekey 本部 Smart Account コントラクト**に向け、`require_admin` 内の `caller.require_auth()` を Soroban のカスタムアカウント認可（`__check_auth` → passkey 検証 + context rule/policy）へ委譲する。
- スタッフ認証は `docs/v0.1.md` の通り、**本部 Smart Account + 店舗ごとのスタッフ passkey Signer + context rule/policy** によるマルチ署名モデルにする。
- 顧客は**顧客個別の Smart Account** を持ち、スタンプ / beans / 特典 / バッジを自分の Smart Account アドレスで保有する。
- 既存モック / デモ経路を削除し、E2E を実ネットワーク + 仮想 WebAuthn 前提に作り替える。

### 1.2 確定済みスコープ（変更不可）

| 項目 | 内容 |
|---|---|
| 対象アプリ | customer-app と staff-app の両方 |
| スタッフ認証 | 本部 Smart Account + 店舗ごとスタッフ passkey Signer（context rule/policy で発行操作に限定） |
| 既存モック/デモ | 完全置き換え（`loginDemo()` / venue 選択のみ / `Keypair.random()` を削除） |
| E2E | 実ネットワーク + 仮想 WebAuthn 前提に作り替え |
| ネットワーク | Stellar Testnet |

### 1.3 設計の核心となる事実（調査で確定）

1. **コントラクト側のコード変更は不要**。dicekey の `require_admin` は `admin: Address` を受け、`caller.require_auth()` を呼ぶだけ。Soroban では `Address` がコントラクトアドレス (C...) でも、`require_auth()` はそのコントラクトの `__check_auth` を呼ぶ。したがって `admin` を Smart Account の C アドレスに設定するだけで、passkey + context rule/policy 認可へ自動的に委譲される。整合点は **初期化スクリプトで `--admin` を Smart Account C アドレスにすること**のみ。
   - 出典: `contracts/shared/src/lib.rs`（`require_admin` 実装）/ Soroban カスタムアカウント仕様 https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets
2. **本部 Smart Account / WebAuthn verifier / policy contract は Testnet に公開済みのものを利用できる**。smart-account-kit の `demo/.env.example` に Testnet の WASM hash と verifier/policy のデプロイ済みアドレスが同梱されている（後述）。自前 upload/deploy は不要（任意でフォールバック手順を用意）。
   - 出典: https://github.com/kalepail/smart-account-kit/blob/main/demo/.env.example
3. **indexer / relayer はどちらも任意**。Testnet デモは indexer/relayer なしで成立する。ただし `kit.rules.list()` 等の「アクティブ rule 列挙」は indexer 必須。本設計では rule ID を自前で固定運用し、indexer を回避する。
   - 出典: https://github.com/kalepail/smart-account-kit/blob/main/README.md

---

## 2. アーキテクチャ

### 2.1 全体図

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (customer-app / staff-app, Vite+React)                          │
│                                                                          │
│  ┌────────────────────────────┐   ┌──────────────────────────────────┐  │
│  │ smart-account-kit (npm)    │   │ @dicekey/sdk (既存, 改修)        │  │
│  │  - SmartAccountKit         │   │  - build*Tx → xdr.Operation      │  │
│  │  - kit.createWallet()      │   │  - get* → simulate (read)        │  │
│  │  - kit.connectWallet()     │   │                                  │  │
│  │  - kit.executeAndSubmit()  │◄──┤ Operation を kit に渡して        │  │
│  │  - kit.signAndSubmit()     │   │  署名・提出                      │  │
│  │  - kit.signers / .rules    │   └──────────────────────────────────┘  │
│  │  - IndexedDBStorage        │                                          │
│  └──────────┬─────────────────┘                                          │
└─────────────┼────────────────────────────────────────────────────────────┘
              │ WebAuthn (navigator.credentials, @simplewebauthn/browser)
              │ Soroban RPC (https://soroban-testnet.stellar.org)
              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Stellar Testnet                                                         │
│                                                                          │
│  ┌────────────────────────────────┐   ┌──────────────────────────────┐  │
│  │ 本部 Smart Account (C...)      │   │ 顧客 Smart Account (C...)    │  │
│  │  OZ stellar-accounts WASM      │   │  OZ stellar-accounts WASM    │  │
│  │  ContextRule#0 Default:        │   │  ContextRule#0 Default:      │  │
│  │    Signer: 本部管理者 passkey  │   │    Signer: 顧客 passkey      │  │
│  │  ContextRule#1 CallContract    │   └──────────────────────────────┘  │
│  │   (=visit-stamps):             │            ▲ owner                   │
│  │    Signers: 渋谷/新宿/京都     │            │ (スタンプ/beans/特典     │
│  │             スタッフ passkey   │            │  /バッジの保有者)        │
│  │    Policy: (任意)              │            │                          │
│  └──────────┬─────────────────────┘            │                          │
│             │ admin / caller.require_auth()     │                          │
│             │ → __check_auth (passkey 検証)     │                          │
│   ┌─────────┼────────────┬───────────┬──────────┴────┐                    │
│   ▼         ▼            ▼           ▼               ▼                    │
│ ┌────────┐┌────────┐┌────────┐┌────────┐┌──────────────┐                 │
│ │visit-  ││beans-  ││benefits││badges  ││reward-policy │                 │
│ │stamps  ││token   ││        ││        ││              │                 │
│ │(admin= ││(admin= ││(admin= ││(admin= ││(admin=本部SA)│                 │
│ │ 本部SA)││ 本部SA)││ 本部SA)││ 本部SA)││              │                 │
│ └────────┘└────────┘└────────┘└────────┘└──────────────┘                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 共有インフラ (Testnet, smart-account-kit が公開アドレスを提供)    │  │
│  │  - smart-account WASM (hash)                                      │  │
│  │  - WebAuthn verifier (CCMR63YE...)                                │  │
│  │  - Ed25519 verifier  (CCJOUKLC...)                                │  │
│  │  - Threshold / SpendingLimit / WeightedThreshold policy           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 認可フローの委譲

```
staff-app: スタッフが渋谷店タブレットで「スタンプ発行」
  → @dicekey/sdk.buildIssueStampTx(admin=本部SA, to=顧客SA, venue="shibuya")
     が visit-stamps.issue を呼ぶ xdr.Operation を生成
  → kit.executeAndSubmit(visitStampsId, "issue", [本部SA, 顧客SA, venue])
     （本部 Smart Account を経由して target を呼ぶ）
  → visit-stamps.issue 内: shared::require_admin → admin==stored admin(本部SA) を確認
                          → 本部SA.require_auth()
  → Soroban が 本部 Smart Account の __check_auth を呼ぶ
  → ContextRule#1 (CallContract=visit-stamps) にマッチ
  → スタッフ passkey 署名を WebAuthn verifier で検証 + policy 評価
  → OK なら issue 実行 → beans auto-mint → reward-policy 評価
```

> 重要: `visit-stamps.issue` は内部で `beans-token.mint(admin, ...)` と `reward-policy.on_stamp_issued(admin, ...)` をクロスコントラクト呼び出しする（`contracts/dicekey-visit-stamps/src/lib.rs`）。`mint` / `on_stamp_issued` も `admin`(=本部SA) を渡し `require_admin` を通る。**この入れ子の `require_auth()` が 1 回の `__check_auth` 認可エントリで成立するかは要検証**（5.3 / 9 章 リスク参照）。

---

## 3. smart-account-kit の確定 API と採用オプション

すべて一次情報（GitHub raw / README / package.json / .env.example）で確認済み。

### 3.1 パッケージ

| 項目 | 値 | 出典 |
|---|---|---|
| npm パッケージ名 | `smart-account-kit` | https://github.com/kalepail/smart-account-kit/blob/main/package.json |
| 現行バージョン | `0.3.0` | 同上 |
| 主要 dependency | `@simplewebauthn/browser ^13.3.0`, `@stellar/stellar-sdk >=15.0.1`, `base64url ^3.0.1`, `smart-account-kit-bindings (workspace:*)` | 同上 |
| peerDependencies | `@stellar/stellar-sdk >=15.0.1`（必須）, `@creit-tech/stellar-wallets-kit >=2.1.0`（任意） | 同上 |

> **重要な含意**: `smart-account-kit-bindings` は `workspace:*` 依存。npm 公開版 `smart-account-kit@0.3.0` がこの bindings を bundled / 同梱公開しているかは **未確定事項**（9 章）。同梱されていない場合、kit リポジトリを clone して `pnpm run build:all`（ネットワークから bindings 生成）→ ローカル参照、という導入経路になる可能性がある。dicekey 側の `@stellar/stellar-sdk` は `^15.1.0` で peer 範囲 `>=15.0.1` を満たす。

### 3.2 SmartAccountConfig（コンストラクタオプション）

出典: https://github.com/kalepail/smart-account-kit/blob/main/README.md

| フィールド | 必須/任意 | 採用値（dicekey, Testnet） |
|---|---|---|
| `rpcUrl` | 必須 | `https://soroban-testnet.stellar.org` |
| `networkPassphrase` | 必須 | `Test SDF Network ; September 2015` |
| `accountWasmHash` | 必須 | Testnet 公開 WASM hash（4 章） |
| `webauthnVerifierAddress` | 必須 | `CCMR63YE5T7MPWREF3PC5XNTTGXFSB4GYUGUIT5POHP2UGCS65TBIUUU`（4 章） |
| `storage` | 任意 | `IndexedDBStorage`（Web 推奨。E2E は要検討） |
| `rpId` | 任意 | デモドメイン（`localhost` / 展示ホスト名） |
| `rpName` | 任意 | `dicekey Coffee Stamps` |
| `relayerUrl` | 任意 | **未設定**（ノンカストディアル方針、relayer 不使用） |
| `timeoutInSeconds` | 任意 | デフォルト 30 で可 |

```typescript
import { SmartAccountKit, IndexedDBStorage } from 'smart-account-kit';

const kit = new SmartAccountKit({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  accountWasmHash: import.meta.env.VITE_ACCOUNT_WASM_HASH,
  webauthnVerifierAddress: import.meta.env.VITE_WEBAUTHN_VERIFIER_ADDRESS,
  rpId: import.meta.env.VITE_RP_ID,
  rpName: 'dicekey Coffee Stamps',
  storage: new IndexedDBStorage(),
});
```

### 3.3 採用する主要メソッド（README 確認済みシグネチャ）

出典: https://github.com/kalepail/smart-account-kit/blob/main/README.md および src/index.ts エクスポート一覧

| メソッド | シグネチャ | 用途（dicekey） |
|---|---|---|
| `createWallet` | `createWallet(appName, userName, options?) → { contractId, credentialId }` | 顧客 / 本部 / 各スタッフの Smart Account 新規作成（passkey 登録 + デプロイ）。`options: { autoSubmit, autoFund, nativeTokenContract }` |
| `connectWallet` | `connectWallet(options?) → ConnectWalletResult | null` | 起動時のサイレント復帰 / passkey 選択ログイン。`options: { prompt, fresh, credentialId, contractId }` |
| `executeAndSubmit` | `executeAndSubmit(target, targetFn, targetArgs, options?) → TransactionResult` | **dicekey コントラクト呼び出しの主経路**（Smart Account 経由で任意関数を呼ぶ） |
| `signAndSubmit` | `signAndSubmit(transaction, options?) → TransactionResult` | 既存 `@dicekey/sdk` が返す xdr ベース Tx を署名・提出する代替経路 |
| `fundWallet` | （Testnet のみ）friendbot 資金供給 | 新規 Smart Account の初期 XLM |
| `kit.signers.addPasskey` | `addPasskey(contextRuleId, appName, userName, options?) → { credentialId, transaction }` | 本部 SA に店舗スタッフ passkey Signer を追加 |
| `kit.signers.addDelegated` | `addDelegated(contextRuleId, address)` | （任意）G-account 委譲 Signer |
| `kit.rules.add` | `add(contextType, name, signers, policies)` | 本部 SA に「visit-stamps 限定」context rule を追加 |
| `kit.rules.get` / `getAll` | `get(contextRuleId)` / `getAll(contextRuleType)` | rule 参照（**`list()` は indexer 必須なので使わない**） |
| `kit.policies.add` | `add(contextRuleId, policyAddress, installParams)` | （任意）スタッフ rule に threshold/spending policy を付与 |

context rule の scope 指定に使うビルダー（src エクスポート確認済み）:
`createDefaultContext()`, `createCallContractContext(address)`, `createCreateContractContext()`, `createWebAuthnSigner(...)`, `createDelegatedSigner(...)`, `createThresholdParams(n)`, `createSpendingLimitParams(token, amount, ledgers)`。

### 3.4 StorageAdapter

出典: src/index.ts エクスポート（`MemoryStorage`, `LocalStorageAdapter`, `IndexedDBStorage`）。インターフェース: `save()`, `get()`, `saveSession()`, `getSession()`。

- 本番/通常: `IndexedDBStorage`
- E2E: passkey の credential 保存と WebAuthn 仮想認証器の整合性確保のため `IndexedDBStorage` のまま CDP 仮想認証器を使う方針（5 章）。`MemoryStorage` はリロードで消えるため不可。

### 3.5 サブマネージャの役割（README / index.ts 確認）

| マネージャ | アクセサ | 役割 | dicekey での要否 |
|---|---|---|---|
| SignerManager | `kit.signers` | context rule への signer 追加/削除 | **必須**（スタッフ Signer 管理） |
| ContextRuleManager | `kit.rules` | context rule の CRUD | **必須**（visit-stamps 限定 rule） |
| PolicyManager | `kit.policies` | rule への policy 付与/削除 | 任意（threshold/spending を付ける場合のみ） |
| MultiSignerManager | `kit.multiSigners` | M-of-N 署名フロー | 任意（本デモは 1-of-N で十分） |
| ExternalSignerManager | `kit.externalSigners` | G-account / 外部ウォレット署名 | 不要 |
| IndexerClient | `kit.indexer` | credential→contract 逆引き、rule 列挙 | **不使用**（rule ID を固定運用） |
| RelayerClient | `kit.relayer` | fee 肩代わり（gasless） | **不使用**（ノンカストディアル方針） |

---

## 4. 必要 Testnet インフラ（確定リスト）

### 4.1 smart-account-kit が提供する Testnet 公開アドレス（そのまま利用）

出典: https://github.com/kalepail/smart-account-kit/blob/main/demo/.env.example

| 役割 | 種別 | 値 |
|---|---|---|
| RPC | URL | `https://soroban-testnet.stellar.org` |
| Network | passphrase | `Test SDF Network ; September 2015` |
| Smart Account | WASM hash | `8537b8166c0078440a5324c12f6db48d6340d157c306a54c5ea81405abcc2611` |
| WebAuthn Verifier | WASM hash | `f83d679f0ead1836b255a0f4160b9766065436a3b1afb9b15d73b646d68c0725` |
| WebAuthn Verifier | C アドレス | `CCMR63YE5T7MPWREF3PC5XNTTGXFSB4GYUGUIT5POHP2UGCS65TBIUUU` |
| Ed25519 Verifier | C アドレス | `CCJOUKLCZVCXS4VIBBEA7S3SPWZQS5DPE5A4YG67RA3Z7E3SJZAUJFQA` |
| Native XLM Token | C アドレス | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Threshold Policy | C アドレス | `CB2WQXF2XXDGUV2CTVQ23RLN3ESI3IY5KKX3KVXWBNRTTWDHZM76NVKJ` |
| Spending Limit Policy | C アドレス | `CBBZ2XP4LBDEO2EELTZKJSPQZDREFKCULL6CKIUQO53S42RZABOYQUK3` |
| Weighted Threshold Policy | C アドレス | `CCF65VXVORNOZBRR3EG3GZYSFS3ALDG44CDYN5T5KRWKYX6RXLKLXER4` |

> Smart Account は WASM **hash** を使い、deploy 時に constructor 引数（初期 signer = passkey）を渡して**アプリ実行時に各ユーザー分インスタンスを deploy**する。`createWallet()` がこれを内部で行う。

> 注意: これらは「Testnet にアップロード済みの現行値」。Testnet リセットや kit 側更新で失効しうる（9 章リスク）。デプロイ済みコントラクトは TTL 切れにも注意。

### 4.2 自前デプロイ（フォールバック / Testnet リセット時）

OZ `examples/multisig-smart-account` から自前ビルド・デプロイ可能。
出典: https://github.com/OpenZeppelin/stellar-contracts/blob/main/examples/multisig-smart-account/README.md

```bash
# OZ stellar-contracts を clone
git clone https://github.com/OpenZeppelin/stellar-contracts
cd stellar-contracts/examples/multisig-smart-account
stellar contract build       # 出力: target/wasm32v1-none/release/*.wasm

# デプロイ順: verifier → policy → account
stellar contract deploy --alias webauthn_verifier \
  --wasm ./target/wasm32v1-none/release/multisig_webauthn_verifier_example.wasm
stellar contract deploy --alias ed25519_verifier \
  --wasm ./target/wasm32v1-none/release/multisig_ed25519_verifier_example.wasm
stellar contract deploy --alias threshold_policy \
  --wasm ./target/wasm32v1-none/release/multisig_threshold_policy_example.wasm

# Smart Account は WASM を upload して hash を取得（deploy はアプリ実行時に createWallet で実施）
stellar contract upload \
  --wasm ./target/wasm32v1-none/release/multisig_smart_account_example.wasm
# → 出力された hash を VITE_ACCOUNT_WASM_HASH に設定
```

- OZ `stellar-accounts` crate バージョン: **0.7.1**、`soroban-sdk` **25.3.0**
  出典: https://github.com/OpenZeppelin/stellar-contracts/blob/main/Cargo.toml
- プリビルド WASM 配布は **なし**（`stellar contract build` でソースからビルドが必要）
  出典: 上記 multisig-smart-account README
- dicekey 側コントラクトの `soroban-sdk` は **22.0.5**（`Cargo.toml`）。OZ accounts (25.3.0) は**別ビルドツリー**なので dicekey の Cargo workspace に取り込む必要はない（dicekey コントラクトはコード変更不要、4 章/6 章）。バージョン差異は dicekey コントラクトのビルドに影響しない。

### 4.3 必要な環境変数（新規 / `.env.testnet` 拡張）

| 変数 | 用途 | 値の出所 |
|---|---|---|
| `VITE_RPC_URL` | 既存 | 既存 deploy-testnet.sh が出力 |
| `VITE_NETWORK_PASSPHRASE` | **新規** | 固定値 |
| `VITE_ACCOUNT_WASM_HASH` | **新規** | 4.1 の hash |
| `VITE_WEBAUTHN_VERIFIER_ADDRESS` | **新規** | 4.1 の C アドレス |
| `VITE_NATIVE_TOKEN_CONTRACT` | **新規** | 4.1（autoFund / createWallet 用） |
| `VITE_RP_ID` | **新規** | デモホスト名（`localhost` 等） |
| `VITE_HQ_SMART_ACCOUNT` | **新規** | 後述スクリプトで作成する本部 SA の C アドレス |
| `VITE_HQ_STAFF_CONTEXT_RULE_ID` | **新規** | 本部 SA の visit-stamps 限定 rule ID（固定運用） |
| `VITE_VISIT_STAMPS_CONTRACT` 他 4 | 既存 | 既存 deploy-testnet.sh |
| `VITE_ADMIN_ADDRESS` | **意味変更** | 旧: G-account / 新: `VITE_HQ_SMART_ACCOUNT` と同値 |
| `VITE_THRESHOLD_POLICY_ADDRESS` 他 | 任意 | policy を使う場合のみ |

---

## 5. コントラクト admin 写像の設計

### 5.1 結論: dicekey コントラクトのコード変更は不要

根拠（一次情報・実コード）:

- `contracts/shared/src/lib.rs` の `require_admin`:
  ```rust
  pub fn require_admin(env: &soroban_sdk::Env, caller: &Address) {
      let admin: Address = get_admin(env);
      if *caller != admin { panic!("not authorized"); }
      caller.require_auth();
  }
  ```
  `admin` は `Address`。Soroban の `Address` は G-account でも C-account（コントラクト）でも保持でき、`require_auth()` は対象が C-account のとき自動的にそのコントラクトの `__check_auth` を呼ぶ。
  出典: https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets
- `dicekey-visit-stamps.initialize(env, admin: Address)` は admin を `Address` としてそのまま保存（`contracts/dicekey-visit-stamps/src/lib.rs`）。**G/C を区別していない**。
- よって整合点は **初期化時に `--admin` を 本部 Smart Account の C アドレスにする**ことのみ。コントラクト再ビルド不要。

### 5.2 admin 設定の手順整合（`scripts/sa-setup.mjs` / `scripts/sa-setup-testnet.mjs`）

> **実装現状**: 旧 `scripts/initialize-contracts.sh` は削除済み。initialize + wire (set_beans_contract / set_policy_contract) は localnet/Testnet とも sa-harness の kit 経由 (`window.saHarness.initializeDicekey` + `wireContracts`) で実行する。CDP virtual authenticator を通した Playwright runner (`scripts/sa-setup{,-testnet}.mjs`) がオーケストレーション。本節は当時の設計判断の記録として残す。

旧設計では `VITE_ADMIN_ADDRESS`（friendbot 由来 G-account）を全コントラクトの `initialize --admin` に渡していた。

実装方針 (現行):

1. sa-harness の kit セッションで本部管理者 passkey を `kit.createWallet('dicekey HQ', 'hq-admin')` で作成 → 本部 SA C アドレス取得。
2. `kit.rules.add(createCallContractContext(<scope>), <name>, [signer], new Map())` で **3 つの CallContract context rule**（visit-stamps / beans-token / reward-policy）+ 4 つ目の benefits scope rule を作成 → rule ID を `VITE_HQ_STAFF_*_RULE_ID` に保存。  
   （案 C: 入れ子 `require_auth` 検証結果、issue() の 3 auth_contexts に index-aligned な 3 ルール構成で OZ `SmartAccountError #3014 ContextRuleIdsLengthMismatch` を回避）。
3. `.env.{localnet,testnet}` に `VITE_HQ_SMART_ACCOUNT` を出力し、admin = HQ SA C アドレスとする（旧 `VITE_ADMIN_ADDRESS` は廃止）。
4. `initialize`（`require_admin` を呼ばない）と `set_beans_contract`/`set_policy_contract`（`require_admin` を呼ぶ）を、本部 passkey 署名の **kit.signAndSubmit 経由** で連続実行（harness.ts の `initializeDicekey` + `wireContracts`）。

### 5.3 スタッフ Signer を発行操作に限定する context rule 設計

- **ContextRule#0 (Default)**: signer = 本部管理者 passkey。`set_beans_contract` 等の管理操作・recovery 用。
- **ContextRule#1 (CallContract = visit-stamps の C アドレス)**: signers = 渋谷/新宿/京都スタッフ passkey。これにより**スタッフ passkey は visit-stamps コントラクト宛の呼び出しのみ認可可能**（`ContextRuleType::CallContract(Address)` の scope 制御）。
  出典: OZ accounts `ContextRuleType` 定義（`CallContract(Address)`）
  https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/smart_account/storage.rs
- どのスタッフ passkey で発行したかは、署名に使われた credential（WebAuthn）でトランザクション上区別できる（v0.1 の要件「誰の passkey で発行したか記録」を満たす）。

> **要検証（重要）**: `visit-stamps.issue` は内部で `beans-token.mint(admin=本部SA, ...)` と `reward-policy.on_stamp_issued(admin=本部SA, ...)` を呼ぶ。これらも `本部SA.require_auth()` を要求するが、**呼び出し先コントラクトが `beans-token`/`reward-policy`** なので、`ContextRuleType::CallContract(visit-stamps)` だけではマッチしない可能性が高い。対応案:
> - 案 A: ContextRule#1 を `CallContract(visit-stamps)` ではなく、スタッフが使う3コントラクト（visit-stamps / beans-token / reward-policy）を含むよう **複数 rule** を作り、それぞれにスタッフ passkey を登録（最も確実だが scope が広がる）。
> - 案 B: ContextRule を `Default` にしてスタッフ passkey を本部 SA 全体に許可（scope 制御を諦める）。v0.1 要件と矛盾するため非推奨。
> - 案 C: 入れ子の `require_auth` がトップレベル 1 回の `__check_auth` で `Vec<Context>` としてまとめて検証されるなら、`CallContract(visit-stamps)` + `CallContract(beans-token)` + `CallContract(reward-policy)` の **3 つの context rule にスタッフ passkey を登録**することで scope を維持しつつ成立。
> 実装着手時に Testnet 上の 1 トランザクションで `issue`→`mint`→`on_stamp_issued` の auth context が実際にどう構成されるかを実測して確定する（9 章 未確定事項）。

### 5.4 顧客 Smart Account の妥当性

- 顧客は自分の passkey で `createWallet('dicekey Coffee Stamps', <name>)` → 顧客 SA を deploy。
- スタンプ/beans/特典/バッジの `to`/`owner` は顧客 SA の C アドレス。dicekey コントラクトは `owner: Address` を区別しないので C アドレスで問題なし（visit-stamps の `StampKey::Stamp(Address, u64)` 等は Address キー、実コード確認済み）。
- 顧客が beans を transfer / 特典を gift / 特典を burn する操作は、顧客 SA の `require_auth()` を伴う（`beans-token` の `transfer`/`burn_from`、`benefits` の `transfer`）。これは ContextRule#0(Default) + 顧客 passkey で認可。
- 「顧客個別 SA で保有」は v0.1 のノンカストディアル原則・SEP-45 方針と整合。**妥当**。

---

## 6. 依存追加・設定変更点

### 6.1 依存追加先

| package.json | 追加 | 理由 |
|---|---|---|
| `apps/customer-app/package.json` | `smart-account-kit@^0.3.0` | 顧客 SA 認証・署名 |
| `apps/staff-app/package.json` | `smart-account-kit@^0.3.0` | スタッフ多署名・発行 |
| `packages/sdk/package.json` | （任意）`smart-account-kit` を peer 化 / 直接は不要 | sdk は xdr.Operation を返すだけ。kit 連携はアプリ層で行う |
| ルート `package.json` | scripts 追加: `setup:hq`（本部 SA 作成）, `seed:testnet` | デモ初期化 |
| 各 `package.json` | `@simplewebauthn/browser` は kit の依存として推移取得（明示追加不要の見込み） | — |

> `smart-account-kit-bindings (workspace:*)` の npm 配布形態が未確定（3.1）。npm 直接インストール不可の場合のフォールバック: kit を git submodule / ローカル clone し `pnpm run build:all`（要 `demo/.env`）してから `file:` 参照、または bindings を別途生成。手順は実装タスク 2 で確定。

### 6.2 `packages/sdk/src/config.ts` の変更点

- `NetworkConfig` に Smart Account 関連フィールドを追加:
  ```typescript
  smartAccount: {
    accountWasmHash: string;
    webauthnVerifierAddress: string;
    nativeTokenContract: string;
    rpId: string;
    rpName: string;
    hqSmartAccount: string;            // 本部 SA C アドレス
    hqStaffContextRuleId: number;      // スタッフ rule（固定運用）
  }
  ```
- `TESTNET_CONFIG` を `import.meta.env.VITE_*` から読む（既存パターン踏襲）。`networkPassphrase` も env 化（現状ハードコード）。

### 6.3 scripts の変更点

> **実装現状**: 当初想定していた `create-hq-smart-account.ts` / `wire-contracts.ts` は単独スクリプトではなく、sa-harness (`tools/sa-harness/`) + Playwright runner (`scripts/sa-setup{,-testnet}.mjs`) に統合された。`initialize-contracts.sh` と `seed-demo.sh` は削除済み。

| スクリプト | 変更 |
|---|---|
| `scripts/deploy-testnet.sh` | `.env.testnet` に OZ Testnet 公開アドレス 7 つ (4.1) を埋め込み + `VITE_NETWORK_PASSPHRASE` / `VITE_RP_ID` 等を出力。fresh deploy のたびに `.env.testnet.bak` を残し、HQ SA 関係キーは空 pre-create。末尾で `.env.testnet` を `tools/sa-harness/.env.testnet` にミラー (harness Vite が `--mode testnet` で読む) |
| `scripts/sa-setup.mjs` (localnet) / `scripts/sa-setup-testnet.mjs` (Testnet) | sa-harness を Playwright + CDP virtual authenticator で駆動し、(a) HQ Smart Account 作成 → `VITE_HQ_SMART_ACCOUNT` / `VITE_HQ_ROOT_CREDENTIAL_ID` 書き戻し、(b) 3 + 1 staff context rule 作成 → `VITE_HQ_STAFF_*_RULE_ID` 書き戻し、(c) `initialize` + `set_beans_contract` + `set_policy_contract` を kit.signAndSubmit 経由で実行、(d) demo customer SA 作成 + 来店スタンプ 1 枚発行（U2 case C smoke）まで一気通貫 |
| `scripts/generate-bindings.sh` | dicekey 5 コントラクトの TS bindings 生成 + `@dicekey/contracts` build。localnet / Testnet とも同じ |

### 6.4 `.env.testnet` の変更点

4.3 の新規変数を追加。admin = 本部 SA C アドレス（旧 `VITE_ADMIN_ADDRESS` は廃止し、コード参照は `VITE_HQ_SMART_ACCOUNT` に統一）。デモ環境用に `apps/{customer,staff}-app/.env.production.example` を別途用意し、Cloudflare Pages 経由で apps を Testnet に向ける際の VITE_* キー一覧テンプレとして提供。

---

## 7. 実装ステップ分解（後続タスク 2〜7 対応）

### タスク 2: 依存追加・バインディング・Testnet インフラ準備

- [ ] `smart-account-kit@^0.3.0` を customer-app / staff-app に追加。`smart-account-kit-bindings` の npm 入手可否を実検証（不可なら clone+`build:all`+`file:` 参照に切替）。
- [ ] `@stellar/stellar-sdk` バージョン整合確認（dicekey `^15.1.0` vs kit peer `>=15.0.1` → OK）。
- [ ] 4.1 の Testnet 公開アドレスを `.env.testnet` / 各アプリ `.env` に投入。RPC 疎通・WASM hash の存在を `stellar` CLI で確認。
- [ ] フォールバック手順（OZ multisig-smart-account 自前ビルド）を README 化（Testnet リセット対策）。

### タスク 3: smart-account クライアント層の実装

- [ ] `packages/sdk`（または各アプリ）に `createKit()` ファクトリ（3.2 の config）を実装。
- [ ] `config.ts` 拡張（6.2）。`networkPassphrase` env 化。
- [ ] 既存 `build*Tx`（xdr.Operation）→ `kit.executeAndSubmit(target, fn, args)` で実行する薄いアダプタを sdk に追加（読み取り `get*` は simulate のまま）。
- [ ] credential/session 永続は `IndexedDBStorage`。

### タスク 4: customer-app の Smart Account 化

- [ ] `apps/customer-app/src/lib/passkey.ts` の自前 WebAuthn 実装を削除し kit に委譲。
- [ ] `AuthContext.tsx`: `Keypair.random()` / localStorage 平文鍵 / `loginDemo()` を削除。`login` = `kit.connectWallet({prompt})` または `kit.createWallet(...)`、起動時 `kit.connectWallet()` サイレント復帰。`publicKey` を顧客 SA C アドレスに置換。
- [ ] beans transfer / 特典 gift / 特典 burn を `kit.executeAndSubmit` で実トランザクション化。`fundWallet`（friendbot）で初期 XLM。
- [ ] 読み取り（残高/スタンプ）は既存 sdk simulate を顧客 SA アドレスで呼ぶ。

### タスク 5: staff-app のマルチ署名モデル実装

- [ ] `StaffAuthContext.tsx`: venue 選択のみ → 「店舗選択 + スタッフ passkey サインイン（本部 SA に connect）」へ。
- [ ] スタッフは本部 SA に `connectWallet({ contractId: VITE_HQ_SMART_ACCOUNT })` し、自分の店舗 passkey で署名。
- [ ] スタンプ発行 = `kit.executeAndSubmit(visitStamps, 'issue', [hqSA, customerSA, venue])`。venue はログイン店舗から。
- [ ] beans 利用 / 特典受取（burn 系）も同様に本部 SA 経由 + スタッフ passkey。
- [ ] スタッフ passkey 登録 UI/スクリプト（`create-hq-smart-account.ts`）。

### タスク 6: コントラクト/デプロイ整合と E2E 再構築

- [x] `deploy-testnet.sh` を fresh-deploy + OZ infra 埋め込み + harness env ミラーに改修。`initialize-contracts.sh` / `seed-demo.sh` を削除し、`sa-setup-testnet.mjs` (kit 経由) に統合。
- [x] `initialize --admin = HQ SA` を実行。`set_beans_contract` / `set_policy_contract` を本部 passkey 経由で実行。
- [x] **5.3 の入れ子 require_auth 検証** = 案 C (3 CallContract rules index-aligned) で確定。OZ `SmartAccountError #3014` 対策は `signAndSubmit` の `resolveContextRuleIds` で 3 つを順番に返す。
- [x] localnet E2E 再構築完了 (`pnpm test:e2e`)。Testnet E2E は friendbot rate / TTL のリスクから localnet only を維持。

### タスク 7: ドキュメント更新と完了報告

- [ ] `docs/v0.1.md` / `README.md` / `CLAUDE.md` の認証記述を実装に合わせ更新。
- [ ] デモ手順書（本部 SA 作成 → スタッフ passkey 登録 → 顧客 SA → 来店フロー）。

---

## 8. E2E 再構築方針

### 8.1 現状と削除対象

- `playwright.config.ts`: `headless: true`、`timeout: 15s`、dev サーバ外部起動前提。
- `e2e/customer-app.spec.ts`: 「デモモードで試す」「パスキーでサインイン（モック）」前提のテストが大半 → **削除/書き換え**。
- `e2e/staff-app.spec.ts`: venue 選択 + `[デモ] スキャン確認` 等のモック確認 → **削除/書き換え**。

### 8.2 WebAuthn の自動化（CDP 仮想認証器）

smart-account-kit 自身が `scripts/agent-browser-webauthn-helper.mjs` で CDP `WebAuthn.addVirtualAuthenticator` を使っており、これが参照実装。
出典: https://github.com/kalepail/smart-account-kit/blob/main/scripts/agent-browser-webauthn-helper.mjs

Playwright での標準パターン（CDP セッション経由）:

```typescript
const client = await context.newCDPSession(page);
await client.send('WebAuthn.enable');
const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
```

- Chromium 限定（Playwright の CDP は Chromium のみ）。`projects` を Chromium に固定。
- `IndexedDBStorage` を使うため、credential を作る create と後続 get で**同一 BrowserContext を維持**（リロードを跨ぐテストは context 再利用）。
- `rpId` は `localhost`（Playwright の baseURL がポート付き `localhost` でも rpId は `localhost`）。

### 8.3 Testnet 依存テストの安定化

- friendbot/RPC の不安定対策: `kit.fundWallet` 後にアカウント存在をポーリング。タイムアウトを 15s → 60〜90s に引き上げ、`retries: 1〜2`。
- テスト用 Smart Account は spec ごとに `createWallet` で新規作成（状態分離）。本部 SA とスタッフ passkey は事前に `setup` プロジェクトで 1 回作成し、`storageState` 的に再利用。
- 「来店フロー」E2E: スタッフ spec が顧客 SA に対し issue → 顧客 spec で残高反映を simulate 確認、までを 1 シナリオに。
- ネットワーク不安定でデモ実演が落ちないよう、E2E とは別に「読み取りのみのスモーク」も用意（任意）。

### 8.4 影響範囲

- `e2e/*.spec.ts` 全面書き換え。`playwright.config.ts`（Chromium 固定、timeout/retries、CDP 利用のためのプロジェクト調整）。
- モック前提のテキスト assert（`[デモ] スキャン確認`, `デモモードで試す`, `Demo User さん`）は全削除。

---

## 9. リスク・未確定事項・前提

### 9.1 未確定事項（実装着手時に一次確認が必要）

| # | 未確定事項 | 影響 | 確認方法 |
|---|---|---|---|
| U1 | `smart-account-kit-bindings (workspace:*)` の npm 配布形態。`smart-account-kit@0.3.0` 単体 `pnpm add` で解決するか | 依存導入経路（npm 直 vs clone+build:all） | 実際に `pnpm add smart-account-kit@0.3.0` を試す。失敗時は kit の README ビルド手順 |
| U2 | `issue`→内部 `mint`/`on_stamp_issued` の入れ子 `require_auth` が、本部 SA の 1 回の `__check_auth` で `Vec<Context>` としてまとめて検証されるか。context rule の scope を `CallContract(visit-stamps)` だけに絞れるか | スタッフ Signer の scope 設計（5.3 案 A/C） | Testnet で 1 tx 実行し auth entry / simulate の `auth` を観測 |
| U3 | `createWallet` の constructor 引数仕様（初期 signer/policy の渡し方）と autoFund 挙動の詳細 | 本部/顧客 SA 作成スクリプト | kit `src/kit.ts` 実コード / demo App.tsx を実装時に精読 |
| U4 | `kit.executeAndSubmit` が dicekey の `admin: Address` 引数（=本部SA 自身）を正しく渡せるか（SA が自分自身を引数で渡す形） | 発行 tx 構築 | demo App.tsx の executeAndSubmit 使用例 / 実測 |
| U5 | OZ accounts の `__check_auth` / `do_check_auth` の auth context 厳密仕様（`ContextRuleIdsLengthMismatch` 等） | エラー設計 | storage.rs / mod.rs 実コード精読（URL は本書記載） |
| U6 | OZ `stellar-accounts` 0.7.1 と smart-account-kit 0.3.0 が参照する WASM の互換（Testnet 公開 WASM hash がどの OZ バージョン由来か） | 自前デプロイ時の整合 | kit `demo/.env.example` 更新履歴 / kit README |

### 9.2 リスクと対処

| リスク | 影響 | 対処 |
|---|---|---|
| Testnet / friendbot 不安定 | 起動・デモ失敗 | リトライ + ポーリング、E2E timeout 拡大、デモ前ウォームアップ |
| Testnet リセット / kit 側公開アドレス失効 | 全機能停止 | 4.2 自前デプロイ手順を常備、`.env` 一元管理 |
| WebAuthn ヘッドレス制約 | E2E が動かない | CDP 仮想認証器（Chromium 固定）。truly headless では platform authenticator シミュレーション必須（8.2） |
| 入れ子 require_auth の scope（U2） | スタッフ Signer が広すぎ/動かない | 案 A/C を Testnet 実測で選択。最悪 Default rule で妥協（v0.1 と要相談） |
| TTL 切れ（SA / verifier / policy / dicekey 各コントラクト） | 認可失敗・データ消失 | `stellar contract extend`、デモ前に TTL 確認 |
| indexer 不使用で rule 列挙不可 | rule 管理 UI が作れない | rule ID を env 固定運用（`VITE_HQ_STAFF_CONTEXT_RULE_ID`）。管理 UI はスコープ外 |
| kit bindings ビルド要（U1） | 導入が重い | clone+`pnpm run build:all`（要 `demo/.env`）手順を CI/README に明記 |
| soroban-sdk バージョン差（dicekey 22.0.5 / OZ 25.3.0） | ビルド競合の懸念 | dicekey コントラクトは無改修・別ビルドツリー。OZ は WASM/アドレス利用のみで Cargo 統合しない |
| relayer 不使用＝ユーザーが手数料負担 | 顧客に XLM 必要 | Testnet は `fundWallet`(friendbot)。Mainnet はスコープ外 |

### 9.3 前提

- Testnet 限定。Mainnet / sponsored tx / SEP-30 リカバリ・rule 管理 UI はスコープ外（v0.1 と整合）。
- E2E は Chromium + CDP 仮想認証器前提（Playwright）。
- dicekey 5 コントラクトは**コード変更なし**（admin を C アドレスにする初期化整合のみ）。再ビルド/再デプロイは Testnet リセット時を除き不要。
- smart-account-kit は OZ stellar-contracts の smart account を利用する TS SDK であり、本設計は kit の API レイヤをそのまま採用する（独自 SA コントラクト実装はしない）。

---

## 10. 出典一覧

- smart-account-kit リポジトリ: https://github.com/kalepail/smart-account-kit
- smart-account-kit README: https://github.com/kalepail/smart-account-kit/blob/main/README.md
- smart-account-kit package.json: https://github.com/kalepail/smart-account-kit/blob/main/package.json
- smart-account-kit demo/.env.example（Testnet 公開アドレス）: https://github.com/kalepail/smart-account-kit/blob/main/demo/.env.example
- smart-account-kit CDP WebAuthn ヘルパ: https://github.com/kalepail/smart-account-kit/blob/main/scripts/agent-browser-webauthn-helper.mjs
- OpenZeppelin stellar-contracts: https://github.com/OpenZeppelin/stellar-contracts
- OZ accounts パッケージ: https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts
- OZ accounts storage.rs（Signer/ContextRule/ContextRuleType/do_check_auth）: https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/smart_account/storage.rs
- OZ accounts mod.rs（SmartAccount trait / execute）: https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/smart_account/mod.rs
- OZ multisig-smart-account 例（ビルド/デプロイ手順）: https://github.com/OpenZeppelin/stellar-contracts/blob/main/examples/multisig-smart-account/README.md
- OZ Cargo.toml（stellar-accounts 0.7.1 / soroban-sdk 25.3.0）: https://github.com/OpenZeppelin/stellar-contracts/blob/main/Cargo.toml
- OZ Smart Accounts ドキュメント: https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account
- Stellar Smart Wallets ガイド（カスタムアカウント / __check_auth 委譲）: https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets
- 参照した既存コード: `contracts/shared/src/lib.rs`, `contracts/dicekey-visit-stamps/src/lib.rs`, `packages/sdk/src/{config,client,visit-stamps}.ts`, `apps/customer-app/src/{lib/passkey.ts,contexts/AuthContext.tsx}`, `apps/staff-app/src/contexts/StaffAuthContext.tsx`, `scripts/deploy-testnet.sh`, `scripts/sa-setup{,-testnet}.mjs`, `tools/sa-harness/src/harness.ts`, `playwright.config.ts`, `e2e/*.spec.ts`

---

## 11. 実装版補正（smart-account-kit@0.2.10 確定 / §3〜§4 を上書き）

**ステータス**: 確定（インストール済み実体 + 同梱 README + repo `demo/.env.example` で一次確認, 2026-05-19）
本章は §3〜§4 と矛盾する箇所を **上書き**する（npm 公開最新は repo main の 0.3.0 ではなく **0.2.10**）。

### 11.1 バージョン

- npm 公開最新 = `smart-account-kit@0.2.10`（`dist-tags.latest`）。`0.3.0` は未公開。
- 依存 `smart-account-kit-bindings@0.1.2`（**固定版・npm 公開済み**, dep は `buffer` のみ）。
  → **U1 解決**: `pnpm add smart-account-kit@^0.2.10` で解決。clone + `build:all` + `file:` 参照のフォールバックは**不要**。
- 導入済み: `apps/customer-app` / `apps/staff-app` の `package.json`（`smart-account-kit: ^0.2.10`）。
- `@stellar/stellar-sdk` peer `>=14.0.0` ⊇ dicekey `^15.1.0` → OK。

### 11.2 §3.3 を上書き — `executeAndSubmit()` は 0.2.10 に存在しない（D1）

- 採用する契約呼び出し経路（確定）:
  1. **書き込み**: 各 dicekey 契約の TypeScript バインディング（`stellar contract bindings typescript`,
     既存 `scripts/generate-bindings.sh` + `packages/contracts`）が返す `AssembledTransaction<T>` を
     **`kit.signAndSubmit(assembledTx, { credentialId? })`** に渡して署名・再シミュレート・提出。
     - 例: `await kit.signAndSubmit(visitStampsClient.issue({ admin: HQ_SA, to: customerSA, venue }))`
     - マルチ署名が要る場合は `kit.multiSigners.operation(assembledTx, selectedSigners)`。
  2. **読み取り**: 既存 `@dicekey/sdk` の `get*`（simulate）をそのまま流用、または同バインディングの
     `.simulate()`。`buildIssueStampTx` 等（`xdr.Operation` 返し）は signAndSubmit には不適合のため
     書き込み主経路から外す（読み取り系 `getStampCount`/`getBeansBalance` は維持）。
- `kit.signAndSubmit` のシグネチャ: `signAndSubmit<T>(tx: AssembledTransaction<T>, options?: { credentialId?, expiration?, forceMethod? }) → Promise<TransactionResult>`。
- `AssembledTransaction` は `smart-account-kit` から re-export される（`import type { AssembledTransaction } from 'smart-account-kit'`）。

### 11.3 §3.2 を上書き — SmartAccountConfig（0.2.10 実フィールド）

必須: `rpcUrl`, `networkPassphrase`, `accountWasmHash`, `webauthnVerifierAddress`。
任意: `storage`, `rpId`, `rpName`, `relayerUrl`, `timeoutInSeconds`(=30), `sessionExpiryMs`(=7d),
`indexerUrl`(string|false), `defaultPolicies`, `signatureExpirationLedgers`(=720), `externalWallet`。
→ dicekey は `relayerUrl` 未設定（ノンカストディアル）、`indexerUrl: false`（rule ID 固定運用で indexer 不要）、
`storage: new IndexedDBStorage()`。

主要メソッド（README 確定）:
`createWallet(appName, userName, { autoSubmit?, autoFund?, nativeTokenContract?, nickname? })`,
`connectWallet({ prompt?, fresh?, credentialId?, contractId? })`, `disconnect()`,
`signAndSubmit(tx, opts?)`, `sign(tx, opts?)`, `signAuthEntry(entry, opts?)`,
`fundWallet(nativeTokenContract)`, `transfer(token, to, amount, opts?)`。
サブマネージャ: `kit.rules.add(contextType, name, signers, policies)` / `.get` / `.getAll` / `.remove` /
`.updateExpiration`、`kit.signers.addPasskey(ruleId, appName, userName, opts?)` / `.addDelegated` /
`.remove` / `.removePasskey`、`kit.policies.add(ruleId, policyAddr, installParams)` / `.remove`、
`kit.multiSigners.operation/transfer/buildSelectedSigners/needsMultiSigner`。
ビルダー: `createDefaultContext()`, `createCallContractContext('C...')`, `createWebAuthnSigner`,
`createDelegatedSigner`, `createThresholdParams(n)`, `createSpendingLimitParams(token, amount, ledgers)`。
Storage export: `IndexedDBStorage` / `LocalStorageAdapter` / `MemoryStorage`（`'smart-account-kit'` 本体から import 可、`'/storage'` サブパスもあり）。

### 11.4 §4 を上書き — Testnet インフラ値（0.2.x/main 共通・一次確認済み）

constants に焼き込みは**無い**（D8）。すべて env 供給。値は repo `demo/.env.example` と一致（§4.1 と同一）:

| env | 値 |
|---|---|
| `VITE_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `VITE_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `VITE_ACCOUNT_WASM_HASH` | `8537b8166c0078440a5324c12f6db48d6340d157c306a54c5ea81405abcc2611` |
| `VITE_WEBAUTHN_VERIFIER_ADDRESS` | `CCMR63YE5T7MPWREF3PC5XNTTGXFSB4GYUGUIT5POHP2UGCS65TBIUUU` |
| `VITE_ED25519_VERIFIER_ADDRESS` | `CCJOUKLCZVCXS4VIBBEA7S3SPWZQS5DPE5A4YG67RA3Z7E3SJZAUJFQA` |
| `VITE_NATIVE_TOKEN_CONTRACT` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| `VITE_THRESHOLD_POLICY_ADDRESS` | `CB2WQXF2XXDGUV2CTVQ23RLN3ESI3IY5KKX3KVXWBNRTTWDHZM76NVKJ` |
| `VITE_SPENDING_LIMIT_POLICY_ADDRESS` | `CBBZ2XP4LBDEO2EELTZKJSPQZDREFKCULL6CKIUQO53S42RZABOYQUK3` |
| `VITE_WEIGHTED_THRESHOLD_POLICY_ADDRESS` | `CCF65VXVORNOZBRR3EG3GZYSFS3ALDG44CDYN5T5KRWKYX6RXLKLXER4` |

`.env.testnet` は `deploy-testnet.sh` が `cat >` で**全上書き生成**するため、手書きせず
**`deploy-testnet.sh` を改修**して上記 + `VITE_HQ_SMART_ACCOUNT`/`VITE_HQ_STAFF_CONTEXT_RULE_ID`
プレースホルダを出力させる（§6.3 の方針を踏襲）。

### 11.5 ツール備考

- `gh` CLI はこの環境に**未インストール**。GitHub 操作は `git` / WebFetch(raw) で代替。
- `stellar` CLI = 26.0.0、node 22、pnpm 11。`pnpm install` は devcontainer ストア不整合のため
  `CI=true pnpm install`（非対話・modules 再生成）が必要だった。

---

## 12. 実装結果（localnet で E2E 検証済 / 確定事実）

**ステータス**: 統合完了。`pnpm test:e2e` が customer-app・staff-app の実フローを実 localnet + CDP 仮想認証器で **2 specs PASS**。`scripts/sa-setup.mjs` で U2 PASS（`stamp_count=1`/`beans=10`）。

### 12.1 確定した解決事項（§3〜§11 を上書きする最終事実）
1. **kit は未公開 0.3.0 をソースビルド**（npm `0.2.10` は現行 OZ ABI 非互換＝`get_context_rules` 欠落）。`.oz-build/smart-account-kit` を `file:` で `@dicekey/sdk`/両アプリ/`tools/sa-harness` に配線（`pnpm-workspace.yaml` overrides で bindings 解決）。`packages/sdk/src/smart-account.ts` は 0.3.0 と無修正で型整合。
2. **ビルドターゲットは `wasm32v1-none`**（`stellar contract build`）。現行 rustc では `wasm32-unknown-unknown` が Soroban 非互換 wasm を生成し state 変更呼出が `UnreachableCodeReached`。`contractimport!` パスも `target/wasm32v1-none/release/` へ更新済。
3. **契約の再入バグ修正**: `visit-stamps.issue` が新カウントを `reward-policy.on_stamp_issued(admin,user,stamp_count)` に渡す（policy からの `stamp_count` 逆呼び出しを廃止＝Soroban の contract re-entry 禁止）。`VenueId` 別名は `String` 直書きへ。`cargo test` 46 件 green。
4. **U2 の答え = case C（§5.3 の選択肢 C で確定）**: `issue()` の認可ツリーは `admin(=本部SA).require_auth` を3回（issue@visit-stamps / mint@beans-token / on_stamp_issued@reward-policy）。OZ `__check_auth` は `AuthPayload.context_rule_ids` を3 `auth_contexts` と **index 整合**で要求（不一致＝`SmartAccountError #3014 ContextRuleIdsLengthMismatch`）。よってスタッフ passkey を **3 CallContract rule（visit-stamps/beans-token/reward-policy）すべての signer** とし、発行は `signAndSubmitTx(tx,{credentialId:staffCred, resolveContextRuleIds:()=>[r_vs,r_beans,r_policy]})`。単一 rule は不可。OZ rule 名上限 `MAX_NAME_SIZE=20` bytes。kit 0.3.0 の API は `contextRuleIds` 配列ではなく `resolveContextRuleIds(entry,index)` コールバック。
5. **スタッフ sign-in 形**: スタッフ credential を `connectWallet` してはいけない（kit は credential 保存の contractId で上書きする）。**本部 root credential で本部 SA に connect** したまま、発行時に staff credential を `signAndSubmit` の `credentialId` に渡す（`__check_auth` 内で on-chain rule から signer 解決し staff passkey を要求）。
6. **インフラ前提**: kit は plain-http RPC を拒否 → `scripts/rpc-https-proxy.mjs`（`https://127.0.0.1:8443/rpc`）。kit fee payer 固定鍵 `GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N`（relayer 不使用、要 friendbot 供給）。`sa-setup`/E2E は **one-shot**（契約はその run の本部SAで initialize 済になる）→ 毎回 `deploy-localnet.sh`→`generate-bindings.sh`→sa-harness 再起動→実行を1パス。CDP ヘッドレス Chromium は稀に SIGSEGV→リトライ。
7. **`@dicekey/contracts`** は各 binding の**コンパイル済 `dist`** を取り込む（codegen の未使用 import が strict consumer の `noUnusedLocals` を破るため、binding 個別 tsconfig でビルドし `.d.ts` を `skipLibCheck` 下で消費）。`generate-bindings.sh` 末尾で `pnpm --filter @dicekey/contracts build`。

### 12.2 既知の制約（スコープ外・TODO）
- staff-app の Use Beans は `beans-token.burn_from`（顧客→本部の事前 `approve` が必要、customer 側未実装）。Receive Benefit は `benefits` に `burn_from` 系エントリポイントが無く本部経由 burn 不可（コントラクト追加が必要）。いずれも `apps/staff-app/src/lib/chain.ts` に TODO 明記。スタンプ発行フローは完全動作。
- 主要参照実装: `tools/sa-harness/src/harness.ts`（`setupStaffRules`/`issueStamp`）、`scripts/sa-setup.mjs`、`e2e/{fixtures,global-setup}.ts`、`scripts/smoke-{customer,staff}-app.mjs`。

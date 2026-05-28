# dicekey Coffee Stamps API 仕様書（逆生成）

## 分析概要

| 項目 | 値 |
|---|---|
| **分析日時** | 2026-05-19 |
| **API 種別** | Soroban Smart Contract (JSON-RPC over HTTPS) |
| **RPC エンドポイント** | `https://soroban-testnet.stellar.org` |
| **Network Passphrase** | `Test SDF Network ; September 2015` |
| **コントラクト数** | 5 + 1 shared library |
| **公開関数数** | 39 |

---

## 呼び出し方式

### Soroban RPC

全 API は Stellar Soroban JSON-RPC プロトコルで呼び出す。HTTP REST API ではなく、Soroban トランザクションとして送信する。

```
Client → SDK (TypeScript) → TransactionBuilder → Soroban RPC → Contract
```

### 認証方式

| 操作種別 | 認証 | 実装 |
|---|---|---|
| Admin 操作 | Admin Stellar アドレス + トランザクション署名 | `shared::require_admin()` |
| ユーザー操作 | ユーザー Stellar アドレス + トランザクション署名 | `Address::require_auth()` |
| 読み取り | 認証不要 | `simulateTransaction` |

### トランザクション共通設定

```typescript
// SDK: packages/sdk/src/visit-stamps.ts, beans-token.ts
const tx = new TransactionBuilder(sourceAccount, {
  fee: "100",           // 100 stroops
  networkPassphrase: config.networkPassphrase,
})
  .addOperation(contractCall)
  .setTimeout(30)       // 30 seconds
  .build();
```

---

## Contract 1: dicekey-visit-stamps

**Address:** `VITE_VISIT_STAMPS_CONTRACT`
**Standard:** SEP-50 (Soulbound NFT)

### 初期化・設定

#### `initialize(admin: Address)`

コントラクトを初期化し、admin アドレスを設定する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者アドレス |

**前提条件:** 未初期化であること
**副作用:** `NextId = 0`, `Initialized = true`
**エラー:** 既に初期化済みの場合 panic

---

#### `set_beans_contract(admin: Address, beans_contract: Address)`

Beans トークンコントラクトのアドレスを設定する（自動ミント用）。

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者アドレス (require_admin) |
| `beans_contract` | Address | dicekey-beans-token のアドレス |

---

#### `set_policy_contract(admin: Address, policy_contract: Address)`

報酬ポリシーコントラクトのアドレスを設定する（自動評価用）。

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者アドレス (require_admin) |
| `policy_contract` | Address | dicekey-reward-policy のアドレス |

---

### スタンプ発行

#### `issue(admin: Address, to: Address, venue: String) → u64`

顧客にスタンプを発行する。自動的に 10 Beans をミントし、ポリシーエンジンを呼び出す。

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者アドレス (require_admin) |
| `to` | Address | 顧客アドレス |
| `venue` | String | 店舗 ID (e.g., "shibuya") |

**戻り値:** `u64` — 発行されたスタンプ ID
**副作用:**
- VisitStamp レコード作成
- `stamp_count[to]++`, `venue_count[to][venue]++`, `NextId++`
- Cross-contract: `beans_token.mint(admin, to, 10)`
- Cross-contract: `reward_policy.on_stamp_issued(admin, to)`
- Event: `("stamp", "issued") → (to, id, timestamp)`

---

### クエリ

#### `name() → String`
Returns `"dicekey Visit Stamps"`

#### `symbol() → String`
Returns `"DICEKEY-VISIT"`

#### `token_uri(owner: Address, id: u64) → String`
スタンプのメタデータ URI を返す。

#### `balance(owner: Address) → u64`
顧客のスタンプ総数を返す。

#### `stamp_count(owner: Address) → u64`
`balance()` のエイリアス。

#### `venue_count(owner: Address, venue: String) → u64`
特定店舗でのスタンプ数を返す。

#### `get_stamp(owner: Address, id: u64) → VisitStamp`
個別スタンプの詳細を返す。存在しない場合 panic。

#### `list_stamps(owner: Address, offset: u64, limit: u64) → Vec<VisitStamp>`
スタンプ一覧をページネーション付きで返す。

#### `total_issued() → u64`
グローバルなスタンプ発行総数を返す。

#### `transfer(from: Address, to: Address, id: u64)`
**常に panic** — スタンプは Soulbound（譲渡不可）。

---

## Contract 2: dicekey-beans-token

**Address:** `VITE_BEANS_TOKEN_CONTRACT`
**Standard:** SEP-41 (Fungible Token)

### 初期化

#### `initialize(admin: Address)`

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者アドレス |

**副作用:** `TotalSupply = 0`, `Initialized = true`

---

### SEP-41 Token Interface

#### `name() → String`
Returns `"dicekey Beans"`

#### `symbol() → String`
Returns `"BEANS"`

#### `decimals() → u32`
Returns `0` (整数単位)

#### `balance(id: Address) → i128`
アドレスの Beans 残高を返す。未設定の場合 `0`。

#### `total_supply() → i128`
Beans の総供給量を返す。

---

### Transfer & Allowance

#### `transfer(from: Address, to: Address, amount: i128)`

Beans を送金する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `from` | Address | 送信元 (require_auth) |
| `to` | Address | 送信先 |
| `amount` | i128 | 送金額 (> 0) |

**バリデーション:** amount > 0, balance >= amount
**Event:** `("beans", "xfer") → (from, to, amount)`

---

#### `approve(from: Address, spender: Address, amount: i128)`

Allowance（委任送金枠）を設定する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `from` | Address | 所有者 (require_auth) |
| `spender` | Address | 委任先 |
| `amount` | i128 | 承認額 (>= 0) |

**Event:** `("beans", "approve") → (from, spender, amount)`

---

#### `allowance(from: Address, spender: Address) → i128`
現在の Allowance 残高を返す。未設定の場合 `0`。

---

#### `transfer_from(spender: Address, from: Address, to: Address, amount: i128)`

Allowance を使用して送金する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `spender` | Address | 委任先 (require_auth) |
| `from` | Address | 所有者 |
| `to` | Address | 送信先 |
| `amount` | i128 | 送金額 (> 0) |

**バリデーション:** amount > 0, allowance >= amount, balance >= amount
**副作用:** allowance -= amount, balance[from] -= amount, balance[to] += amount
**Event:** `("beans", "xfer") → (from, to, amount)`

---

### Mint & Burn

#### `mint(admin: Address, to: Address, amount: i128)`

Beans をミントする。**Admin only.**

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者 (require_admin) |
| `to` | Address | 受取人 |
| `amount` | i128 | ミント量 (> 0) |

**副作用:** balance[to] += amount, total_supply += amount
**Event:** `("beans", "mint") → (to, amount)`

---

#### `burn(from: Address, amount: i128)`

自身の Beans をバーンする。

| パラメータ | 型 | 説明 |
|---|---|---|
| `from` | Address | バーン元 (require_auth) |
| `amount` | i128 | バーン量 (> 0) |

**副作用:** balance[from] -= amount, total_supply -= amount
**Event:** `("beans", "burn") → (from, amount)`

---

#### `burn_from(spender: Address, from: Address, amount: i128)`

Allowance を使用して Beans をバーンする。

| パラメータ | 型 | 説明 |
|---|---|---|
| `spender` | Address | 委任先 (require_auth) |
| `from` | Address | 所有者 |
| `amount` | i128 | バーン量 (> 0) |

**副作用:** allowance -= amount, balance[from] -= amount, total_supply -= amount
**Event:** `("beans", "burn") → (from, amount)`

---

## Contract 3: dicekey-benefits

**Address:** `VITE_BENEFITS_CONTRACT`
**Standard:** SEP-50 (Transferable NFT)

### 初期化

#### `initialize(admin: Address)`
**副作用:** `NextId = 0`, `Initialized = true`

---

### NFT 管理

#### `mint(admin: Address, to: Address, kind: String, expires_at: u64) → u64`

特典券 NFT を発行する。**Admin only.**

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者 (require_admin) |
| `to` | Address | 受取人 |
| `kind` | String | 種別 (e.g., "free_drink_voucher") |
| `expires_at` | u64 | 有効期限 (timestamp, 0 = 無期限) |

**戻り値:** `u64` — トークン ID
**副作用:** Token(id) 作成, OwnerTokens 追加, OwnerCount++, NextId++
**Event:** `("benefit", "mint") → (to, id)`

---

#### `transfer(from: Address, to: Address, token_id: u64)`

特典券を他ユーザーに譲渡（ギフト）する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `from` | Address | 送信元 (require_auth, 所有者であること) |
| `to` | Address | 受取人 |
| `token_id` | u64 | トークン ID |

**バリデーション:** 所有者確認, 有効期限チェック
**副作用:** owner 更新, リスト更新, カウント更新
**Event:** `("benefit", "xfer") → (from, to, token_id)`

---

#### `burn(owner: Address, token_id: u64)`

特典券を利用（バーン）する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `owner` | Address | 所有者 (require_auth) |
| `token_id` | u64 | トークン ID |

**バリデーション:** 所有者確認, 有効期限チェック
**副作用:** Token 削除, リスト更新, カウント減少
**Event:** `("benefit", "burn") → (owner, token_id)`

---

### クエリ

#### `name() → String`
Returns `"dicekey Benefits"`

#### `symbol() → String`
Returns `"DICEKEY-BEN"`

#### `balance(owner: Address) → u64`
所有する特典券数を返す。

#### `get_token(token_id: u64) → BenefitNft`
トークン詳細を返す。存在しない場合 panic。

#### `owner_count(owner: Address) → u64`
`balance()` のエイリアス。

#### `list_tokens(owner: Address) → Vec<u64>`
所有するトークン ID リストを返す。

#### `total_minted() → u64`
グローバルなミント総数を返す。

---

## Contract 4: dicekey-badges

**Address:** `VITE_BADGES_CONTRACT`
**Standard:** SEP-50 (Soulbound NFT)

### 初期化

#### `initialize(admin: Address)`
**副作用:** `NextId = 0`, `Initialized = true`

---

### バッジ管理

#### `issue(admin: Address, to: Address, kind: String) → u64`

バッジを発行する。**Admin only.** 同一 (user, kind) ペアは 1 回のみ。

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者 (require_admin) |
| `to` | Address | 受取人 |
| `kind` | String | バッジ種別 (e.g., "coffee_master") |

**戻り値:** `u64` — バッジ ID
**バリデーション:** 同一種別の重複チェック
**副作用:** Badge(to, kind) 作成, BadgeKinds 追加, BadgeCount++, NextId++
**Event:** `("badge", "issued") → (to, kind, id)`

---

#### `transfer(from: Address, to: Address, kind: String)`
**常に panic** — バッジは Soulbound（譲渡不可）。

---

### クエリ

#### `name() → String`
Returns `"dicekey Badges"`

#### `symbol() → String`
Returns `"DICEKEY-BADGE"`

#### `balance(owner: Address) → u64`
バッジ保有数を返す。

#### `has_badge(owner: Address, kind: String) → bool`
特定種別のバッジを保有しているか確認する。

#### `badge_count(owner: Address) → u64`
`balance()` のエイリアス。

#### `get_badge(owner: Address, kind: String) → Badge`
バッジ詳細を返す。存在しない場合 panic。

#### `list_badges(owner: Address) → Vec<String>`
保有バッジ種別リストを返す。

#### `total_issued() → u64`
グローバルな発行総数を返す。

---

## Contract 5: dicekey-reward-policy

**Address:** `VITE_REWARD_POLICY_CONTRACT`

### 初期化

#### `initialize(admin: Address, visit_stamps: Address, benefits: Address, badges: Address)`

ポリシーエンジンを初期化し、参照コントラクトのアドレスを設定する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者 |
| `visit_stamps` | Address | dicekey-visit-stamps のアドレス |
| `benefits` | Address | dicekey-benefits のアドレス |
| `badges` | Address | dicekey-badges のアドレス |

---

### ポリシー評価

#### `on_stamp_issued(admin: Address, user: Address) → u32`

スタンプ発行後に自動呼び出しされ、全ポリシーを評価する。**Admin only.**

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者 (require_admin) |
| `user` | Address | 対象顧客 |

**戻り値:** `u32` — 付与された報酬数 (0, 1, or 2)
**ポリシー評価:**

| ポリシー ID | 条件 | 報酬 |
|---|---|---|
| `10visit_bonus` | stamp_count >= 10 | benefits.mint("free_drink_voucher") |
| `100visit_master` | stamp_count >= 100 | badges.issue("coffee_master") |

**Event:** `("policy", "reward") → (user, policy_id)` (報酬ごとに 1 回)

---

#### `check_morning_policy(admin: Address, user: Address, morning_visits: u64)`

朝活ポリシーを手動評価する。**Admin only.**

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者 (require_admin) |
| `user` | Address | 対象顧客 |
| `morning_visits` | u64 | 朝 (6-10時) の来店回数 (オフチェーン検証済み) |

**条件:** morning_visits >= 20 AND !claimed("morning_lover")
**報酬:** badges.issue("morning_master")

---

#### `check_spring_policy(admin: Address, user: Address, spring_visits: u64)`

春キャンペーンポリシーを手動評価する。**Admin only.**

| パラメータ | 型 | 説明 |
|---|---|---|
| `admin` | Address | 管理者 (require_admin) |
| `user` | Address | 対象顧客 |
| `spring_visits` | u64 | 春期間 (3/1-5/31) の来店回数 (オフチェーン検証済み) |

**条件:** spring_visits >= 5 AND !claimed("spring_campaign")
**報酬:** badges.issue("spring_2026")

---

### クエリ

#### `is_claimed(user: Address, policy_id: String) → bool`
ポリシー報酬が既にクレーム済みか確認する。

---

## QR コードペイロード仕様

フロントエンド間の通信は QR コードのペイロードを介して行われる。

### スタンプ発行 QR

```json
{
  "action": "issue_stamp",
  "venue": "shibuya",
  "timestamp": 1716120000,
  "nonce": "abc123",
  "valid_until": 1716120060
}
```

**有効期限:** 60 秒

### Beans 利用 QR

```json
{
  "action": "use_beans",
  "item": "drip_coffee_s",
  "beans": 30,
  "timestamp": 1716120000,
  "nonce": "def456",
  "valid_until": 1716120120
}
```

**有効期限:** 120 秒

### 特典券受取 QR

```json
{
  "action": "burn_benefit",
  "timestamp": 1716120000,
  "nonce": "ghi789",
  "valid_until": 1716120120
}
```

**有効期限:** 120 秒

---

## メニュー品目と Beans 価格

| 品目 | Beans |
|---|---|
| ドリップコーヒー (S) | 30 |
| ドリップコーヒー (M) | 35 |
| カフェラテ (S) | 40 |
| カフェラテ (M) | 45 |
| カプチーノ | 45 |
| カフェモカ | 55 |

---

## SDK TypeScript API

### visit-stamps SDK

```typescript
// トランザクションビルダー
buildIssueStampTx(source: string, admin: string, to: string, venue: string): xdr.Operation

// クエリ
getStampCount(owner: string): Promise<number>
getVenueCount(owner: string, venue: string): Promise<number>
```

### beans-token SDK

```typescript
// トランザクションビルダー
buildMintBeansTx(admin: string, to: string, amount: number): xdr.Operation
buildTransferBeansTx(from: string, to: string, amount: number): xdr.Operation
buildBurnBeansTx(from: string, amount: number): xdr.Operation

// クエリ
getBeansBalance(owner: string): Promise<number>
getBeansTotalSupply(): Promise<number>  // stub: returns 0
```

### 共通設定

```typescript
interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    visitStamps: string;
    beansToken: string;
    benefits: string;
    badges: string;
    rewardPolicy: string;
  };
}

// 環境変数キー
VITE_VISIT_STAMPS_CONTRACT
VITE_BEANS_TOKEN_CONTRACT
VITE_BENEFITS_CONTRACT
VITE_BADGES_CONTRACT
VITE_REWARD_POLICY_CONTRACT
VITE_ADMIN_ADDRESS
VITE_NETWORK          // "testnet"
VITE_RPC_URL          // "https://soroban-testnet.stellar.org"
```

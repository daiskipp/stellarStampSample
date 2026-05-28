# dicekey Coffee Stamps データフロー図（逆生成）

## 分析概要

| 項目 | 値 |
|---|---|
| **分析日時** | 2026-05-19 |
| **フロー数** | 6 メインフロー |

---

## 1. スタンプ発行フロー（メインフロー）

システムの中核フロー。スタンプ発行が Beans 自動ミントとポリシー評価をカスケード的にトリガーする。

```mermaid
sequenceDiagram
    participant Staff as スタッフアプリ
    participant QR as QR コード
    participant Customer as 顧客アプリ
    participant SDK as SDK (TypeScript)
    participant RPC as Soroban RPC
    participant VS as dicekey-visit-stamps
    participant BT as dicekey-beans-token
    participant RP as dicekey-reward-policy
    participant BN as dicekey-benefits
    participant BG as dicekey-badges

    Staff->>QR: QR 生成 (venue, timestamp, nonce, valid_until=60s)
    Customer->>QR: スキャン
    QR-->>Customer: { action: "issue_stamp", venue, ... }
    Customer->>SDK: buildIssueStampTx(admin, customer, venue)
    SDK->>RPC: simulateTransaction → sendTransaction
    RPC->>VS: issue(admin, customer, venue)

    Note over VS: VisitStamp 作成<br/>stamp_count++<br/>venue_count++

    VS->>BT: mint(admin, customer, 10)
    Note over BT: balance[customer] += 10<br/>total_supply += 10<br/>emit ("beans", "mint")

    VS->>RP: on_stamp_issued(admin, customer)

    RP->>VS: stamp_count(customer)
    VS-->>RP: count (e.g., 10)

    alt count >= 10 AND !claimed("10visit_bonus")
        Note over RP: mark_claimed FIRST<br/>(reentrancy guard)
        RP->>BN: mint(admin, customer, "free_drink_voucher", 0)
        Note over BN: BenefitNft 作成<br/>emit ("benefit", "mint")
        Note over RP: emit ("policy", "reward")
    end

    alt count >= 100 AND !claimed("100visit_master")
        Note over RP: mark_claimed FIRST
        RP->>BG: issue(admin, customer, "coffee_master")
        Note over BG: Badge 作成<br/>emit ("badge", "issued")
        Note over RP: emit ("policy", "reward")
    end

    RP-->>VS: rewards_count
    VS-->>RPC: stamp_id
    Note over VS: emit ("stamp", "issued")

    RPC-->>SDK: TransactionResult
    SDK-->>Customer: 発行完了
    Customer-->>Staff: スキャン確認
    Staff->>Staff: "+1 スタンプ" 表示
```

---

## 2. 顧客認証フロー

```mermaid
sequenceDiagram
    participant U as 顧客
    participant App as customer-app
    participant WA as WebAuthn API
    participant LS as LocalStorage
    participant SK as Stellar Keypair

    alt 新規登録
        U->>App: 名前入力
        App->>WA: registerPasskey(username)
        Note over WA: Platform Authenticator<br/>ES256 (P-256)<br/>Resident Key Required<br/>User Verification Required
        WA-->>App: credential (id + publicKey)
        App->>SK: Keypair.random()
        Note over SK: Phase 1: ランダムキー<br/>Phase 2: Passkey 由来
        SK-->>App: publicKey
        App->>LS: set("dicekey_auth", {publicKey, displayName})
        App-->>U: ホーム画面へ遷移
    end

    alt デモモード
        U->>App: デモログインボタン
        App->>SK: 決定論的キー生成
        App->>LS: set("dicekey_auth", {publicKey, displayName: "Demo"})
        App-->>U: ホーム画面へ遷移
    end

    alt 再訪問
        App->>LS: get("dicekey_auth")
        LS-->>App: {publicKey, displayName}
        App-->>U: ホーム画面へ遷移 (自動ログイン)
    end

    alt ログアウト
        U->>App: ログアウトボタン
        App->>LS: remove("dicekey_auth")
        App-->>U: ログイン画面へ遷移
    end
```

---

## 3. 特典券ギフトフロー

```mermaid
sequenceDiagram
    participant Sender as 送信者 (顧客)
    participant App as customer-app
    participant SDK as SDK
    participant RPC as Soroban RPC
    participant BN as dicekey-benefits

    Sender->>App: リワード画面 → 特典券選択 → "ギフト"
    App->>App: ギフトダイアログ表示
    Sender->>App: 宛先入力 + 送信ボタン
    App->>SDK: buildTransferBenefitTx(sender, recipient, tokenId)
    SDK->>RPC: simulateTransaction → sendTransaction
    RPC->>BN: transfer(sender, recipient, tokenId)

    Note over BN: require_auth(sender)
    Note over BN: 有効期限チェック<br/>expires_at == 0 || expires_at > now

    alt 有効
        Note over BN: owner 更新<br/>sender リスト除去<br/>recipient リスト追加<br/>カウント更新
        Note over BN: emit ("benefit", "xfer")
        BN-->>RPC: success
        RPC-->>SDK: TransactionResult
        SDK-->>App: 完了
        App-->>Sender: "Sent" 確認メッセージ
    end

    alt 期限切れ
        Note over BN: panic!("benefit expired")
        BN-->>RPC: error
        RPC-->>SDK: error
        SDK-->>App: エラー
        App-->>Sender: エラーメッセージ
    end
```

---

## 4. Beans 利用フロー（店舗）

```mermaid
sequenceDiagram
    participant Staff as スタッフアプリ
    participant QR as QR コード
    participant Customer as 顧客アプリ
    participant SDK as SDK
    participant RPC as Soroban RPC
    participant BT as dicekey-beans-token

    Staff->>Staff: メニュー選択<br/>(e.g., ドリップコーヒー S = 30 Beans)
    Staff->>QR: QR 生成<br/>{ action: "use_beans", item, beans: 30,<br/>  timestamp, nonce, valid_until=120s }
    Customer->>QR: スキャン
    QR-->>Customer: ペイロード

    alt burn 方式 (直接)
        Customer->>SDK: buildBurnBeansTx(customer, 30)
        SDK->>RPC: sendTransaction
        RPC->>BT: burn(customer, 30)
        Note over BT: require_auth(customer)<br/>balance -= 30<br/>total_supply -= 30<br/>emit ("beans", "burn")
    end

    alt burn_from 方式 (委任)
        Note over Customer: 事前に approve(customer, store, amount)
        Customer->>SDK: buildBurnFromTx(store, customer, 30)
        SDK->>RPC: sendTransaction
        RPC->>BT: burn_from(store, customer, 30)
        Note over BT: require_auth(store)<br/>allowance -= 30<br/>balance -= 30<br/>total_supply -= 30
    end

    RPC-->>SDK: TransactionResult
    SDK-->>Customer: 完了
    Customer-->>Staff: 利用確認
    Staff->>Staff: "利用完了" 表示
```

---

## 5. 特典券受取フロー（店舗）

```mermaid
sequenceDiagram
    participant Staff as スタッフアプリ
    participant QR as QR コード
    participant Customer as 顧客アプリ
    participant SDK as SDK
    participant RPC as Soroban RPC
    participant BN as dicekey-benefits

    Staff->>QR: QR 生成<br/>{ action: "burn_benefit",<br/>  timestamp, nonce, valid_until=120s }
    Customer->>QR: スキャン
    QR-->>Customer: ペイロード
    Customer->>Customer: 使用する特典券を選択
    Customer->>SDK: buildBurnBenefitTx(customer, tokenId)
    SDK->>RPC: sendTransaction
    RPC->>BN: burn(customer, tokenId)

    Note over BN: require_auth(customer)<br/>有効期限チェック<br/>NFT 削除<br/>owner リスト更新<br/>カウント減少

    Note over BN: emit ("benefit", "burn")

    RPC-->>SDK: TransactionResult
    SDK-->>Customer: 完了
    Customer-->>Staff: 受取確認
    Staff->>Staff: "受取完了"<br/>"ドリンク無料券 -- 利用済み"
```

---

## 6. コントラクトデプロイ・初期化フロー

```mermaid
sequenceDiagram
    participant Admin as 管理者
    participant CLI as Stellar CLI
    participant Net as Stellar Testnet
    participant VS as visit-stamps
    participant BT as beans-token
    participant BN as benefits
    participant BG as badges
    participant RP as reward-policy

    Admin->>CLI: ./deploy-testnet.sh

    Note over CLI: stellar keys generate dicekey-admin<br/>Fund via friendbot<br/>stellar contract build (wasm32v1-none)

    CLI->>Net: deploy dicekey-visit-stamps.wasm
    Net-->>CLI: VS contract address
    CLI->>Net: deploy dicekey-beans-token.wasm
    Net-->>CLI: BT contract address
    CLI->>Net: deploy dicekey-benefits.wasm
    Net-->>CLI: BN contract address
    CLI->>Net: deploy dicekey-badges.wasm
    Net-->>CLI: BG contract address
    CLI->>Net: deploy dicekey-reward-policy.wasm
    Net-->>CLI: RP contract address

    Note over CLI: .env.testnet に 5 アドレス保存<br/>(HQ SA 系は空のまま)

    Admin->>CLI: node scripts/sa-setup-testnet.mjs<br/>(or just testnet wraps all above)

    Note over CLI: kit 経由<br/>(admin = HQ Smart Account C-address)

    CLI->>VS: initialize(admin=HQ-SA)
    CLI->>BT: initialize(admin=HQ-SA)
    CLI->>BN: initialize(admin=HQ-SA)
    CLI->>BG: initialize(admin=HQ-SA)
    CLI->>RP: initialize(admin=HQ-SA, VS, BN, BG)

    Note over CLI: クロスコントラクト接続<br/>(set_beans_contract / set_policy_contract、HQ passkey で署名)

    CLI->>VS: set_beans_contract(admin, BT)
    CLI->>VS: set_policy_contract(admin, RP)

    Note over CLI: 接続完了:<br/>VS → BT (auto-mint)<br/>VS → RP (evaluate)<br/>RP → BN (mint benefit)<br/>RP → BG (issue badge)
```

---

## 状態管理フロー

### フロントエンド状態管理

```mermaid
flowchart TD
    subgraph AuthContext [AuthContext (顧客)]
        A1[isLoggedIn: boolean]
        A2[publicKey: string | null]
        A3[displayName: string | null]
    end

    subgraph StaffAuthContext [StaffAuthContext (スタッフ)]
        S1[isLoggedIn: boolean]
        S2[venue: string | null]
        S3[venueName: string | null]
    end

    subgraph LocalStorage
        LS1["dicekey_auth → {publicKey, displayName}"]
        LS2["dicekey_staff_auth → {venue, venueName}"]
    end

    AuthContext <-->|hydrate / persist| LS1
    StaffAuthContext <-->|hydrate / persist| LS2

    subgraph Pages [ページ状態 (useState)]
        P1["IssueStampPage: state = idle|showing|done"]
        P2["RewardsPage: giftTarget, showDialog"]
        P3["UseBeansPage: selectedItem, qrState"]
    end
```

### オンチェーン状態管理

```mermaid
flowchart TD
    subgraph Instance ["Instance Storage (コントラクト単位)"]
        I1[Admin Address]
        I2[NextId Counter]
        I3[Initialized Flag]
        I4[Contract References]
    end

    subgraph Persistent ["Persistent Storage (ユーザー・資産単位)"]
        P1["Balance(Address) → i128"]
        P2["Allowance(Address, Address) → i128"]
        P3["Stamp(Address, u64) → VisitStamp"]
        P4["StampCount(Address) → u64"]
        P5["VenueCount(Address, String) → u64"]
        P6["Token(u64) → BenefitNft"]
        P7["OwnerTokens(Address) → Vec<u64>"]
        P8["Badge(Address, String) → Badge"]
        P9["BadgeKinds(Address) → Vec<String>"]
        P10["Claimed(Address, String) → bool"]
    end
```

---

## クロスコントラクト呼び出しグラフ

```mermaid
flowchart LR
    VS[visit-stamps<br/>SEP-50 SBT] -->|"mint(admin, to, 10)"| BT[beans-token<br/>SEP-41 FT]
    VS -->|"on_stamp_issued(admin, user)"| RP[reward-policy<br/>Engine]
    RP -->|"stamp_count(user)"| VS
    RP -->|"mint(admin, user, kind, expires)"| BN[benefits<br/>SEP-50 NFT]
    RP -->|"issue(admin, user, kind)"| BG[badges<br/>SEP-50 SBT]

    style VS fill:#e8c597,stroke:#a8632d,color:#2b1a0e
    style BT fill:#f4dfba,stroke:#a8632d,color:#2b1a0e
    style RP fill:#ebe0cc,stroke:#5c4530,color:#2b1a0e
    style BN fill:#f4dfba,stroke:#a8632d,color:#2b1a0e
    style BG fill:#f4dfba,stroke:#a8632d,color:#2b1a0e
```

---

## イベント発行マップ

```mermaid
flowchart TD
    subgraph Events ["Soroban Events (Stellar Ledger)"]
        E1["('stamp', 'issued') → (to, id, timestamp)"]
        E2["('beans', 'mint') → (to, amount)"]
        E3["('beans', 'xfer') → (from, to, amount)"]
        E4["('beans', 'burn') → (from, amount)"]
        E5["('beans', 'approve') → (from, spender, amount)"]
        E6["('benefit', 'mint') → (to, id)"]
        E7["('benefit', 'xfer') → (from, to, id)"]
        E8["('benefit', 'burn') → (owner, id)"]
        E9["('badge', 'issued') → (to, kind, id)"]
        E10["('policy', 'reward') → (user, policy_id)"]
    end
```

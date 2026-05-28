# dicekey Coffee Stamps 要件定義書（逆生成）

## 分析概要

| 項目 | 値 |
|---|---|
| **分析日時** | 2026-05-19 |
| **対象コードベース** | StampSample (Stellar/Soroban dApp) |
| **抽出要件数** | 機能要件 42 個、非機能要件 12 個 |
| **信頼度** | 92% （設計書 + 実装 + テスト三点一致に基づく） |
| **根拠ソース** | docs/v0.1.md, contracts/ (5), apps/ (2), e2e/ (25), cargo test (46) |

## システム概要

### システム目的

dicekey Coffee（架空の多店舗コーヒーチェーン）の顧客ロイヤリティプログラムをブロックチェーン上で実現する。来店スタンプ、リワードトークン（Beans）、特典券（Benefit NFT）、称号バッジ（Badge SBT）の 4 種のデジタル資産を Stellar/Soroban スマートコントラクトで管理し、顧客は非カストディアル（自己主権型）で全資産を保有する。

### 対象ユーザー

| ユーザー種別 | 説明 | 実装根拠 |
|---|---|---|
| **顧客（Customer）** | コーヒー店利用者。スタンプ収集、Beans 獲得・利用、特典券の受取・譲渡を行う | `apps/customer-app/` (5 画面) |
| **店舗スタッフ（Staff）** | 各店舗のスタッフ。スタンプ発行、Beans 利用処理、特典券受取を行う | `apps/staff-app/` (5 画面) |
| **管理者（Admin）** | コントラクト初期化・運用。単一 Stellar アドレスが全コントラクトの admin | `shared::require_admin()` |

### 店舗（Venue）

| Venue ID | 店舗名 | 実装根拠 |
|---|---|---|
| `shibuya` | dicekey Shibuya | `StaffLoginPage.tsx`, テストデータ |
| `shinjuku` | dicekey Shinjuku | `StaffLoginPage.tsx`, テストデータ |
| `kyoto` | dicekey Kyoto | `StaffLoginPage.tsx` |

---

## 機能要件（EARS 記法）

### 1. 来店スタンプ（Visit Stamps）

#### REQ-VS-001: スタンプ発行 [通常要件]

システムは、管理者の操作により、顧客に対して来店スタンプ（SEP-50 Soulbound NFT）を 1 枚発行しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:80-166` — `issue()` 関数
- `e2e/staff-app.spec.ts` — QR 生成 → スキャン確認 → "+1 スタンプ" フロー
- `test_issue_and_count` — 基本発行テスト

#### REQ-VS-002: 自動 Beans 付与 [条件付き要件]

スタンプが発行された場合（WHEN）、システムは顧客に 10 Beans を自動的にミントしなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:9` — `BEANS_PER_VISIT: i128 = 10`
- `contracts/dicekey-visit-stamps/src/lib.rs:136-146` — `beans::mint(admin, to, 10)` クロスコントラクト呼び出し
- `test_auto_mint_beans_on_issue` — 自動ミントテスト

#### REQ-VS-003: 自動ポリシー評価 [条件付き要件]

スタンプが発行された場合（WHEN）、システムは報酬ポリシーエンジンを呼び出して適格な報酬を評価しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:153-163` — `policy::on_stamp_issued(admin, to)` 呼び出し
- ポリシー評価の失敗はスタンプ発行をブロックしない（try-catch パターン）

#### REQ-VS-004: 譲渡不可（Soulbound） [制約要件]

システムは、スタンプの他ユーザーへの譲渡を禁止しなければならない（MUST）。

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:199-201` — `transfer()` は panic で拒否
- `test_transfer_blocked` — 譲渡拒否テスト

#### REQ-VS-005: 店舗別カウント [通常要件]

システムは、顧客ごと・店舗（Venue）ごとのスタンプ数を個別にカウントしなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:211-216` — `venue_count(owner, venue)`
- `StampKey::VenueCount(Address, String)` — 店舗別カウントストレージ
- `test_multiple_venues` — 複数店舗テスト

#### REQ-VS-006: ページネーション対応 [通常要件]

システムは、スタンプ一覧をオフセット・リミット指定で取得可能でなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:228-244` — `list_stamps(owner, offset, limit)`
- `test_list_stamps_pagination` — ページネーションテスト

#### REQ-VS-007: メタデータ付与 [通常要件]

各スタンプは、名前・説明・画像 URI・追加 URI のメタデータを保持しなければならない（SHALL）。

**実装根拠:**
- `contracts/shared/src/lib.rs:6-13` — `TokenMeta { name, description, image_uri, extra_uri }`
- `contracts/dicekey-visit-stamps/src/lib.rs:181-188` — `token_uri()` でメタデータ URI を返却

#### REQ-VS-008: イベント発行 [通常要件]

スタンプ発行時、システムは `("stamp", "issued")` イベントを発行しなければならない（SHALL）。データには `(to, id, timestamp)` を含む。

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:149-150` — イベント発行
- `test_stamp_issued_event` — イベントテスト

---

### 2. リワードトークン（dicekey Beans）

#### REQ-BT-001: SEP-41 準拠 [制約要件]

Beans トークンは SEP-41 Fungible Token 標準に準拠しなければならない（MUST）。

**実装根拠:**
- `name()` → "dicekey Beans", `symbol()` → "BEANS", `decimals()` → 0
- `balance()`, `total_supply()`, `transfer()`, `approve()`, `allowance()`, `transfer_from()` 実装
- `test_name_symbol_decimals` — メタデータテスト

#### REQ-BT-002: 管理者ミント [通常要件]

システムは、管理者の操作により任意のアドレスに Beans をミントできなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-beans-token/src/lib.rs:133-148` — `mint(admin, to, amount)`
- `test_mint_and_balance` — ミントテスト

#### REQ-BT-003: ユーザー間送金 [通常要件]

システムは、送信元ユーザーの認証により Beans を他ユーザーに送金できなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-beans-token/src/lib.rs:64-75` — `transfer(from, to, amount)`
- `test_transfer` — 送金テスト

#### REQ-BT-004: 残高不足チェック [条件付き要件]

送金額が残高を超える場合（WHEN）、システムは操作を拒否しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-beans-token/src/lib.rs:202` — `assert!(balance >= amount)`
- `test_transfer_insufficient` — 残高不足テスト

#### REQ-BT-005: Allowance（委任送金） [通常要件]

システムは、approve / transfer_from による委任送金パターンをサポートしなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-beans-token/src/lib.rs:80-128` — `approve()`, `transfer_from()`
- `test_allowance_and_transfer_from` — 委任送金テスト
- `test_transfer_from_over_allowance` — 超過拒否テスト

#### REQ-BT-006: バーン（消費） [通常要件]

システムは、ユーザーが自身の Beans をバーンできなければならない（SHALL）。バーン時は総供給量を減少させる。

**実装根拠:**
- `contracts/dicekey-beans-token/src/lib.rs:151-192` — `burn()`, `burn_from()`
- `test_burn` — バーンテスト

#### REQ-BT-007: 小数点なし [制約要件]

Beans トークンは整数単位（decimals = 0）でなければならない（MUST）。

**実装根拠:**
- `contracts/dicekey-beans-token/src/lib.rs:43-45` — `decimals() → 0`

#### REQ-BT-008: イベント発行 [通常要件]

ミント・送金・バーン・承認の各操作時、システムは対応するイベントを発行しなければならない（SHALL）。

**実装根拠:**
- `("beans", "mint")`, `("beans", "xfer")`, `("beans", "burn")`, `("beans", "approve")` — 4 種のイベント
- `test_events_emitted` — イベントテスト

---

### 3. 特典券（Benefits）

#### REQ-BN-001: 特典券ミント [通常要件]

システムは、管理者の操作により顧客に特典券 NFT（SEP-50）を発行できなければならない（SHALL）。種別（kind）と有効期限（expires_at）を指定する。

**実装根拠:**
- `contracts/dicekey-benefits/src/lib.rs:63-118` — `mint(admin, to, kind, expires_at)`
- `test_mint` — ミントテスト

#### REQ-BN-002: 特典券の譲渡（ギフト） [通常要件]

顧客は、自分が保有する特典券を他の顧客に譲渡（ギフト）できなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-benefits/src/lib.rs:123-170` — `transfer(from, to, token_id)`
- `test_transfer_gift` — ギフトテスト
- `apps/customer-app/src/pages/RewardsPage.tsx` — ギフトダイアログ UI

#### REQ-BN-003: 特典券の利用（バーン） [通常要件]

顧客は、店舗で特典券を利用（バーン）できなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-benefits/src/lib.rs:175-210` — `burn(owner, token_id)`
- `test_burn` — バーンテスト
- `apps/staff-app/src/pages/ReceiveBenefitPage.tsx` — 特典券受取フロー

#### REQ-BN-004: 有効期限チェック [条件付き要件]

特典券が有効期限切れの場合（WHEN）、システムは譲渡およびバーンを拒否しなければならない（SHALL）。expires_at = 0 は無期限を意味する。

**実装根拠:**
- `contracts/dicekey-benefits/src/lib.rs:135-137, 186-189` — 有効期限バリデーション
- `assert!(nft.expires_at == 0 || nft.expires_at > env.ledger().timestamp())`

#### REQ-BN-005: 所有者以外の譲渡拒否 [制約要件]

特典券の所有者以外がその特典券を譲渡しようとした場合（WHEN）、システムは操作を拒否しなければならない（MUST）。

**実装根拠:**
- `contracts/dicekey-benefits/src/lib.rs:124, 131` — `from.require_auth()` + 所有者チェック
- `test_transfer_not_owner` — 非所有者拒否テスト

#### REQ-BN-006: 所有トークン一覧 [通常要件]

システムは、顧客が保有する特典券 ID のリストを返却できなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-benefits/src/lib.rs:226-231` — `list_tokens(owner)`
- `test_list_tokens` — 一覧テスト

---

### 4. 称号バッジ（Badges）

#### REQ-BG-001: バッジ発行 [通常要件]

システムは、管理者の操作により顧客に称号バッジ（SEP-50 Soulbound NFT）を発行できなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-badges/src/lib.rs:69-131` — `issue(admin, to, kind)`
- `test_issue_badge` — 発行テスト

#### REQ-BG-002: 譲渡不可（Soulbound） [制約要件]

システムは、バッジの他ユーザーへの譲渡を禁止しなければならない（MUST）。

**実装根拠:**
- `contracts/dicekey-badges/src/lib.rs:61-63` — `transfer()` は panic で拒否
- `test_transfer_blocked` — 譲渡拒否テスト

#### REQ-BG-003: 同一種別の重複発行禁止 [制約要件]

同一顧客に同一種別（kind）のバッジが既に発行されている場合（WHEN）、システムは発行を拒否しなければならない（MUST）。

**実装根拠:**
- `contracts/dicekey-badges/src/lib.rs:72-76` — `assert!(!env.storage().persistent().has(&key))`
- `test_no_duplicate_badge` — 重複拒否テスト

#### REQ-BG-004: 複数種別の保有 [通常要件]

顧客は複数の異なる種別のバッジを同時に保有できなければならない（SHALL）。

**実装根拠:**
- `test_multiple_badges` — 3 種のバッジ同時保有テスト

#### REQ-BG-005: バッジ種別一覧 [通常要件]

システムは、顧客が保有するバッジの種別リストを返却できなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-badges/src/lib.rs:153-158` — `list_badges(owner)`

---

### 5. 報酬ポリシー（Reward Policy）

#### REQ-RP-001: 10 回来店ボーナス [条件付き要件]

顧客のスタンプ数が 10 以上に達した場合（WHEN）、システムは「ドリンク無料券」（free_drink_voucher）の特典券を 1 枚発行しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:96-117` — `POLICY_10VISIT = "10visit_bonus"`
- `test_10visit_bonus` — 10 回ボーナステスト

#### REQ-RP-002: 100 回来店マスター [条件付き要件]

顧客のスタンプ数が 100 以上に達した場合（WHEN）、システムは「Coffee Master」バッジを発行しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:121-140` — `POLICY_100VISIT = "100visit_master"`
- `test_100visit_master` — 100 回マスターテスト

#### REQ-RP-003: 朝活マスター [条件付き要件]

管理者が朝（6-10 時）の来店回数 20 回以上を確認した場合（WHEN）、システムは「Morning Master」バッジを発行しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:159-186` — `check_morning_policy()`
- `test_morning_policy` — 朝活ポリシーテスト
- 時間帯の検証はオフチェーン（フロントエンド）で実施

#### REQ-RP-004: 春キャンペーン [条件付き要件]

管理者が春期間（3/1〜5/31）の来店回数 5 回以上を確認した場合（WHEN）、システムは「Spring 2026」バッジを発行しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:190-217` — `check_spring_policy()`
- `test_spring_policy` — 春キャンペーンテスト
- `test_spring_policy_below_threshold` — 閾値未達テスト

#### REQ-RP-005: 二重報酬の防止 [制約要件]

同一ポリシーに対して同一顧客に二重に報酬を付与してはならない（MUST NOT）。

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:222-226` — `is_claimed(user, policy_id)`
- `PolicyKey::Claimed(Address, String)` — クレーム追跡ストレージ
- `test_10visit_bonus_not_double_claim` — 二重防止テスト
- リエントランシー対策: ミント前にクレーム済みマーク（line 98-99）

#### REQ-RP-006: 報酬イベント発行 [通常要件]

報酬が付与された場合、システムは `("policy", "reward")` イベントを発行しなければならない（SHALL）。

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:113-116` — イベント発行
- `test_events_emitted` — イベントテスト

---

### 6. 認証・アカウント管理

#### REQ-AU-001: Passkey（WebAuthn）認証 [通常要件]

顧客アプリは、WebAuthn Passkey によるユーザー認証をサポートしなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/lib/passkey.ts` — `registerPasskey()`, `authenticatePasskey()`
- Platform authenticator, ES256 (P-256), Resident key required

#### REQ-AU-002: デモモード [オプション要件]

システムは、開発・テスト用のデモモードログインを提供してもよい（MAY）。

**実装根拠:**
- `apps/customer-app/src/contexts/AuthContext.tsx` — `loginDemo()` 関数
- `e2e/customer-app.spec.ts` — デモモードでのテスト実行

#### REQ-AU-003: Smart Account 対応 [通常要件]

本番環境では、Passkey から Stellar キーペアを導出し、Smart Account を作成しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/contexts/AuthContext.tsx` — コメントに "Phase 2: Smart Account Kit" 記載
- 現在は Phase 1（ランダムキーペア生成）

#### REQ-AU-004: 店舗スタッフ認証 [通常要件]

スタッフアプリは、店舗（Venue）を選択してログインできなければならない（SHALL）。

**実装根拠:**
- `apps/staff-app/src/pages/StaffLoginPage.tsx` — 店舗ドロップダウン
- `apps/staff-app/src/contexts/StaffAuthContext.tsx` — `login(venue, venueName)`

#### REQ-AU-005: セッション管理 [通常要件]

認証状態は LocalStorage に永続化し、アプリ再読み込み時に復元しなければならない（SHALL）。

**実装根拠:**
- `AuthContext.tsx` — LocalStorage key: `dicekey_auth`
- `StaffAuthContext.tsx` — LocalStorage key: `dicekey_staff_auth`

#### REQ-AU-006: ログアウト [通常要件]

ユーザーはログアウト操作によりセッションを破棄できなければならない（SHALL）。

**実装根拠:**
- `e2e/customer-app.spec.ts` — ログアウト→ログイン画面遷移テスト
- `e2e/staff-app.spec.ts` — ログアウトテスト

---

### 7. 顧客アプリ（Customer App）

#### REQ-CA-001: ホーム画面 [通常要件]

ホーム画面は、スタンプ数・Beans 残高・特典券数・バッジ数のサマリーと、最近のアクティビティを表示しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/pages/HomePage.tsx` — ヒーロー統計カード + アクティビティタイムライン
- `e2e/customer-app.spec.ts` — サマリーカード表示テスト

#### REQ-CA-002: スタンプ画面 [通常要件]

スタンプ画面は、収集済みスタンプのグリッド表示と、獲得済み/未獲得バッジの一覧を表示しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/pages/StampsPage.tsx` — 5x10 グリッド + バッジカルーセル
- `e2e/customer-app.spec.ts` — グリッド・バッジ表示テスト

#### REQ-CA-003: リワード画面 [通常要件]

リワード画面は、Beans 残高、特典券リスト、ギフト送信機能を提供しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/pages/RewardsPage.tsx` — Beans 残高 + 特典券リスト + ギフトダイアログ
- `e2e/customer-app.spec.ts` — ギフトフローテスト

#### REQ-CA-004: ギフトダイアログ [通常要件]

顧客は、特典券を選択して宛先を入力し、他の顧客にギフトとして送信できなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/pages/RewardsPage.tsx` — ギフトモーダル（宛先入力 + 送信ボタン）
- `e2e/customer-app.spec.ts` — "Sent" 確認フィードバックテスト

#### REQ-CA-005: 設定画面 [通常要件]

設定画面は、アカウント情報・Passkey 管理・通知設定・ネットワーク情報を表示しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/pages/SettingsPage.tsx` — アカウント・Passkey・通知トグル・ネットワーク情報

#### REQ-CA-006: タブナビゲーション [通常要件]

顧客アプリは、ホーム・スタンプ・リワード・設定の 4 タブによるボトムナビゲーションを提供しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/App.tsx` — ボトムナビゲーション
- `e2e/customer-app.spec.ts` — ナビゲーション遷移テスト

#### REQ-CA-007: マイルストーン進捗表示 [通常要件]

ホーム画面は、次の報酬マイルストーンまでの進捗を表示しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/src/pages/HomePage.tsx` — "FiftyClub まで X 回" プログレスバー
- `e2e/customer-app.spec.ts` — "フィフティクラブまで 8 回" テスト

---

### 8. スタッフアプリ（Staff App）

#### REQ-SA-001: ダッシュボード [通常要件]

ダッシュボードは、本日の統計（発行スタンプ数・利用特典数・配布 Beans 数・新規会員数）、時間帯別グラフ、ライブアクティビティフィードを表示しなければならない（SHALL）。

**実装根拠:**
- `apps/staff-app/src/pages/DashboardPage.tsx` — 3 カラムレイアウト（統計 + アクション + フィード）
- `e2e/staff-app.spec.ts` — "本日の集計" 表示テスト

#### REQ-SA-002: スタンプ発行フロー [通常要件]

スタッフは、QR コードを生成して顧客にスキャンさせ、スタンプを発行できなければならない（SHALL）。QR は 60 秒の有効期限を持つ。

**実装根拠:**
- `apps/staff-app/src/pages/IssueStampPage.tsx` — 3 ステート（idle → showing → done）
- QR ペイロード: `{ action: "issue_stamp", venue, timestamp, nonce, valid_until }`
- `e2e/staff-app.spec.ts` — QR 生成 → 確認 → "+1 スタンプ" テスト

#### REQ-SA-003: Beans 利用フロー [通常要件]

スタッフは、メニューを選択し QR コードを生成して、顧客の Beans を利用できなければならない（SHALL）。QR は 120 秒の有効期限を持つ。

**実装根拠:**
- `apps/staff-app/src/pages/UseBeansPage.tsx` — メニュー選択（6 品目: 30-55 Beans）→ QR 生成
- `e2e/staff-app.spec.ts` — ドリンク選択 → QR → "利用完了" テスト

#### REQ-SA-004: 特典券受取フロー [通常要件]

スタッフは、QR コードを生成して顧客の特典券を受取（利用処理）できなければならない（SHALL）。QR は 120 秒の有効期限を持つ。

**実装根拠:**
- `apps/staff-app/src/pages/ReceiveBenefitPage.tsx` — QR 生成 → 受取確認
- `e2e/staff-app.spec.ts` — QR → "受取完了" テスト

#### REQ-SA-005: キャンペーン表示 [通常要件]

ダッシュボードは、実施中のキャンペーン情報（残り日数を含む）を表示しなければならない（SHALL）。

**実装根拠:**
- `apps/staff-app/src/pages/DashboardPage.tsx` — "Cherry Blossom 2026" カード（残り 13 日）

---

### 9. コントラクト管理

#### REQ-CM-001: 初期化ガード [制約要件]

全コントラクトは、`initialize()` の二重呼び出しを拒否しなければならない（MUST）。

**実装根拠:**
- 全 5 コントラクトに `Initialized` フラグ + `assert!(!already_initialized)` パターン
- 各 `test_double_init` テスト

#### REQ-CM-002: 管理者認証 [制約要件]

管理者専用操作は、呼び出し元が admin アドレスであることを検証し、`require_auth()` を要求しなければならない（MUST）。

**実装根拠:**
- `contracts/shared/src/lib.rs:53-59` — `require_admin()` 共通関数
- 15 以上の関数で使用

#### REQ-CM-003: クロスコントラクト接続設定 [通常要件]

visit-stamps コントラクトは、beans-token および reward-policy コントラクトのアドレスを管理者が設定できなければならない（SHALL）。

**実装根拠:**
- `set_beans_contract()`, `set_policy_contract()` — 管理者専用設定関数
- `scripts/sa-setup{,-testnet}.mjs` — デプロイ後 kit 経由で HQ Smart Account から initialize + 接続設定（旧 `initialize-contracts.sh` を内包）

#### REQ-CM-004: Testnet デプロイ [通常要件]

システムは、Stellar Testnet へのワンコマンドデプロイをサポートしなければならない（SHALL）。

**実装根拠:**
- `scripts/deploy-testnet.sh` — 5 コントラクト一括デプロイ + `.env.testnet` 生成
- `scripts/sa-setup-testnet.mjs` — HQ Smart Account 経由で initialize + 接続設定
- `just testnet` — 上記をワンショットで連結

---

## 非機能要件

### パフォーマンス

#### NFR-001: コントラクトバイナリサイズ最適化

リリースビルドは、WASM バイナリサイズを最小化するよう最適化しなければならない（SHALL）。

**実装根拠:**
- `Cargo.toml` — `opt-level = "z"`, `lto = true`, `strip = "symbols"`, `codegen-units = 1`, `panic = "abort"`

#### NFR-002: モバイルファーストレスポンシブ

顧客アプリはモバイルビューポート（390x844）をプライマリとしてデザインしなければならない（SHALL）。

**実装根拠:**
- `playwright.config.ts` — デフォルトビューポート 390x844
- CSS メディアクエリ、フレキシブルレイアウト

#### NFR-003: タブレット対応（スタッフアプリ）

スタッフアプリは、タブレットサイズ（1100x800）での 3 カラムレイアウトをサポートしなければならない（SHALL）。

**実装根拠:**
- `e2e/staff-app.spec.ts` — ビューポート 1100x800
- `DashboardPage.tsx` — 3 カラム（280px + flex + 300px）

### セキュリティ

#### NFR-004: 非カストディアル資産管理

全デジタル資産は顧客自身の Stellar アドレスに帰属し、システムが代理保管してはならない（MUST NOT）。

**実装根拠:**
- 各コントラクトの所有者アドレスベースストレージ
- Smart Account（Passkey 由来）による自己主権型管理

#### NFR-005: リエントランシー対策

ポリシーエンジンは、クロスコントラクト呼び出し前にクレーム状態を更新してリエントランシー攻撃を防止しなければならない（MUST）。

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:98-99` — "Mark claimed FIRST to prevent reentrancy"

#### NFR-006: Passkey セキュリティ

WebAuthn 認証は、Platform authenticator、Resident key required、User verification required を使用しなければならない（MUST）。

**実装根拠:**
- `apps/customer-app/src/lib/passkey.ts` — ES256 (P-256), `residentKey: "required"`, `userVerification: "required"`

### ユーザビリティ

#### NFR-007: 日本語 UI

アプリケーションの UI は日本語を基本言語としなければならない（SHALL）。

**実装根拠:**
- 全ページの UI ラベル（"ホーム", "スタンプ", "リワード", "設定" 等）
- E2E テストの日本語テキスト検証

#### NFR-008: デザインシステム

共有 UI コンポーネントパッケージ（ui-components）により、一貫したビジュアルデザインを維持しなければならない（SHALL）。

**実装根拠:**
- `packages/ui-components/src/tokens.css` — デザイントークン（色、タイポグラフィ、シャドウ）
- `packages/ui-components/src/Icons.tsx` — 25+ 共有アイコン
- カラーパレット: warm paper (#f5ede0), copper accent (#a8632d), dark ink (#2b1a0e)

### 運用性

#### NFR-009: Stellar イベント追跡

全コントラクトは、主要操作に対してイベントを発行し、オフチェーンでの追跡を可能にしなければならない（SHALL）。

**実装根拠:**
- 10 種のイベント（beans: 4, stamp: 1, benefit: 3, badge: 1, policy: 1）

#### NFR-010: PWA マニフェスト

顧客アプリは PWA としてインストール可能な manifest.json を提供しなければならない（SHALL）。

**実装根拠:**
- `apps/customer-app/public/manifest.json` — `display: "standalone"`
- 現在は基本マニフェストのみ（Service Worker 未実装）

### テスト品質

#### NFR-011: コントラクトテストカバレッジ

全コントラクトは、正常系・異常系・境界値を含む cargo test を持たなければならない（SHALL）。

**実装根拠:**
- 46 ユニットテスト（beans: 12, stamps: 11, benefits: 10, badges: 10, policy: 11）
- 正常系 + パニックテスト + イベント検証 + クロスコントラクトテスト

#### NFR-012: E2E テストカバレッジ

全ユーザーフローは Playwright E2E テストでカバーしなければならない（SHALL）。

**実装根拠:**
- 25 E2E テスト（customer: 16, staff: 9）
- 認証、ページ遷移、ビジネスフロー、セッション管理をカバー

---

## Edge ケース

### エラー処理

| ID | ケース | 実装 | 根拠 |
|---|---|---|---|
| EDGE-001 | 残高不足での Beans 送金 | panic("insufficient balance") | `test_transfer_insufficient` |
| EDGE-002 | Allowance 超過の transfer_from | panic("insufficient allowance") | `test_transfer_from_over_allowance` |
| EDGE-003 | Soulbound トークンの譲渡試行 | panic (stamps, badges) | `test_transfer_blocked` |
| EDGE-004 | コントラクトの二重初期化 | panic("already initialized") | 各 `test_double_init` |
| EDGE-005 | 同一バッジの重複発行 | panic("badge already awarded") | `test_no_duplicate_badge` |
| EDGE-006 | ポリシー報酬の二重クレーム | is_claimed() で判定、スキップ | `test_10visit_bonus_not_double_claim` |
| EDGE-007 | 有効期限切れ特典券の使用 | panic("benefit expired") | 有効期限バリデーション |
| EDGE-008 | 非所有者による特典券譲渡 | panic + require_auth() | `test_transfer_not_owner` |

### 境界値

| ID | ケース | 対応 | 根拠 |
|---|---|---|---|
| EDGE-101 | スタンプ数 = 9（報酬閾値未満） | 報酬なし（0 返却） | `test_no_reward_below_threshold` |
| EDGE-102 | スタンプ数 = 10（報酬閾値ちょうど） | 10visit_bonus 発動 | `test_10visit_bonus` |
| EDGE-103 | スタンプ数 = 100（複数ポリシー発動） | 2 報酬同時付与 | `test_100visit_master` |
| EDGE-104 | 春来店数 = 4（閾値未満） | バッジ発行なし | `test_spring_policy_below_threshold` |
| EDGE-105 | Beans amount = 0 での送金 | panic（amount > 0 制約） | バリデーション |
| EDGE-106 | expires_at = 0（無期限特典券） | 有効期限チェックをスキップ | 条件分岐 |

---

## 推定されていない要件

### ステークホルダー確認が必要な項目

1. **ビジネス要件**
   - Beans の有効期限（設計書では "最終獲得から 1 年" だが、コントラクト未実装）
   - 特典券の具体的な種別一覧（"free_drink_voucher" 以外の定義）
   - 店舗の追加・削除の運用フロー

2. **運用要件**
   - コントラクトのアップグレード方針
   - Admin キーの管理・ローテーション方針
   - 障害時のリカバリー手順

3. **法的・コンプライアンス要件**
   - ポイントプログラムに関する法規制対応（資金決済法等）
   - 個人情報の取り扱い方針
   - 特典券の景品表示法対応

4. **未実装の設計書記載機能**
   - Service Worker によるオフライン対応
   - Push 通知
   - PWA アプリアイコン
   - Smart Account Kit 統合（Phase 2）

---

## 分析の制約事項

### 信頼度に影響する要因

| 要因 | 影響 | 評価 |
|---|---|---|
| 設計書（docs/v0.1.md）との一致 | 高い一致度 — 設計 → 実装の整合性良好 | **強い根拠** |
| テストカバレッジ | 46 cargo test + 25 E2E — 主要パス網羅 | **強い根拠** |
| コントラクト実装の完成度 | 5 コントラクト全て動作可能 | **強い根拠** |
| フロントエンド実装の完成度 | UI モック段階、実 SDK 接続は一部 | **中程度の根拠** |
| 運用・インフラ面 | デプロイスクリプトのみ、監視なし | **弱い根拠** |

### 推定の根拠レベル

- **強い根拠（★★★）**: 設計書 + 実装 + テストが三点一致（コントラクト関連要件）
- **中程度の根拠（★★☆）**: 実装 + テストあり、設計書に詳細なし（UI 関連要件）
- **弱い根拠（★☆☆）**: 実装のみ、テストなし（設定画面の一部機能）

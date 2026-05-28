# dicekey Coffee Stamps ユーザーストーリー（逆生成）

## 分析概要

| 項目 | 値 |
|---|---|
| **分析日時** | 2026-05-19 |
| **抽出ストーリー数** | 18 |
| **ユーザー種別** | 顧客（Customer）、店舗スタッフ（Staff）、管理者（Admin） |

---

## 顧客（Customer）ストーリー

### US-C01: 来店スタンプの獲得

- **である** コーヒー店の顧客 **として**
- **私は** 来店時にデジタルスタンプを受け取り **たい**
- **そうすることで** 来店回数を記録し、リワードに近づける

**実装根拠:**
- `apps/staff-app/src/pages/IssueStampPage.tsx` — QR スキャンフロー
- `contracts/dicekey-visit-stamps/src/lib.rs:80-166` — `issue()` 関数
- `e2e/staff-app.spec.ts` — "+1 スタンプ" 確認テスト

**受け入れ条件:**
- スタッフが QR を提示し、顧客がスキャンするとスタンプが記録される
- スタンプと同時に 10 Beans が自動付与される
- スタンプは他人に譲渡できない（Soulbound）

---

### US-C02: Beans の自動獲得

- **である** スタンプを受け取った顧客 **として**
- **私は** 来店ごとに自動でリワードポイント（Beans）を受け取り **たい**
- **そうすることで** 意識せずにポイントが貯まり、後で利用できる

**実装根拠:**
- `contracts/dicekey-visit-stamps/src/lib.rs:9` — `BEANS_PER_VISIT = 10`
- `contracts/dicekey-visit-stamps/src/lib.rs:136-146` — 自動ミントのクロスコントラクト呼び出し

**受け入れ条件:**
- スタンプ発行と同時に 10 Beans が顧客のアカウントにミントされる
- 顧客側の操作は不要

---

### US-C03: スタンプコレクションの閲覧

- **である** コーヒー店の常連客 **として**
- **私は** 収集したスタンプをグリッド形式で一覧確認し **たい**
- **そうすることで** コレクションの達成感を得られ、マイルストーンまでの進捗がわかる

**実装根拠:**
- `apps/customer-app/src/pages/StampsPage.tsx` — 5x10 スタンプグリッド
- `apps/customer-app/src/pages/HomePage.tsx` — マイルストーン進捗バー
- `e2e/customer-app.spec.ts` — グリッド表示テスト

**受け入れ条件:**
- 収集済みスタンプ数と目標数が表示される
- マイルストーン（10, 50, 100）の位置がハイライトされる
- "フィフティクラブまで X 回" のような進捗メッセージが表示される

---

### US-C04: 報酬の自動獲得

- **である** 10 回来店した顧客 **として**
- **私は** 自動的に「ドリンク無料券」を受け取り **たい**
- **そうすることで** 手動申請なしでリワードが得られ、モチベーションが維持される

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:96-117` — 10visit_bonus ポリシー
- `contracts/dicekey-benefits/src/lib.rs:63-118` — 特典券ミント

**受け入れ条件:**
- 10 回目のスタンプ発行時に自動で free_drink_voucher が発行される
- 同じ報酬は 1 人 1 回のみ
- リワード画面に特典券として表示される

---

### US-C05: 称号バッジの獲得

- **である** 100 回来店した熱心な顧客 **として**
- **私は** 「Coffee Master」の称号バッジを獲得し **たい**
- **そうすることで** 自分のロイヤリティが認められ、コミュニティ内でのステータスを示せる

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:121-140` — 100visit_master ポリシー
- `contracts/dicekey-badges/src/lib.rs:69-131` — バッジ発行
- `apps/customer-app/src/pages/StampsPage.tsx` — バッジ表示セクション

**受け入れ条件:**
- 100 回目のスタンプ発行時に Coffee Master バッジが自動発行される
- バッジは譲渡不可（Soulbound）
- スタンプ画面のバッジセクションに表示される

---

### US-C06: 特典券のギフト

- **である** 特典券を持つ顧客 **として**
- **私は** 特典券を友人にギフトとして送り **たい**
- **そうすることで** コーヒーの楽しみを友人と共有できる

**実装根拠:**
- `apps/customer-app/src/pages/RewardsPage.tsx` — ギフトダイアログ（宛先入力 + 送信）
- `contracts/dicekey-benefits/src/lib.rs:123-170` — `transfer()` 関数
- `e2e/customer-app.spec.ts` — ギフト送信 → "Sent" 確認テスト

**受け入れ条件:**
- リワード画面からギフト送信ダイアログを開ける
- 宛先アドレス/名前を入力して送信できる
- 送信完了の確認メッセージが表示される
- 有効期限切れの特典券はギフトできない

---

### US-C07: 特典券の利用

- **である** 特典券を持つ顧客 **として**
- **私は** 店舗で特典券を提示して利用し **たい**
- **そうすることで** 無料ドリンクなどの特典を受けられる

**実装根拠:**
- `apps/staff-app/src/pages/ReceiveBenefitPage.tsx` — 受取フロー
- `contracts/dicekey-benefits/src/lib.rs:175-210` — `burn()` 関数

**受け入れ条件:**
- スタッフが QR を提示し、顧客がスキャンして特典券を使用する
- 使用済みの特典券はバーン（削除）される
- 有効期限切れの特典券は利用できない

---

### US-C08: Beans での支払い

- **である** Beans を保有する顧客 **として**
- **私は** Beans でドリンクの支払いをし **たい**
- **そうすることで** 貯めたポイントを実際の商品と交換できる

**実装根拠:**
- `apps/staff-app/src/pages/UseBeansPage.tsx` — メニュー選択 + Beans 計算 + QR
- `contracts/dicekey-beans-token/src/lib.rs:151-166` — `burn()` / `burn_from()` 関数

**受け入れ条件:**
- メニュー品目ごとに Beans 価格が設定されている（30-55 Beans）
- スタッフがメニューを選択し QR を生成
- 顧客がスキャンして Beans が消費される

---

### US-C09: Passkey によるログイン

- **である** セキュリティを重視する顧客 **として**
- **私は** 生体認証（Passkey）でログインし **たい**
- **そうすることで** パスワードを覚える必要がなく、安全にアカウントにアクセスできる

**実装根拠:**
- `apps/customer-app/src/lib/passkey.ts` — `registerPasskey()`, `authenticatePasskey()`
- `apps/customer-app/src/pages/LoginPage.tsx` — Passkey 登録 UI

**受け入れ条件:**
- 初回は名前入力 + Passkey 登録でアカウント作成
- 以降は Passkey（生体認証/PIN）のみでログイン可能
- デモモードも利用可能

---

### US-C10: 季節キャンペーンバッジ

- **である** 春に頻繁に来店する顧客 **として**
- **私は** 季節限定の「桜の季節 2026」バッジを獲得し **たい**
- **そうすることで** 限定コレクションが楽しめ、来店の動機になる

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:190-217` — spring_campaign ポリシー
- `apps/customer-app/src/pages/StampsPage.tsx` — "桜の季節 2026" バッジ表示

**受け入れ条件:**
- 3/1〜5/31 の期間に 5 回以上来店すると Spring 2026 バッジが発行される
- 同じバッジは 1 人 1 枚のみ

---

### US-C11: 朝活マスターバッジ

- **である** 毎朝コーヒーを飲む顧客 **として**
- **私は** 「Morning Master」バッジを獲得し **たい**
- **そうすることで** 朝の習慣が認められ、達成感を得られる

**実装根拠:**
- `contracts/dicekey-reward-policy/src/lib.rs:159-186` — morning_lover ポリシー

**受け入れ条件:**
- 朝 6-10 時の来店が 20 回以上で Morning Master バッジが発行される
- 時間帯の検証はオフチェーン（フロントエンド）で実施

---

## 店舗スタッフ（Staff）ストーリー

### US-S01: スタンプ発行

- **である** 店舗スタッフ **として**
- **私は** 来店した顧客にワンタップでスタンプを発行し **たい**
- **そうすることで** レジ業務の流れを止めずにポイントを付与できる

**実装根拠:**
- `apps/staff-app/src/pages/IssueStampPage.tsx` — QR 生成ボタン → 60 秒タイマー → 確認
- `e2e/staff-app.spec.ts` — 発行フローテスト

**受け入れ条件:**
- 「QR を生成」ボタンで即座に QR コードが表示される
- QR は 60 秒で無効になる
- 発行完了時に "+1 スタンプ" の確認が表示される

---

### US-S02: Beans 利用処理

- **である** 店舗スタッフ **として**
- **私は** 顧客の Beans 支払いをスムーズに処理し **たい**
- **そうすることで** レジでの Beans 利用がストレスなく行える

**実装根拠:**
- `apps/staff-app/src/pages/UseBeansPage.tsx` — メニュー 6 品目、Beans 価格表示
- `e2e/staff-app.spec.ts` — ドリンク選択 → QR → "利用完了" テスト

**受け入れ条件:**
- メニューから品目を選択すると必要 Beans 数が表示される
- QR コードを生成して顧客にスキャンさせる
- 完了メッセージが表示される

---

### US-S03: 特典券受取処理

- **である** 店舗スタッフ **として**
- **私は** 顧客の特典券を受け取って利用処理し **たい**
- **そうすることで** 特典の適用を正確に記録できる

**実装根拠:**
- `apps/staff-app/src/pages/ReceiveBenefitPage.tsx` — QR 生成 → 受取確認
- `e2e/staff-app.spec.ts` — "受取完了" テスト

**受け入れ条件:**
- QR コードを生成して顧客にスキャンさせる
- 受取完了後に「ドリンク無料券 -- 利用済み」の確認が表示される

---

### US-S04: 本日の業務状況確認

- **である** 店舗スタッフ **として**
- **私は** 本日の発行スタンプ数・利用特典数・Beans 配布数を一目で確認し **たい**
- **そうすることで** 店舗の稼働状況を把握できる

**実装根拠:**
- `apps/staff-app/src/pages/DashboardPage.tsx` — 統計カード + 時間帯別グラフ + アクティビティフィード
- `e2e/staff-app.spec.ts` — "本日の集計" テスト

**受け入れ条件:**
- ダッシュボードに今日の統計が表示される（スタンプ数、特典数、Beans 数、新規会員数）
- 時間帯別の発行数グラフが表示される
- 直近のアクティビティがリアルタイムで表示される

---

### US-S05: 店舗選択ログイン

- **である** 複数店舗を持つチェーンのスタッフ **として**
- **私は** 自分が勤務する店舗を選択してログインし **たい**
- **そうすることで** 店舗ごとのスタンプ発行を正しく記録できる

**実装根拠:**
- `apps/staff-app/src/pages/StaffLoginPage.tsx` — 店舗ドロップダウン（3 店舗）
- `apps/staff-app/src/contexts/StaffAuthContext.tsx` — `login(venue, venueName)`

**受け入れ条件:**
- ログイン画面で店舗を選択できる（Shibuya, Shinjuku, Kyoto）
- 選択した店舗名がダッシュボードのヘッダーに表示される
- ログアウトすると店舗選択画面に戻る

---

## 管理者（Admin）ストーリー

### US-A01: コントラクトデプロイ・初期化

- **である** システム管理者 **として**
- **私は** 全コントラクトを Testnet にデプロイし、相互接続を設定し **たい**
- **そうすることで** システム全体が正しく連携して動作する

**実装根拠:**
- `scripts/deploy-testnet.sh` — 5 コントラクト一括デプロイ + `.env.testnet` 生成
- `scripts/sa-setup-testnet.mjs` — HQ Smart Account 経由で initialize + クロスコントラクト接続設定
- `just testnet` — 上記 + bindings 生成 + harness 起動 + 1 stamp 発行スモーク

**受け入れ条件:**
- ワンコマンド (`just testnet`) で 5 コントラクト全てがデプロイされる
- initialize → set_beans_contract → set_policy_contract の接続設定が完了する（admin = HQ Smart Account C-address）
- `.env.testnet` にコントラクトアドレスと HQ SA / staff rule id が出力される

---

### US-A02: デモデータ投入

- **である** デモやテストを行う管理者 **として**
- **私は** サンプルデータを一括投入し **たい**
- **そうすることで** 動作確認やプレゼンテーションがスムーズに行える

**実装根拠:**
- `scripts/sa-setup{,-testnet}.mjs` — デモ用 customer Smart Account 作成 + 来店スタンプ発行 (旧 `seed-demo.sh` を内包し、admin = HQ Smart Account 経由で実行)

**受け入れ条件:**
- サンプルの顧客・スタンプ・Beans が投入される（特典券・バッジは閾値到達まで自動）
- 各画面でデモデータが表示される

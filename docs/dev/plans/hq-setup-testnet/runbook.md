# Runbook: HQ ブートストラップ (Testnet, CF Pages 実機 passkey)

> Plan: [`docs/dev/plans/hq-setup-testnet/plan.md`](./plan.md)
> 想定所要時間: 30 分 (CF Pages 反映待ち含む)

CF Pages にデプロイされた `staff-app` (`https://dicekey-coffee-stamps.pages.dev/staff/`)
で **実機 passkey から sign-in できる** 状態を作る。HQ Smart Account の作成
UI (`sa-harness`) を **同じ origin の `/setup/` パスに同梱** し、そこで作った
HQ root passkey を `/staff/` がそのまま再利用する。

WebAuthn の rpId は credential 作成時に origin から固定される。`pages.dev`
は Public Suffix List 上 (CLAUDE.md にも記載) なので、別の subdomain や
localhost で作った passkey は CF Pages 公開 URL では絶対に再生されない。
案 D 寄りの「setup UI を本番 origin に同梱」だけが現実的な経路。setup UI は
`VITE_HQ_SMART_ACCOUNT` が空でない場合に自動でロックされるため、本番 URL
への露出リスクは初回ブートストラップ 1 回に閉じる。

`just testnet` (CDP 仮想 authenticator + 自動 smoke) との使い分けは
[README.md "Testnet path"](../../../README.md#testnet-path) を参照。

---

## 前提

- 同一マシン (同一ホスト OS、同一ブラウザ) で:
  - CF Pages 公開 URL (`https://dicekey-coffee-stamps.pages.dev/`) の
    `/setup/` と `/staff/` の両方で WebAuthn を実行する
- `bash scripts/build-kit.sh` + `pnpm install` 済 (clean clone の場合)
- `pnpm exec wrangler login` 済 (CF Pages へ deploy する権限)
- host OS の Chrome を使用 (Safari は WebAuthn の細部挙動が異なるため非推奨)

> **不可逆性の注意**: このフローを完走するたびに、Testnet 上に新しい HQ
> Smart Account と 5 dicekey contracts が作られます。古い HQ は孤児化します。
> 着手前に `.env.testnet` を `.env.testnet.bak.YYYYMMDD` として手動バックアップ
> しておくと、デモ用に元の HQ env へ巻き戻せます。
> `apps/{customer,staff}-app/.env.production` も同様にバックアップ推奨。

---

## Step 0: 事前 deploy + bindings (devcontainer 内)

```bash
just deploy-testnet      # 5 contracts を fresh deploy + .env.testnet 更新
                         # + tools/sa-harness/.env.{testnet,production} ミラー
                         # (IRREVERSIBLE — 5 秒 abort window あり)
just bindings-testnet    # TS bindings 再生成 + @dicekey/contracts build
```

`deploy-testnet.sh` は `.env.testnet` の `VITE_RP_ID=localhost` を、
`tools/sa-harness/.env.production` 側だけ
`VITE_RP_ID=dicekey-coffee-stamps.pages.dev` に書き換えます (`/setup/`
build 用)。localhost rpId は `just testnet` (CDP) フロー専用です。

---

## Step 1: CF Pages へ 1 回目デプロイ (setup UI を公開)

```bash
just pages    # build-pages.sh で customer / staff / setup(sa-harness) を統合 build
              # + wrangler pages deploy で production 反映
```

完了後、以下が同一 origin で公開されます:

- `https://dicekey-coffee-stamps.pages.dev/` (customer-app)
- `https://dicekey-coffee-stamps.pages.dev/staff/` (staff-app)
- `https://dicekey-coffee-stamps.pages.dev/setup/` (sa-harness HQ bootstrap UI)

> この時点では `.env.testnet` 上の `VITE_HQ_SMART_ACCOUNT` は空です。
> staff-app は HQ SA 未設定で警告を出しますが、Step 5 で再デプロイすれば
> 解消します。

---

## Step 2: `/setup/` で HQ Smart Account を作成

ホスト OS の Chrome で `https://dicekey-coffee-stamps.pages.dev/setup/` を開く。
UI 上部 `#net` パネルが `rpc https://soroban-testnet.stellar.org` /
`network Test SDF Network ; September 2015` /
`rpId dicekey-coffee-stamps.pages.dev` を表示することを確認 (= `.env.production`
が読まれている)。

警告 banner (`⚠️ HQ はすでに設定されています`) が **出ていない** ことも確認
してください。出ていたら `VITE_HQ_SMART_ACCOUNT` がすでに空でない値で
ビルドされている = 直前の `just deploy-testnet` を再度走らせて env を
クリアしてください。

### Step 1 — Create HQ Wallet (`#btnCreateHq`)

- フォーム: `アプリ表示名` = `dicekey HQ`、`ユーザー名` = `hq-admin`
- 期待挙動: 実機 Touch ID / Windows Hello prompt → 認証
- 結果: `#resultHq` に `contractId` (新 HQ SA の C-address) と
  `credentialId` (HQ root passkey の base64url) が表示される

> このとき作られた HQ root passkey は **作成 authenticator の secure enclave
> 内 + rpId=`dicekey-coffee-stamps.pages.dev`** で固定されます。別端末や
> 他ブラウザ、他 origin での sign-in は不可能です。`/staff/` も同一 origin
> なので同じ Chrome から認証可能です。

### Step 2 — Initialize + Wire (`#btnInitWire`)

- 操作: ボタンをクリック
- 期待挙動: WebAuthn prompt → HQ root credential で 5 contracts の
  `initialize` + visit-stamps↔beans / visit-stamps↔reward-policy の
  `set_*_contract` 結線
- 結果: `#resultInitWire` に成功表示

#### 失敗時 hint

| 症状 | 原因 / 対応 |
|---|---|
| `already initialized` trap (UnreachableCodeReached) | `just deploy-testnet` をやり直して 5 contracts を fresh redeploy (Step 0 から再実行) |
| `Smart account contract not found on-chain` | `VITE_HQ_SMART_ACCOUNT` が古い。Step 1 をやり直して新しい HQ を作る |

### Step 3 — Setup Staff Rules (`#btnStaffRules`)

- フォーム: `staff app 表示名` = `dicekey Staff`、`最初のスタッフ名` =
  `shibuya-tanaka` 等
- 期待挙動: 実機 Touch ID で **新しい staff passkey** を作成 → 4 つの
  `add_context_rule` tx を HQ root credential で署名
- 結果: `#resultStaffRules` に **4 rules** (visit-stamps / beans-token /
  reward-policy / **benefits**) の rule id と staff の credentialId が表示
  される

> issue() フローは 3 つの auth_contexts (visit-stamps / beans / policy、
> index 整合必須) を要求し、加えて benefits 操作用の 1 rule を staff-app の
> Receive Benefit 用に先回りで作っています。詳細は
> [`apps/staff-app/src/lib/passkey.ts`](../../../apps/staff-app/src/lib/passkey.ts)
> の `enrollStaffDevice` を参照。

### Step 4 — env Block を一括コピー (`#btnCopyEnv`)

- 操作: `Copy` ボタンをクリック → 7 行の `VITE_*` env がクリップボードへ
- 貼り先 (順):
  1. `/workspaces/StampSample/.env.testnet`
  2. `/workspaces/StampSample/apps/customer-app/.env.production`
  3. `/workspaces/StampSample/apps/staff-app/.env.production`
  4. `/workspaces/StampSample/tools/sa-harness/.env.production`

> 4 つ目 (`tools/sa-harness/.env.production`) への貼り付けは、次回 `just
> pages` で build される setup UI を hqLocked 状態にして本番 URL での再
> 作成 UI 露出を閉じるためです (`harness.ts` の `hqLocked = cfg.smartAccount
> .hqSmartAccount.length > 0`)。`deploy-testnet.sh` を再走させたときは
> harness の `.env.production` も HQ keys 空に再生成され、再ブートストラップ
> 用に UI が unlock されます (= 4 ファイル運用は deploy ごとに 1 回限り)。

#### 必須キー (7 行すべて)

| キー | 内容 | 出典 |
|---|---|---|
| `VITE_HQ_SMART_ACCOUNT` | Step 1 で作った HQ SA の contractId | `setupState.hq.contractId` |
| `VITE_HQ_ROOT_CREDENTIAL_ID` | HQ root passkey の credentialId | `setupState.hq.credentialId` |
| `VITE_HQ_STAFF_CONTEXT_RULE_ID` | visit-stamps 用 rule id (3 rule の先頭) | `staffRules.contextRuleIds[0]` |
| `VITE_HQ_STAFF_RULE_IDS` | 3 rule (visit-stamps / beans / policy) の `,` 連結 | `staffRules.contextRuleIds.join(",")` |
| `VITE_HQ_STAFF_BENEFITS_RULE_ID` | benefits 用 rule id (4 つ目) | `staffRules.benefitsRuleId` |
| `VITE_HQ_STAFF_CREDENTIAL_ID` | Step 3 で作った staff passkey の credentialId | `staffRules.staffCredentialId` |
| `VITE_HQ_STAFF_NAME` | staff の表示名 (`shibuya-tanaka` 等) | `staffRules.staffName` |

3 つの貼り先ファイルすべてで 7 行を上書きしてください (どれか 1 つでも古い値が
残ると CF Pages 上で `Smart account contract not found on-chain` 等の不整合に
なります)。

`.env.production` の他のキー (`VITE_RP_ID` 等) は変更不要。テンプレは
[`apps/*/.env.production.example`](../../../apps/staff-app/.env.production.example)
を参照。

---

## Step 5: CF Pages へ 2 回目デプロイ (env 反映)

```bash
just pages    # apps/*/.env.production の新 HQ 値が Vite に inline される
```

build 後、`/setup/` UI は警告 banner 「⚠️ HQ はすでに設定されています」を
表示するようになります (`VITE_HQ_SMART_ACCOUNT` が埋まったため自動ロック)。
これでブートストラップ UI は無効化され、本番 URL に露出してもうっかり再
作成できません。

`just pages` 内部:
- `bash scripts/build-pages.sh` — customer / staff / setup の 3 アプリを `dist-pages/` に統合
- `pnpm exec wrangler pages deploy dist-pages --project-name=dicekey-coffee-stamps --branch=main`

事前に `pnpm exec wrangler login` を 1 度だけ済ませておく必要があります。

---

## Step 6: 実機 sign-in テスト

ホスト OS の **同じ Chrome** (Step 2 で HQ passkey を作ったブラウザ) から:

`https://dicekey-coffee-stamps.pages.dev/staff/` を開く → 「端末セットアップ」
ボタンを実行。

### 期待挙動 (WebAuthn assertion 連発)

1. `connectWallet` で HQ SA に接続 (WebAuthn prompt は出ない —
   [`wallet-ops.ts:246-261`](../../../.oz-build/smart-account-kit/src/kit/wallet-ops.ts))
2. **新 staff passkey の作成 prompt** (この端末用に staff cred を新規発行)
3. `add_context_rule` × 4 の Touch ID prompt (visit-stamps / beans / policy /
   benefits を staff の新 cred で登録) — HQ root credential が rpId 一致で
   呼び出される
4. sign-in 完了 → スタッフ画面に staff 名と HQ SA contractId が表示される
5. 任意: customer-app (`https://dicekey-coffee-stamps.pages.dev/`) で
   customer 用 passkey を作成 → staff-app で 1 stamp 発行 → customer-app に
   stamp 1 件 / beans 10 件が反映されることを確認

> **TBD (実機検証で確定):** WebAuthn assertion の合計回数は **5 回前後**を
> 想定 (staff cred 作成 × 1 + add_context_rule × 4)。本 runbook を初めて
> 実機で通した時点でこの数字を確定値に更新し、TODO マーカーを削除して
> ください。

### 失敗時 hint

| 症状 | 原因 / 対応 |
|---|---|
| 実機 sign-in で WebAuthn prompt が出ない | RP_ID 不一致。`apps/staff-app/.env.production` の `VITE_RP_ID=dicekey-coffee-stamps.pages.dev` を確認、ブラウザの URL も完全一致しているか (preview URL は別 origin) |
| `Smart account contract not found on-chain` | Step 4 の貼り付けが 3 ファイルすべて完了していない or 古い HQ を指している。`.env.production` をもう一度 diff 確認 → `just pages` を再走 |
| `SmartAccountError #3014 ContextRuleIdsLengthMismatch` | Step 3 が 4 rule 完走していない (途中で WebAuthn を Cancel した等)。Step 0 からやり直し |
| `/setup/` で警告 banner が出ない & Step 1 を再実行できてしまう | env が空のままビルドされた = `apps/*/.env.production` がまだ古い HQ で埋まっている、または build キャッシュが効いている。`just pages` 再走 (`rm -rf dist-pages` してから) |

---

## 失敗時のロールバック

HQ 再作成は不可逆 (旧 HQ は孤児化) なので:

- 着手前に `.env.testnet`, `apps/{customer,staff}-app/.env.production` を
  `*.bak.YYYYMMDD` として手動コピー
- `dist-pages/` は git untracked なので削除しても問題なし
- どのステップで失敗しても、`just deploy-testnet` → `just bindings-testnet` →
  `just pages` → `/setup/` で HQ 再作成、というフローをやり直せばクリーンに
  戻せる (= 過去の HQ / contracts は単に孤児として Testnet に残るのみ)

---

## 関連リソース

- Plan: [`docs/dev/plans/hq-setup-testnet/plan.md`](./plan.md)
- 自動化 smoke: `just testnet` (CDP 仮想 authenticator、`scripts/sa-setup-testnet.mjs`)
- harness UI 本体: [`tools/sa-harness/index.html`](../../../tools/sa-harness/index.html) /
  [`src/harness.ts`](../../../tools/sa-harness/src/harness.ts)
- staff enrollment 実装:
  [`apps/staff-app/src/lib/passkey.ts`](../../../apps/staff-app/src/lib/passkey.ts)
  (`enrollStaffDevice`)
- build pipeline: [`scripts/build-pages.sh`](../../../scripts/build-pages.sh)
- env mirror: [`scripts/deploy-testnet.sh`](../../../scripts/deploy-testnet.sh)
  (末尾で `tools/sa-harness/.env.{testnet,production}` を生成)

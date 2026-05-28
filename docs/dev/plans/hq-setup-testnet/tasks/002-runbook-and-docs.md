---
id: "002"
title: "runbook 作成と CLAUDE.md / README.md への記載追加"
status: done
priority: 2
dependencies: ["001"]
estimated_complexity: medium
---

# Task: runbook 作成と CLAUDE.md / README.md への記載追加

## Goal

`just hq-setup-testnet` を初見の開発者が assistant 不在で 30 分以内に通せる
手順書 (`runbook.md`) を作成し、その存在を CLAUDE.md の Commands 表と
README.md の Testnet セクションから cross-link する。HQ root passkey が
**作成 authenticator にのみ存在し別端末で sign-in 不可** という制約を
CLAUDE.md の Gotchas に 1 行で明記する。

## Interfaces

`runbook.md` のセクション構成 (= 手順書としての契約):

```markdown
# Runbook: hq-setup-testnet

## 前提                                # 🔵 plan.md の Locked decisions と整合
- just deploy-testnet + just bindings-testnet 実行済
- host OS Chrome (Safari 不可: localhost で WebAuthn 動作不可)
- 同一ブラウザで harness origin (localhost) と CF Pages origin
  (dicekey-coffee-stamps.pages.dev) の両方で WebAuthn を実行できる端末

## Step 1: HQ Wallet 作成                # 🔵 harness UI ボタン定義
- 操作: harness UI で「Create HQ Wallet」をクリック
- 結果: contractId / credentialId が UI に表示される
- 注意: 実機の Touch ID / Windows Hello prompt が出る

## Step 2: Initialize + Wire           # 🔵 harness UI ボタン定義
- 操作: 「Initialize + Wire」をクリック
- 結果: 5 contracts の init 完了
- 失敗時の hint: `already initialized` trap → 5 contracts を fresh redeploy

## Step 3: Setup Staff Rules           # 🟡 4 rules (visit-stamps / beans /
                                       #     policy / benefits) — plan.md 訂正済
- 操作: 「Setup Staff Rules」をクリック
- 結果: 4 つの ruleId と staff credentialId が表示される

## Step 4: Env Block を一括コピー        # 🔵 harness UI Step 4 ボタン
- 操作: 「Copy」をクリック → 7 行の VITE_* env がクリップボードへ
- 貼り先 (順):
  1. /workspaces/StampSample/.env.testnet
  2. /workspaces/StampSample/apps/customer-app/.env.production
  3. /workspaces/StampSample/apps/staff-app/.env.production
- 必須キー:
  - VITE_HQ_SMART_ACCOUNT
  - VITE_HQ_ROOT_CREDENTIAL_ID
  - VITE_HQ_STAFF_CONTEXT_RULE_ID
  - VITE_HQ_STAFF_RULE_IDS
  - VITE_HQ_STAFF_BENEFITS_RULE_ID
  - VITE_HQ_STAFF_CREDENTIAL_ID
  - VITE_HQ_STAFF_NAME

## Step 5: CF Pages デプロイ            # 🔵 既存 just pages 動作実績
- 操作: just pages
- 結果: dist-pages が wrangler 経由で
  https://dicekey-coffee-stamps.pages.dev/ に反映

## Step 6: 実機 sign-in テスト           # 🟡 案 A の核心 (実機 WebAuthn × 5)
- 操作: host browser で
  https://dicekey-coffee-stamps.pages.dev/staff/ を開く →
  「端末セットアップ」を実行
- 期待挙動:
  1. Touch ID: HQ root credential prompt (connectWallet の WebAuthn 不出を
     確認するため厳密には不要だが、新 staff passkey の作成と add_context_rule
     × 4 の合計 5 連発で WebAuthn assertion を要求する)
  2. 新 staff passkey の作成 prompt
  3. add_context_rule × 4 の Touch ID prompt × 4
  4. sign-in 完了、customer 側に 1 stamp 反映

## 失敗時のロールバック                  # 🔵 plan.md の同セクション
- .env.testnet を .env.testnet.bak.YYYYMMDD で手動バックアップしてから着手
- HQ 再作成は不可逆 (古い HQ は孤児化) → 失敗時は just deploy-testnet からやり直し
```

CLAUDE.md / README.md への追記内容:

```markdown
# CLAUDE.md ## Commands に 1 行追加              # 🔵 既存表のフォーマット
| just hq-setup-testnet | Testnet 向け HQ ブートストラップ UI を起動 (host browser、IRREVERSIBLE) |

# CLAUDE.md ## Gotchas に 1 行追加               # 🟡 案 A 制約
- HQ root passkey は作成 authenticator にのみ存在。
  別端末からの sign-in は不可 (案 A は同一端末運用が前提)。

# README.md Testnet セクションに 2-3 行追記      # 🔵 既存セクション拡張
- just testnet (CDP virtual authenticator、E2E smoke) と
  just hq-setup-testnet (host browser passkey、実機運用) の使い分け
```

信号機:
- 🔵 既存資産 (plan.md / harness UI / just テンプレ) との整合は確定
- 🟡 Step 6 の WebAuthn assertion 連発数 (= 5) と各 prompt のタイミングは
  実機で初検証になる。runbook 完成時点では "予想 5 回 (HQ root x 1 +
  staff cred 作成 x 1 + add_context_rule x 4 = 6 回かもしれない)" として
  注釈を残し、実機検証後に正確な回数で更新
- 🟡 同一ブラウザで 2 origin にまたがる WebAuthn ceremony は仕様上問題ないが
  実機での挙動 (passkey UI の差異) は未確認

## Test Strategy

- [ ] `docs/dev/plans/hq-setup-testnet/runbook.md` が新規作成され、Step 1-6
      + 失敗時ロールバックを含む
- [ ] runbook の "必須キー" リストが harness Step 4 が実際に出力する 7 キーと
      完全一致する (plan.md と同期、`VITE_HQ_STAFF_CONTEXT_RULE_ID` /
      `VITE_HQ_STAFF_BENEFITS_RULE_ID` / `VITE_HQ_STAFF_CREDENTIAL_ID` /
      `VITE_HQ_STAFF_NAME` を含む)
- [ ] runbook の Step 3 が **4 rules** (visit-stamps / beans / policy +
      **benefits**) を作る点を明記している
- [ ] CLAUDE.md `## Commands` のテーブルに `just hq-setup-testnet` の行があり、
      `(IRREVERSIBLE)` または同等の注意書きを含む
- [ ] CLAUDE.md `## Gotchas` セクション末尾に "HQ root passkey は作成
      authenticator にのみ存在 ..." の bullet が追加されている
- [ ] README.md の Testnet セクションに `just testnet` と `just hq-setup-testnet`
      の使い分けを 2-3 行で記載
- [ ] runbook が markdown lint 相当の構造 (見出しレベルが一貫、コードブロックの
      言語指定あり) を満たす
- [ ] runbook 内のすべてのファイルパスが絶対パスまたは repo ルート相対パスで
      解決可能 (`./...` のような曖昧な相対参照を含まない)
- [ ] runbook の Step 6 末尾に "TBD 実機検証で WebAuthn assertion 回数を更新"
      の TODO マーカーが残されている (実機検証後に削除する)

## Implementation Notes

- 参照すべき既存コード:
  - `/workspaces/StampSample/docs/dev/plans/hq-setup-testnet/plan.md` —
    runbook の骨組みは plan.md "実行フロー" セクションを詳述する形で書く
  - `/workspaces/StampSample/tools/sa-harness/index.html` — UI ボタンの
    id (`#btnCreateHq` / `#btnInitWire` / `#btnStaffRules` / `#btnCopyEnv`)
    と Step ラベルを runbook に引用 (UI 変更時の追跡を容易に)
  - `/workspaces/StampSample/tools/sa-harness/src/harness.ts` — Step 4 の
    env block 内容 (`renderEnvBlock` 周辺) を 7 行リストの根拠として参照
  - `/workspaces/StampSample/apps/staff-app/src/lib/passkey.ts:295` —
    `enrollStaffDevice` のフローを Step 6 の説明に反映 (新 staff passkey
    作成 → add_context_rule × 4)
  - `/workspaces/StampSample/CLAUDE.md` — Commands 表と Gotchas セクションの
    既存フォーマットに合わせて追記する
  - `/workspaces/StampSample/README.md` — Testnet セクション (キーワード:
    "Testnet" でファイル検索)
- 実装のヒント:
  - 既存 `docs/dev/plans/demo-deployment/cf-pages-runbook.md` があれば
    runbook の構造的参考になる
  - 同 plan の reports/ ディレクトリは Phase 5 (実機検証完了後) に
    `001-real-device-smoke.md` 等として活用する
- 注意事項:
  - CLAUDE.md / README.md の更新は Task 001 の recipe 追加と **同じ commit
    に含める** (plan.md DoD の "1 commit にまとめて push" 要件)
  - 既存の "CDP virtual authenticator 経由の sa-setup-testnet.mjs" の
    位置づけは温存 (E2E smoke 用途で必要)。runbook で「実機運用なら
    hq-setup-testnet、自動 smoke なら just testnet」と明示する

## Files

- 新規:
  - `/workspaces/StampSample/docs/dev/plans/hq-setup-testnet/runbook.md`
- 変更:
  - `/workspaces/StampSample/CLAUDE.md` (Commands 表 + Gotchas 各 1 行追記)
  - `/workspaces/StampSample/README.md` (Testnet セクション 2-3 行追記)
- テスト: なし (ドキュメント。Test Strategy の検証は読み合わせ + Task 005
  相当の実機 E2E で間接検証)

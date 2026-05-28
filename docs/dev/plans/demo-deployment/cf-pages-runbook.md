# CF Pages Deployment Runbook (Tasks 006 / 007)

> Phase 1 — `*.pages.dev` 公開（複数人同時テストは Phase 1.5 Worker 化まで sequence 競合リスクを受容）

本 runbook は customer-app (Task 006) と staff-app (Task 007) の Cloudflare Pages デプロイ手順を共通化したもの。CF ダッシュボードでの設定が中心で、コード変更は最小（SPA fallback + 防御的 header）。

## Pre-deploy 前提

| 項目 | 確認 |
|------|------|
| Task 004 完了 (`.env.testnet` に 5 contract id 埋まり) | ✅ |
| Task 005 完了 (`.env.testnet` の HQ SA / staff rule ids / customer SA 埋まり) | ✅ |
| smart-account-kit が `.oz-build/` に build 済み (CF builder でも `bash scripts/build-kit.sh` が走る) | ✅ |
| GitHub repo の `main` ブランチに変更 merge 済み | — |

## CF Pages プロジェクト共通設定

| 項目 | 値 |
|------|------|
| Framework preset | None |
| Production branch | `main` |
| Build command | 下記 |
| Node version | `20` |
| Environment variable: `PNPM_VERSION` | `9` |
| Compatibility flags | `nodejs_compat`（不要だが将来の Functions 連携を考慮） |

### Build command (両アプリ共通の前半)

```bash
pnpm install --frozen-lockfile && \
bash scripts/build-kit.sh && \
pnpm --filter @dicekey/sdk build && \
pnpm --filter @dicekey/contracts build
```

最後の `pnpm --filter <app> build` だけがプロジェクト固有。

> ⚠️ `scripts/build-kit.sh` は smart-account-kit の OZ account spec を **Testnet RPC から fetch** する。CF builder のネットワーク outbound が許可されていることが前提（標準では許可されている）。失敗する場合は `.oz-build/smart-account-kit` を pre-built artifact として repo に temporary commit する代替案（gitignore の解除が必要、Plan の 🔴 リスク欄に記載）。

## 環境変数マトリクス

両プロジェクトで設定する。値は **`.env.testnet`** から転記。`*` は **プロジェクトごとに異なる**。

| Key | customer-app | staff-app | 出所 |
|-----|--------------|-----------|------|
| `VITE_NETWORK` | `testnet` | 同左 | 固定 |
| `VITE_RPC_URL` | `https://soroban-testnet.stellar.org` | 同左 | 固定 |
| `VITE_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | 同左 | 固定 |
| `VITE_VISIT_STAMPS_CONTRACT` | `.env.testnet` 値 | 同左 | Task 004 |
| `VITE_BEANS_TOKEN_CONTRACT` | 〃 | 〃 | 〃 |
| `VITE_BENEFITS_CONTRACT` | 〃 | 〃 | 〃 |
| `VITE_BADGES_CONTRACT` | 〃 | 〃 | 〃 |
| `VITE_REWARD_POLICY_CONTRACT` | 〃 | 〃 | 〃 |
| `VITE_ACCOUNT_WASM_HASH` | `.env.testnet` | 同左 | Task 004 (固定値) |
| `VITE_WEBAUTHN_VERIFIER_ADDRESS` | 〃 | 〃 | 〃 |
| `VITE_ED25519_VERIFIER_ADDRESS` | 〃 | 〃 | 〃 |
| `VITE_NATIVE_TOKEN_CONTRACT` | 〃 | 〃 | 〃 |
| `VITE_HQ_SMART_ACCOUNT` | `.env.testnet` | 同左 | Task 005 |
| `VITE_HQ_STAFF_CONTEXT_RULE_ID` | 〃 | 〃 | 〃 |
| `VITE_HQ_STAFF_RULE_IDS` | 〃 | 〃 | 〃 |
| `VITE_HQ_STAFF_BENEFITS_RULE_ID` | 〃 | 〃 | 〃 |
| `VITE_DEMO_CUSTOMER_SA` | 〃 | 〃 | 〃 |
| `VITE_DEPLOYER_ADDRESS` | `.env.testnet` | 同左 | Task 004 |
| `VITE_RP_ID` ★ | `dicekey-customer-app.pages.dev` | `dicekey-staff-app.pages.dev` | プロジェクトごと |
| `VITE_RP_NAME` ★ | `dicekey Coffee Stamps` | `dicekey Coffee Stamps (Staff)` | プロジェクトごと |

> ★ **VITE_RP_ID 注意**: 初回 deploy 時点では実 host (`<project>.pages.dev`) が未確定 → 仮値 `localhost` で 1 回 deploy → 自動採番された host を CF ダッシュボードの env vars に書き戻して **再デプロイ**。

## プロジェクト別: 個別差分

### Task 006: customer-app

| 項目 | 値 |
|------|------|
| Project name | `dicekey-customer-app` |
| Build command (末尾) | `... && pnpm --filter customer-app build` |
| Build output directory | `apps/customer-app/dist` |
| Expected host | `https://dicekey-customer-app.pages.dev` |
| `VITE_RP_ID` 最終値 | `dicekey-customer-app.pages.dev` |
| `VITE_RP_NAME` | `dicekey Coffee Stamps` |

### Task 007: staff-app

| 項目 | 値 |
|------|------|
| Project name | `dicekey-staff-app` |
| Build command (末尾) | `... && pnpm --filter staff-app build` |
| Build output directory | `apps/staff-app/dist` |
| Expected host | `https://dicekey-staff-app.pages.dev` |
| `VITE_RP_ID` 最終値 | `dicekey-staff-app.pages.dev` |
| `VITE_RP_NAME` | `dicekey Coffee Stamps (Staff)` |

## Post-deploy 検証

### customer-app

- [ ] `https://dicekey-customer-app.pages.dev/` がロード
- [ ] LoginPage → 「パスキーで新規作成」→ Touch ID / Windows Hello / Android Passkey → ホーム到達
- [ ] ホームに `通算来店` が表示され、スタンプ枚数（fresh SA は 0）が読める（チェーン読み込みエラーが出ない）
- [ ] Settings 画面で自分の Smart Account C-address が表示される

### staff-app

- [ ] `https://dicekey-staff-app.pages.dev/` がロード
- [ ] **HQ root credential を staff-app 用に別途 enroll する**:
  - `VITE_RP_ID` が customer-app と異なるため、`.env.testnet` の `VITE_HQ_SMART_ACCOUNT` に対し staff-app の RP で別 passkey を addPasskey する必要あり
  - 手順: staff-app の「この端末を登録」フローで HQ root credential を再作成（kit の addPasskey で staff-app の RP に紐づく新 passkey を HQ SA の signer として追加） — kit が複数 RP の signer を受け入れることが前提（要動作検証）
- [ ] staff sign-in (venue=shibuya) → ダッシュボード到達
- [ ] customer-app で作成した customer SA に対して `スタンプ発行` 実行 → `通算スタンプ ≥ 1`, `beans ≥ 10`

### Cross-RP edge case (要動作確認)

- [ ] customer-app の passkey credential では staff-app の WebAuthn が拒否されること（仕様確認）

## Phase 1 既知の制約

| リスク | 受容理由 / Phase 1.5 での解消 |
|--------|------------------------------|
| Fee payer 鍵 (kit deterministic deployer `GAAH4OT3...`) がクライアントから推測可能 → drain される可能性 | Testnet の friendbot で再 fund 可能。Phase 1.5 (Task 008-012) の Worker 化で Worker secret 格納 + sequence 直列化 |
| 同時操作時の `tx_bad_seq` | 再試行で OK。Phase 1.5 の Durable Object SequenceManager で解消 |
| staff-app の Use Beans / Receive Benefit | 最小実装 + TODO のまま（CLAUDE.md 既知範囲） |

## References

- 設計原典: `docs/design/dicekey-coffee-stamps/smart-account-integration.md`
- Phase 1 デプロイ計画: `docs/dev/plans/demo-deployment/plan.md`
- バグ詳細: `.dcs/20260522084831_passkey_signup_network_err/final_report.md`

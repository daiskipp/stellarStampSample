# 最終レポート — passkey 新規作成 Network Error

**実施日時**: 2026-05-22 09:50 JST
**分析者**: Claude Code

[← インデックスに戻る](./index.md)

---

## 1. エグゼクティブサマリー

`customer-app` でパスキー新規作成すると「Network Error」で失敗するのは、**`smart-account-kit` が必要とする HTTPS RPC エンドポイントへの到達経路が、`pnpm --filter customer-app dev` の起動フローに組み込まれていない**ためです。

技術的に言い換えると、kit が叩く `https://127.0.0.1:8443/rpc` の listener が

- (A) `pnpm dev` 単独では起動されず（proxy spawn は sa-setup / smoke / E2E スクリプトだけが行う）、
- (B) 仮に devcontainer 内で起動しても `127.0.0.1` バインド限定 + `forwardPorts` に 8443 がないため、ホスト OS の Chrome からは届かない、

という **2 つの独立した必要条件が同時に成立しない**状態にあります。`.devcontainer/Caddyfile.host` という代替素材はありますが、CLAUDE.md / README / `pnpm dev` の流れから案内されていません。

推奨対策は **Vite dev サーバに HTTPS + `/rpc` proxy を統合する案 3**。`apps/*/vite.config.ts` と `apps/*/.env` の少数行変更で、proxy プロセス起動・8443 ポートフォワード・127.0.0.1 二重 loopback 問題・自己署名証明書の二重信頼の **4 つを同時に解消**できます。工数は約半日。E2E と smoke の既存資産は別系統で温存します。

---

## 2. 根本原因

### 2.1 複合原因の構成

| 要因 | 内容 | コード根拠 |
|---|---|---|
| A | `pnpm --filter customer-app dev` が HTTPS proxy を起動しない | `apps/customer-app/package.json` の `dev: "vite"`、`apps/customer-app/vite.config.ts`（全 7 行、プラグイン無し）、proxy spawn は `scripts/sa-setup.mjs:58` / `scripts/smoke-customer-app.mjs:60-63` / `scripts/smoke-staff-app.mjs:75-77` / `e2e/global-setup.ts:119-122` の 4 つだけ |
| B | proxy が `127.0.0.1` バインド限定 + `forwardPorts` 8443 欠落 | `scripts/rpc-https-proxy.mjs:61` `server.listen(LISTEN_PORT, "127.0.0.1", ...)`、`.devcontainer/devcontainer.json:13` `forwardPorts: [5173, 5174, 8000]`（8443 なし） |
| C | `.devcontainer/Caddyfile.host` の運用が dev フローに繋がっていない | `Caddyfile.host:6` コメント以外に案内なし、`apps/customer-app/.env:4` も触れず |

`smart-account-kit` 0.3.0 は `.oz-build/smart-account-kit/src/kit.ts:363` で `new RpcServer(config.rpcUrl)` に絶対 https URL をそのまま渡す実装で、`allowHttp` を通せないため、proxy 不在では前進不可能です（参考: 候補と除外の詳細は `root_cause_analysis.md` 「候補1〜4」「除外した候補」セクション）。

### 2.2 発生メカニズム（ステップ図）

```
[1] ホスト Chrome で http://localhost:5173 を開く
        └ devcontainer.json forwardPorts: [5173] により透過 → OK

[2] customer-app ロード
        └ apps/customer-app/src/lib/passkey.ts:25-32 のトップレベル副作用
          setConfig({ ..., rpcUrl: "https://127.0.0.1:8443/rpc" })

[3] AuthProvider マウント → connectExisting()
        └ AuthContext.tsx:66-68 try/catch サイレント
          ※ 実はこの時点で既に同 URL の axios が失敗しているが UI には何も出ない

[4] 「パスキーで新規作成」押下
        ├ LoginPage.tsx:18  login(name)
        ├ AuthContext.tsx:78  registerPasskeyWallet(name)
        └ passkey.ts:61  kit.createWallet(APP_NAME, name, { autoSubmit: true })

[5] kit 内部
        ├ createPasskey (WebAuthn) — ここまで成功（OS keychain に登録される）
        └ buildDeployTransaction
            └ specFromWasmHash
                └ getContractWasmByHash(VITE_ACCOUNT_WASM_HASH)
                    └ getLedgerEntries → axios.post(rpcUrl, ...)

[6] axios.post → "https://127.0.0.1:8443/rpc"
        ├ ホスト Chrome 視点では 127.0.0.1 = ホストの loopback
        ├ 要因 A: devcontainer 内 proxy が未起動
        ├ 要因 B: 仮に起動しても 127.0.0.1 bind + forwardPorts 8443 欠落
        └ → 結果: ホスト側 listener 不在 → TCP RST → ERR_CONNECTION_CLOSED

[7] axios が Error("Network Error") を throw
        ├ passkey.ts:61 catch なし → rethrow
        ├ AuthContext.tsx:77-86 catch なし → rethrow
        └ LoginPage.tsx:19-22 catch が setError(e.message) → "Network Error" を UI 表示
```

---

## 3. 推奨修正方法（案 3: Vite 統合）

### 3.1 修正方針

`apps/customer-app`（および `apps/staff-app`）の Vite dev サーバを **HTTPS 化**し、`server.proxy["/rpc"]` で `http://stellar-localnet:8000` に転送します。アプリ自身の origin に `/rpc` を生やすので、ホスト OS / devcontainer どちらのブラウザでも `https://localhost:5173/rpc` で一意に解決され、127.0.0.1 二重 loopback 問題・8443 forward 不足・proxy プロセス手動起動・自己署名二重信頼が **同時に消えます**。

kit 側の制約（`new RpcServer(absolute https URL)` 必須、`allowHttp` 不可）に整合します。`@vitejs/plugin-basic-ssl` の自己署名は **アプリ origin と同一**になるので、Chrome の警告許可は初回 1 回で済みます。

### 3.2 具体的なコード変更

#### `apps/customer-app/vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    https: true,
    proxy: {
      "/rpc": {
        target: "http://stellar-localnet:8000",
        changeOrigin: true,
        secure: false,
      },
      "/friendbot": {
        target: "http://stellar-localnet:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
```

#### `apps/customer-app/.env`（行 7-8 を変更、行 4 コメントを更新）

```env
# Vite dev サーバが /rpc を http://stellar-localnet:8000 に proxy します。
# 旧 scripts/rpc-https-proxy.mjs は E2E / smoke / sa-setup でのみ利用。
VITE_RPC_URL=https://localhost:5173/rpc
VITE_RPC_PROXY_URL=https://localhost:5173/rpc
VITE_FRIENDBOT_URL=https://localhost:5173/friendbot
```

#### kit の rpcUrl 解釈（再確認）

`.oz-build/smart-account-kit/src/kit.ts:355,361,363` は `config.rpcUrl` を string でそのまま `new RpcServer(...)` に渡すだけで、相対 URL 解決はしません。**absolute https URL が必須**なので、`/rpc` ではなく `https://localhost:5173/rpc` を env に入れる必要があります。`@stellar/stellar-sdk` の `rpc.Server` は `URL(rpcUrl)` で origin を抽出し axios で `${origin}/rpc` に POST するため、Vite の `server.proxy` で問題なく受けられます（POST + JSON body 転送可）。

#### 同様修正を staff-app にも

`apps/staff-app/vite.config.ts` と `apps/staff-app/.env` に同じ変更を入れます。`apps/staff-app/src/lib/passkey.ts:27-51` は customer-app と同じパターンなので、env を差し替えるだけで動きます。

#### 既存 proxy / harness の温存

`scripts/rpc-https-proxy.mjs` と `tools/sa-harness/proxy-{cert,key}.pem` は **削除しません**。E2E (`e2e/global-setup.ts`)、smoke (`scripts/smoke-*.mjs`)、`scripts/sa-setup.mjs` がそれぞれ proxy を spawn する形で `https://127.0.0.1:8443/rpc` を引き続き使うため、Playwright/CDP 経路の既存資産はそのまま維持します。env だけ修正後の `VITE_RPC_URL=https://localhost:5173/rpc` と上書き競合しないよう、E2E 側で env を override する形に整理します（実装ステップ参照）。

---

## 4. 代替案と判断材料

| 案 | 概要 | メリット | デメリット | 採否 |
|---|---|---|---|---|
| 1: dev スクリプト統合 | `concurrently` で `rpc-https-proxy.mjs` + Vite を同時起動。bind を `0.0.0.0` 切替可に。`forwardPorts` に 8443 追加 | 変更箇所局所、既存 proxy / 証明書を流用 | ホスト Chrome での証明書信頼が依然手作業。`0.0.0.0` bind + forwardPorts + 証明書例外の 3 段が残る | 緊急ホットフィックス用に保留 |
| 2: Caddyfile.host を正式運用 | README / CLAUDE.md にホスト Mac での `caddy run` + `caddy trust` を明文化 | 証明書は Caddy local CA で永続解決 | ホスト OS で常時 caddy run する負担。OS 差・Caddy 未インストール・CA 信頼手順差が運用コスト | 非推奨 |
| **3: Vite 統合** | Vite を https 化し `server.proxy["/rpc"]` で中継、`.env` の URL をアプリ origin へ | proxy プロセス・8443 forward・loopback 不一致・自己署名二重信頼を**同時に消去**。E2E / smoke は別系統で温存 | basic-ssl の自己署名は初回ブラウザ警告 1 回必要、staff-app も同期改修 | **推奨** |

判断材料の核は「変更後に残る運用ステップの数」。案 3 は手動 dev フローを `pnpm dev:customer` 1 行に縮減できます。

---

## 5. 実装ステップ・タイムライン（半日工数）

| # | 作業 | 想定時間 | 主な作業内容 |
|---|---|---|---|
| 1 | `@vitejs/plugin-basic-ssl` を customer-app / staff-app に追加 | 10 分 | `pnpm --filter customer-app add -D @vitejs/plugin-basic-ssl`、staff-app も同様 |
| 2 | `apps/customer-app/vite.config.ts` を本レポート 3.2 の形に書き換え | 15 分 | https + `/rpc` + `/friendbot` proxy 設定 |
| 3 | `apps/staff-app/vite.config.ts` を同様に変更 | 10 分 | customer-app からコピー |
| 4 | `apps/customer-app/.env` / `apps/staff-app/.env` の `VITE_RPC_URL` / `VITE_RPC_PROXY_URL` / `VITE_FRIENDBOT_URL` を `https://localhost:5173`(5174) ベースに変更、行 4 コメントを更新 | 10 分 | proxy 起動案内コメントを案 3 仕様へ書き換え |
| 5 | E2E / smoke が env を override する形に微調整 | 30 分 | `e2e/global-setup.ts` / `scripts/smoke-customer-app.mjs` / `scripts/smoke-staff-app.mjs` で `VITE_RPC_URL=https://127.0.0.1:8443/rpc` を子プロセス env として注入（`apps/*/.env.test` 化でも可） |
| 6 | 手動検証: customer-app / staff-app それぞれで新規作成完走 | 30 分 | 本レポート 7. テスト戦略の手順 |
| 7 | `pnpm test:e2e` 全件パス確認 | 30 分 | proxy 経路の回帰防止 |
| 8 | UX エラーメッセージ改善 + `connectExisting` の `console.warn` 化 | 30 分 | 本レポート 9. 関連修正 |
| 9 | CLAUDE.md / `apps/*/.env` コメント / 必要なら README 更新 | 30 分 | 「proxy は E2E 用」の注記、案 3 採用後の dev 起動手順 |
| 10 | PR レビュー / 軽い手直し余地 | 30-60 分 | バッファ |

合計約 3.5〜4.5 時間（半日）。

---

## 6. テスト戦略

### 6.1 手動確認（修正後の primary 経路）

1. `bash scripts/deploy-localnet.sh && bash scripts/generate-bindings.sh`（既存 one-shot 前半）。
2. **proxy を別途起動せず** `pnpm --filter customer-app dev` を起動。
3. ホスト Chrome で `https://localhost:5173` を開き、初回のみ自己署名警告を許可。
4. 「パスキーで新規作成」→ ダイアログ承認 → ホーム画面表示で OK。
5. DevTools Network で `POST https://localhost:5173/rpc` が 200 で返ることを確認。
6. staff-app (5174) でも同様に新規作成・既存サインインを確認。

### 6.2 既存自動テストの活用

| テスト | 期待挙動 |
|---|---|
| `pnpm test:e2e`（`e2e/customer-app.spec.ts` / `staff-app.spec.ts`） | global-setup が `rpc-https-proxy.mjs` を spawn する経路は維持。env override で `https://127.0.0.1:8443/rpc` を子プロセスに渡し、kit を proxy 経由に戻すと壊れない |
| `scripts/smoke-customer-app.mjs` / `smoke-staff-app.mjs` | 同上、devcontainer 同居 Chromium + `ignoreHTTPSErrors: true` で proxy 経路を継続テスト |
| `cargo test`（46 テスト） | 本症状とは独立、無影響 |

### 6.3 追加で入れたい検証

- (任意) `scripts/smoke-customer-app-host.mjs` 的なホスト OS ブラウザ想定の smoke を追加し、Vite https + proxy パスを CI で常時テスト。ただし devcontainer + Playwright で `https://localhost:5173` を叩く形は既存 smoke とほぼ重複するので、優先度は低い。

---

## 7. 影響範囲

| 対象 | 案 3 適用前 | 案 3 適用後 |
|---|---|---|
| `apps/customer-app` (5173) | 失敗（本症状） | 手動 dev で完走 |
| `apps/staff-app` (5174) | 同症状（同パターン） | 同期改修で完走 |
| `tools/sa-harness` (5180) | `sa-setup.mjs` 経由のみ OK | 不変（既存 proxy 経路を維持） |
| Playwright E2E (`pnpm test:e2e`) | OK | env override で OK 維持 |
| `scripts/smoke-customer-app.mjs` / `smoke-staff-app.mjs` | OK | env override で OK 維持 |
| `cargo test` | 無関係 | 無関係 |

影響範囲は「手動 dev × ホスト OS ブラウザ」シナリオに限定され、自動テスト群は env 注入の差し替えだけで温存できます。

---

## 8. 関連修正（UX / 診断改善）

本症状を直すだけでなく、再発時の切り分けコストを下げるため以下を併走で実施します。

### 8.1 `apps/customer-app/src/pages/LoginPage.tsx:19-22`

axios の `error.message="Network Error"` をそのまま画面に出している箇所を改善。

```tsx
} catch (e) {
  const msg = e instanceof Error ? e.message : "Smart Account の作成に失敗しました";
  if (msg === "Network Error") {
    setError(`RPC エンドポイント (${import.meta.env.VITE_RPC_URL}) に到達できません。Vite dev サーバの /rpc proxy が有効か確認してください。`);
  } else {
    setError(msg);
  }
}
```

`apps/staff-app/src/pages/LoginPage.tsx` も同様に。

### 8.2 `apps/customer-app/src/contexts/AuthContext.tsx:66-68`

`connectExisting()` 失敗の **完全サイレント** を `console.warn` で残す。本番でも害が少ない情報量に。

```tsx
} catch (err) {
  console.warn("[AuthContext] connectExisting silent failure:", err);
}
```

これにより起動時にも既に RPC が落ちていることが DevTools コンソールで分かり、ボタン押下時のエラーと併せて切り分けやすくなります。

### 8.3 staff-app の同期

`apps/staff-app/src/lib/passkey.ts:27-51` は customer-app と同じ proxy 前提コメントなので、案 3 の修正は staff-app にも必ず適用します。staff-app だけ取り残すと「customer は直ったが staff が同症状」という回帰を生みます。

---

## 9. 再発防止策

1. **dev 起動の単一エントリ化**: 案 3 採用後は `pnpm dev:customer` 一本で完結する状態を CLAUDE.md / 各 `apps/*/.env` のコメントに明記。「別ターミナルで proxy を立てる」必要が無いことを言語化する。
2. **エラーメッセージの情報密度**: 8.1 の改善で axios の `Network Error` 素通しを廃する。原因切り分け（到達不能 / 証明書 / RPC 内部エラー）を切り分けるヒントを最低限含める。
3. **起動時診断ログ**: 8.2 の `console.warn` 追加で `connectExisting` の silent failure を可視化。
4. **`.devcontainer/Caddyfile.host` の去就を明確化**: 案 3 採用後はレガシー注記を付ける、または削除する。
5. **CI smoke 化**（任意・低優先度）: `scripts/smoke-customer-app.mjs` を GitHub Actions などで常時実行し、Vite proxy or rpc-https-proxy の経路を壊した PR を弾く。

---

## 10. リスクと未解決の課題

| 項目 | リスク / 課題 | 対応方針 |
|---|---|---|
| `@vitejs/plugin-basic-ssl` の自己署名 | 初回ブラウザ警告を 1 回踏む必要あり | アプリ origin と同一なので UX 総量は減る。CLAUDE.md / README に「初回のみ警告を許可」と明記 |
| `forwardPorts: [5173]` が https 化される | Vite を https で公開すること自体は devcontainer の Ports パネル挙動上は問題なし。OrbStack 含む環境でも http→https の置換のみ | 動作確認は実装ステップ 6 で実施 |
| 孤児パスキー（OS keychain に残るが IndexedDB に未保存） | `kit.createWallet` が deploy 失敗時に WebAuthn だけ進めて IndexedDB に書かないか、`smart-account-kit` 0.3.0 の挙動を未確認。残るなら開発中に keychain が膨らむ UX 問題 | 本症状の修正後は deploy 失敗自体が減る。残課題として `.oz-build/smart-account-kit/src/kit.ts` の `createWallet` 例外パスを後追い確認 |
| E2E / smoke 側の env override | `apps/customer-app/.env` を案 3 仕様に書き換えると、Playwright が起動する Vite が `https://localhost:5173/rpc` を使うため、proxy spawn が無効化される | 実装ステップ 5 で子プロセス env として `VITE_RPC_URL=https://127.0.0.1:8443/rpc` を渡す、または `.env.test` を導入 |
| Vite proxy の `/friendbot` パスの実在性 | kit の friendbot 利用は localnet の passphrase 判定をスキップする実装。実際にエンドポイントが叩かれるかは未検証 | proxy 設定は予防的に追加するだけなので副作用なし。実運用で叩かれた場合に備えるリスクヘッジ |
| 案 3 と既存 proxy の二重メンテ | 当面は両方を maintain する形になる | E2E / smoke の維持コストは低い（proxy は 70 行程度のスクリプト）。中期的に E2E も Vite https + proxy 経路に統一する選択肢を残す |

---

## 付録: 参照すべきファイル

- 推奨修正の中心: `apps/customer-app/vite.config.ts`, `apps/customer-app/.env`, `apps/staff-app/vite.config.ts`, `apps/staff-app/.env`
- 関連 UX 改善: `apps/customer-app/src/pages/LoginPage.tsx`, `apps/customer-app/src/contexts/AuthContext.tsx`, `apps/staff-app/src/pages/LoginPage.tsx`
- 既存 proxy（E2E 用に温存）: `scripts/rpc-https-proxy.mjs`, `tools/sa-harness/proxy-{cert,key}.pem`
- E2E / smoke 経路: `e2e/global-setup.ts`, `scripts/smoke-customer-app.mjs`, `scripts/smoke-staff-app.mjs`, `scripts/sa-setup.mjs`
- 設計素材（去就要検討）: `.devcontainer/Caddyfile.host`, `.devcontainer/devcontainer.json`
- 詳細分析の参照先: `./initial_investigation.md`, `./flow_analysis.md`, `./root_cause_analysis.md`

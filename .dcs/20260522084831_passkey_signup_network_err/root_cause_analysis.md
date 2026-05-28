# 詳細原因分析 — passkey 新規作成 Network Error

**実施日時**: 2026-05-22 09:30 JST
**分析者**: Claude Code

[← インデックスに戻る](./index.md)

---

## 分析サマリー

`customer-app`（および同設計の `staff-app`）の Smart Account 新規作成が「Network Error」で失敗する。原因は**単一バグではなく、開発者ユースケース「devcontainer 内で `pnpm --filter customer-app dev` → ホスト OS の Chrome から `http://localhost:5173` を開く」に対する経路設計の欠落（複合構造）**である。

- 要因 A: devcontainer 内で `scripts/rpc-https-proxy.mjs` を spawn する経路が `pnpm dev` ライン側に存在しない。
- 要因 B: 仮に A を解消しても `server.listen(LISTEN_PORT, "127.0.0.1", ...)` （`scripts/rpc-https-proxy.mjs:61`）で **devcontainer 内の loopback** のみに bind するうえ、`.devcontainer/devcontainer.json:13` の `forwardPorts: [5173, 5174, 8000]` に **8443 が含まれない**ため、ホスト OS Chrome から透過アクセスできない。
- 設計上の準備物 `.devcontainer/Caddyfile.host` は存在するが、CLAUDE.md / `package.json` の dev フロー / アプリ `.env` の案内コメントとつながっていない。

→ 主原因は **「HTTPS RPC proxy の起動と到達経路の確立が dev 起動スクリプトに統合されていない」**。`smart-account-kit` 0.3.0 は `new RpcServer(config.rpcUrl)`（`.oz-build/smart-account-kit/src/kit.ts:363`）で **絶対 https URL** を必須とし、`allowHttp` を通せない仕様のため、proxy 不在で前進不可能。

推奨修正: **案3（Vite 統合）** を採用しつつ、kit が absolute URL を要求する制約により、Vite を **HTTPS dev サーバ**化して **自 origin 上に `/rpc` を Vite `server.proxy` で transparent 中継**する。これによりホスト/コンテナの 127.0.0.1 不一致・8443 forward 漏れ・自己署名証明書の二重提示の三つを同時に解消できる。

---

## 原因候補の評価（最終）

### 候補1: `scripts/rpc-https-proxy.mjs` が dev 起動時に未起動（要因 A）

- **確度: ⭐⭐⭐⭐⭐（確定 — ユーザ証言＋コード根拠）**
- 証拠:
  - 唯一の listener: `scripts/rpc-https-proxy.mjs:61` `server.listen(LISTEN_PORT, "127.0.0.1", ...)`。
  - spawn 元: `scripts/sa-setup.mjs:58`、`scripts/smoke-customer-app.mjs:60-63`、`scripts/smoke-staff-app.mjs:75-77`、`e2e/global-setup.ts:119-122`。**4 つだけ**。
  - `package.json:9` `"dev:customer": "pnpm --filter customer-app dev"` は proxy を起動しない。`apps/customer-app/package.json` も `dev: "vite"` のみ、`apps/customer-app/vite.config.ts` も `react()` プラグインのみ（4 行）。pre/post / plugin / middleware 一切なし。
- 症状との整合: `getContractWasmByHash → getLedgerEntries → axios POST https://127.0.0.1:8443/rpc` が即 `ERR_CONNECTION_CLOSED` で失敗するのは「listener 不在で TCP RST」と一致。

### 候補2: proxy が起動しても devcontainer ↔ ホスト loopback の不一致（要因 B）

- **確度: ⭐⭐⭐⭐⭐（確定 — コード根拠）**
- 証拠:
  - `scripts/rpc-https-proxy.mjs:61` は明示的に第 2 引数 `"127.0.0.1"` を渡している（devcontainer の loopback のみ bind）。
  - `.devcontainer/devcontainer.json:13` `forwardPorts: [5173, 5174, 8000]` に **8443 が無い**。VS Code Remote のフォワード対象でないため、ホストから container の 8443 へは届かない。
  - ホスト OS の Chrome は `127.0.0.1:8443` を **ホスト自身の loopback** として解決するが、ホスト側に listener は居ない（`.devcontainer/Caddyfile.host` を手動 `caddy run` するまでは）。
- 症状との整合: 要因 A を直して container 内 proxy が動いても、ホスト Chrome からはやはり接続不能になる。

### 候補3: `.devcontainer/Caddyfile.host` の運用ギャップ

- **確度: ⭐⭐⭐（確定 — 設計素材があるのに dev フローに繋がっていない）**
- 証拠:
  - `.devcontainer/Caddyfile.host:6` コメント `# Run on host Mac: caddy run --config .devcontainer/Caddyfile.host` のみ。CLAUDE.md / README / `apps/*/.env`（`.env:4` の案内コメント） / `package.json` のいずれにも誘導なし。
  - Caddyfile の `local_certs` を使うため、ホスト OS の Chrome の信頼ストアにルート CA を入れる必要がある。これも dev 起動ドキュメントに記述なし。
- 既存解として A+B を一気に解決し得るが、**ホスト側手作業 + 証明書信頼設定**という追加コストがある。

### 候補4: 自己署名証明書がブラウザ未信頼（候補 5 だった証明書単独要因 — 派生）

- **確度: ⭐⭐⭐（保留、複合内の従属要因）**
- 証拠: `scripts/rpc-https-proxy.mjs:29-30` が `tools/sa-harness/proxy-{key,cert}.pem` を読む自己署名 / `scripts/sa-setup.mjs:89` 周辺で Playwright は `ignoreHTTPSErrors: true` で回避。ホスト Chrome は手動で `thisisunsafe` を踏むか CA をインストールしないと連続接続を保てない。
- 単独で主因にはならない（A/B が立てば証明書層に進む）。修正案 1 を採るなら追加で対処が要る。

---

## 除外した候補（単独主因にならないもの）

| 除外候補 | 除外理由（コード根拠） |
|---|---|
| `.env` の `VITE_RPC_URL` 設定ミス | `apps/customer-app/.env:7-8` で `VITE_RPC_URL=VITE_RPC_PROXY_URL=https://127.0.0.1:8443/rpc` が一貫。`packages/sdk/src/config.ts:60-62` `apps/customer-app/src/lib/passkey.ts:25-32` も整合。設定経路に矛盾なし。 |
| `accountWasmHash` / `webauthnVerifierAddress` 未設定 | `apps/customer-app/.env:17-18` 設定済。`packages/sdk/src/smart-account.ts:62-69` の early throw を通過するから、スタックが kit 内の `buildDeployTransaction` 段まで到達している（事実）。 |
| `pubKeyCredParams ES256/RS256 missing` 警告 | SimpleWebAuthn 由来の WebAuthn 警告。パスキー作成自体は完了し、その後の RPC 叩きで失敗。本症状とは独立。 |
| Vite HMR `ws://localhost:5173 failed` | 本症状の axios POST 経路と独立。 |
| 証明書未信頼 単独 | A/B が解消されない限り検証不能。複合の一段下の従属要因。 |
| kit の指定 `rpcUrl` 形式 | `.oz-build/smart-account-kit/src/kit.ts:355,361,363` で `config.rpcUrl` を string でそのまま `new RpcServer(...)` に渡すのみ。値の渡し方に問題はない。問題は「指している先に listener が居ない」点。 |

---

## 根本原因の特定（複合原因の発生メカニズム）

**根本原因（一文）**: 「ホスト OS ブラウザで devcontainer 内 Vite dev サーバを開く」開発フローに対し、HTTPS RPC proxy の**起動経路**と**ネットワーク到達経路**を整備したパスが dev サーバ起動スクリプトに存在しない。

### 発生メカニズム（ステップ）

1. ユーザがホストの Chrome で `http://localhost:5173` を開く（`devcontainer.json:13` の `forwardPorts: 5173` で透過 → OK）。
2. customer-app の React モジュールがロードされ、`apps/customer-app/src/lib/passkey.ts:32` の **トップレベル副作用** `setConfig({ ...TESTNET_CONFIG, rpcUrl: "https://127.0.0.1:8443/rpc" })` が実行される。
3. AuthProvider マウント（`apps/customer-app/src/contexts/AuthContext.tsx:53-75`）で `connectExisting()` が呼ばれるが、IndexedDB セッション無し + try/catch サイレント握り潰し（`AuthContext.tsx:66-68`）で UI には何も出ない。**ここで既に同 URL の axios は失敗している**が開発者は気付かない。
4. ユーザが「パスキーで新規作成」を押す → `LoginPage.tsx:18 → AuthContext.tsx:78 → passkey.ts:61 kit.createWallet(...)`。
5. kit は `createPasskey` で WebAuthn を成功させたあと、`buildDeployTransaction → specFromWasmHash → getContractWasmByHash(VITE_ACCOUNT_WASM_HASH) → getLedgerEntries`。
6. `.oz-build/smart-account-kit/src/kit.ts:363` `this.rpc = new RpcServer(config.rpcUrl)` の RpcServer は `https://127.0.0.1:8443/rpc` に対し axios POST を発行。
7. ホスト Chrome 視点では `127.0.0.1:8443` = ホスト loopback。**要因 A（proxy 未起動）＋ 要因 B（コンテナ内に立てても 8443 が forward されない）の組合せで listener 不在** → TCP RST → `ERR_CONNECTION_CLOSED` → axios `Error("Network Error")` を throw。
8. `passkey.ts:61` `AuthContext.tsx:77-86` のどちらも catch せず rethrow → `LoginPage.tsx:19-22` の catch が `setError(e.message)` で **axios の "Network Error" 文字列をそのまま UI 表示**（原因切り分け情報なし）。

---

## 詳細コード検証

### a) `scripts/rpc-https-proxy.mjs:61` の bind

```js
server.listen(LISTEN_PORT, "127.0.0.1", () => { ... });
```
- 第 2 引数 `"127.0.0.1"` で **devcontainer 内ループバック専用**。Docker / OrbStack の port 公開 (`-p 8443:8443`) があっても、bind が `127.0.0.1` だとホストには出ない。
- `"0.0.0.0"`（または env で切替）に広げないと外部から接続できない。なお現状の `LISTEN_PORT` は env `PROXY_PORT` で上書き可だが、bind ホスト名は env 化されていない。
- セキュリティ影響: localnet 専用 / dev のみ / TLS 終端 + CORS `*` の単純 reverse proxy。devcontainer 外 = 開発者のホスト OS。**dev コンテキストでは許容**だが、本番設定とは混ぜないこと（コメント明記が望ましい）。

### b) `apps/customer-app/.env:7-8` の URL 解釈

```env
VITE_RPC_URL=https://127.0.0.1:8443/rpc
VITE_RPC_PROXY_URL=https://127.0.0.1:8443/rpc
```
- ブラウザ JS にとって `127.0.0.1` は「ブラウザを実行している OS の loopback」。**proxy が container 内 127.0.0.1 で待つ場合、ホスト Chrome からは届かない**。
- これを解消するには (i) Vite に proxy を肩代わりさせ relative `/rpc` に書き換える、(ii) ホスト loopback でも待たせる（forward + bind=0.0.0.0、または Caddyfile.host）、のいずれか。

### c) `.devcontainer/devcontainer.json:13` の forwardPorts

```json
"forwardPorts": [5173, 5174, 8000],
```
- 8443 が無いので proxy を 0.0.0.0 で立てても VS Code Remote のフォワードが効かない。修正案 1 を採るならここに 8443 を足す必要がある。なお `otherPortsAttributes.onAutoForward: "ignore"`（行 26）があるため自動フォワードも抑止されている。

### d) `apps/customer-app/vite.config.ts`（全 7 行）

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });
```
- `server.proxy` / `server.https` 一切なし。Vite 統合案（案 3）を採るならここを拡張。

### e) `.devcontainer/Caddyfile.host` の現状

```
{ local_certs; auto_https disable_redirects }
localhost:8443, 127.0.0.1:8443 { ... reverse_proxy http://localhost:8000 ... }
```
- ホスト Mac で `caddy run --config .devcontainer/Caddyfile.host` する想定。`local_certs` で Caddy ローカル CA を発行 → ホストの Chrome に CA を信頼させる必要あり。
- OrbStack で `stellar-localnet:8000` がホスト `localhost:8000` に publish されることを前提（コメントに明記）。
- 現状 `pnpm dev` フローからは案内されない（候補 3）。

### f) kit が absolute URL を要求する制約

`.oz-build/smart-account-kit/src/kit.ts:355,361,363`:
```ts
if (!config.rpcUrl) throw new Error("rpcUrl is required");
this.rpcUrl = config.rpcUrl;
this.rpc = new RpcServer(config.rpcUrl);
```
`@stellar/stellar-sdk` の `rpc.Server` は コンストラクタで URL を `new URL(...)` 風にパースし、http スキームかつ `allowHttp` false で throw する。**kit は `allowHttp` を渡せない**ため、`http://...` も `/rpc` のような相対も渡せない。→ 案 3 でも Vite を `server.https: true` で立て、`rpcUrl: "https://localhost:5173/rpc"` のように **アプリ自身の origin の https** を渡す必要がある（Vite が `/rpc` を `server.proxy` で `http://stellar-localnet:8000/rpc` に転送）。

---

## 影響範囲

| 対象 | ホスト OS Chrome から開いた場合の症状 | 根拠 |
|---|---|---|
| `apps/customer-app` (5173) | **失敗（本症状）** | 本ドキュメント全体 |
| `apps/staff-app` (5174) | **同じ症状になる** | `apps/staff-app/src/lib/passkey.ts:27-51` で同パターン（`VITE_RPC_PROXY_URL` 経由）。`.env` の URL も同じ。proxy spawn を行うのは smoke-staff-app / e2e/global-setup のみ。 |
| `tools/sa-harness` (5180) | **`sa-setup.mjs` 経由なら OK** | `scripts/sa-setup.mjs:58-64` が proxy を spawn してから harness を立てる Playwright 経路。手動 `pnpm --filter sa-harness dev` を**ホスト Chrome で**開けば同様に失敗するはず（同じ env を参照）。 |
| Playwright E2E (`pnpm test:e2e`) | **OK** | `e2e/global-setup.ts:119-122` が proxy spawn ＋ Playwright `ignoreHTTPSErrors: true`。devcontainer 内同居なので 127.0.0.1 もループバック整合。 |
| `scripts/smoke-customer-app.mjs` / `smoke-staff-app.mjs` | **OK** | proxy spawn + 同居の Chromium (`ignoreHTTPSErrors: true`)。 |

→ 影響は 2 アプリ + harness の「手動 dev 起動 × ホスト OS ブラウザ」シナリオ。自動テストは無影響（既に回帰防止資産として機能）。

---

## 関連する問題点（類似コード箇所）

- **`apps/staff-app/src/lib/passkey.ts:44-51`**: customer-app と同様に `setConfig` トップレベル副作用で `VITE_RPC_PROXY_URL || VITE_RPC_URL || "https://127.0.0.1:8443/rpc"`。staff-app 単独 dev 起動でも同症状になる（要修正対象）。
- **`apps/customer-app/src/contexts/AuthContext.tsx:66-68`**: `connectExisting` 失敗のサイレント握り潰し。同じ要因が起動時にも発火しているはずだが、開発者がコンソールを覗かない限り顕在化しないため切り分けを遅らせる。
- **`apps/customer-app/src/pages/LoginPage.tsx:19-22`**: axios の `Error.message="Network Error"` をそのまま画面表示。原因切り分けにつながる情報がゼロ。
- **`apps/customer-app/.env:4` のコメント**: `Run node scripts/rpc-https-proxy.mjs so https://127.0.0.1:8443/rpc forwards to http://stellar-localnet:8000/rpc.` ← 「devcontainer 内で実行」「ホスト Chrome の場合」の差異に触れていない。

---

## テストケースの検証（既存カバレッジ）

| 既存テスト | 何を担保しているか | 本症状の再発防止に効くか |
|---|---|---|
| `e2e/customer-app.spec.ts`（globalSetup 経由）| 同一 devcontainer 内で proxy spawn + 5173 + WebAuthn 仮想認証器を CDP で注入し、`createWallet` の RPC 経路まで全部通る | **proxy が落ちる / kit の URL が破綻するレベルなら検知**。ただし「ホスト OS ブラウザシナリオ」は対象外（同居前提）。 |
| `e2e/staff-app.spec.ts` | 同上の staff 経路 | 同上 |
| `scripts/smoke-customer-app.mjs` / `smoke-staff-app.mjs` | proxy + Vite + 仮想認証器の最小スモーク | 同居前提では強い回帰防止。**新規ホストブラウザ運用パスは未カバー**。 |
| `cargo test`（46 テスト）| Soroban 契約レイヤー | 本症状とは独立 |

→ 自動テスト群は「one-shot pipeline」運用を担保しているが、**「ホスト OS Chrome で 5173 を開く」運用パスを担保するテストは存在しない**。修正後はそれを足すか、運用ドキュメントで担保する必要がある。

---

## 修正の方向性（3 案の比較）

### 案1: dev 起動を統合したラッパースクリプト + bind/forward 拡張

実装:
- `package.json` に `"dev:customer": "node scripts/dev-with-proxy.mjs customer-app"`（または concurrently）を追加し、proxy + Vite を同一スクリプトで spawn / 終了する。
- `scripts/rpc-https-proxy.mjs:61` の bind を `process.env.PROXY_HOST || "0.0.0.0"` 切替可に変更（dev 限定の説明コメント付き）。
- `.devcontainer/devcontainer.json:13` の `forwardPorts` に **`8443`** を追加。
- 自己署名証明書の信頼: 既存 `tools/sa-harness/proxy-cert.pem` をホスト Chrome に手動信頼 or `--ignore-certificate-errors`、または `mkcert localhost 127.0.0.1` で再発行。

メリット: 既存 proxy / 証明書 / env をほぼ流用、変更箇所局所。E2E は無影響。
デメリット: ホスト Chrome での **証明書信頼ステップ**が依然手作業。設定が「コンテナ内 0.0.0.0 bind + ホスト forward + 証明書例外」3 段で残る。

実装例（要点）:
```js
// scripts/rpc-https-proxy.mjs (差分)
const LISTEN_HOST = process.env.PROXY_HOST || "0.0.0.0"; // dev only
server.listen(LISTEN_PORT, LISTEN_HOST, () => { ... });
```
```json
// package.json (差分)
"dev:customer": "concurrently -k -n proxy,app \"node scripts/rpc-https-proxy.mjs\" \"pnpm --filter customer-app dev\"",
```
```json
// .devcontainer/devcontainer.json
"forwardPorts": [5173, 5174, 8000, 8443],
```

### 案2: `.devcontainer/Caddyfile.host` を正式運用パスに

実装:
- README / CLAUDE.md に「ホスト Mac で `caddy run --config .devcontainer/Caddyfile.host` を別途起動。Caddy local CA をホスト Chrome に信頼させる (`caddy trust`)」を明文化。
- `package.json` `dev:customer` で `caddy` の存在チェックを `preDev` で実行し未起動なら案内するヘルパー (`scripts/check-host-caddy.mjs` 新設) を入れる。

メリット: 証明書は Caddy local CA（一度信頼すれば永続）で根本解決。container 側に何も足さなくて済む。
デメリット: **ホスト OS で常時 caddy run する負担**。OS 差（Linux/Mac/Windows）、Caddy 未インストール、CA インストール手順差が運用コストとして残る。dev 起動が「2 つのターミナル + 1 つの OS 設定」となる。

### 案3: Vite に統合（kit 制約に合わせて HTTPS dev サーバ + server.proxy）★ 推奨

実装:
- `apps/customer-app/vite.config.ts` を拡張:
  - `server.https = true` を設定（Vite 5 / 6 は `@vitejs/plugin-basic-ssl` または `server.https: { key, cert }` 指定で OK。既存 `tools/sa-harness/proxy-cert.pem` を流用しても可）。
  - `server.proxy = { "/rpc": { target: "http://stellar-localnet:8000", changeOrigin: true, secure: false } }`。
- `apps/customer-app/.env`:
  - `VITE_RPC_URL=https://localhost:5173/rpc` に変更（ホスト Chrome と devcontainer 内ブラウザの**どちらでも自 origin に解決**される）。
  - `VITE_RPC_PROXY_URL` は同値か削除。
- `apps/staff-app/vite.config.ts` / `.env` も同様に。
- `scripts/rpc-https-proxy.mjs` は **E2E / smoke / sa-setup のために残す**（既存テスト互換）。新規の手動 dev フローでは使わない。

メリット:
- (a) ホスト Chrome 視点でも devcontainer ブラウザ視点でも `https://localhost:5173` で完結。**127.0.0.1 二重 loopback 問題が消滅**。
- (b) **証明書はアプリ origin と同一**になるため、Chrome の HSTS / Mixed Content 警告も統一。`@vitejs/plugin-basic-ssl` を使えば証明書例外の手動許可が 1 回で済む。
- (c) `forwardPorts: 8443` 追加が不要、Caddyfile.host の運用が不要、`rpc-https-proxy.mjs` の起動も不要。**運用負担が消える**。

検証ポイント（コード根拠あり）:
- kit は `new RpcServer(config.rpcUrl)` に **string をそのまま渡す**だけ（`.oz-build/smart-account-kit/src/kit.ts:363`）なので、`"https://localhost:5173/rpc"` という string を渡すこと自体に問題は無い。
- `@stellar/stellar-sdk` の `rpc.Server` は `URL(rpcUrl)` で host/path を解釈し、axios で `${origin}${path}` に POST する。Vite の `server.proxy` は **POST + JSON body も普通に転送**するので機能要件は満たす（CORS は同一 origin になるので問題なし）。
- HMR の `ws://` は `server.https: true` だと `wss://localhost:5173` に自動で切り替わるため別件の HMR ws 警告も解消される。

実装例（要点）:
```ts
// apps/customer-app/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    https: true,
    proxy: {
      "/rpc": { target: "http://stellar-localnet:8000", changeOrigin: true, secure: false },
      "/friendbot": { target: "http://stellar-localnet:8000", changeOrigin: true, secure: false },
    },
  },
});
```
```env
# apps/customer-app/.env
VITE_RPC_URL=https://localhost:5173/rpc
VITE_RPC_PROXY_URL=https://localhost:5173/rpc
VITE_FRIENDBOT_URL=https://localhost:5173/friendbot
```

懸念と緩和:
- Vite `server.https + plugin-basic-ssl` の自己署名は依然「初回に Chrome の警告ページを 1 回踏む」必要あり。これは **アプリ origin 自体の警告と統一**されるため UX の総量は減る。
- `forwardPorts: [5173]` は **5173 を https で公開**することになるが、現状 http 5173 を https に変えるだけで devcontainer 側の追加設定は不要。
- staff-app も同様の修正が必要（運用パスを揃える）。
- 既存 E2E / smoke は `https://127.0.0.1:8443/rpc` を proxy 経由で叩く構成のまま動く（global-setup が proxy を立てるため、env の差し替えだけ気をつければ無影響）。**E2E 側のみ `VITE_RPC_URL` を override** する形にすれば移行が安全。

### 推奨

**案3 を第一候補に。** 理由:
- 127.0.0.1 二重 loopback 問題（要因 B）が**設計レベルで消える**。
- proxy プロセス起動の運用（要因 A）が**手動 dev フローでは不要**になる。
- 証明書信頼が **アプリ origin と同一になり 1 回で済む**。
- 既存 E2E / smoke / `sa-setup.mjs` は別 env で `https://127.0.0.1:8443/rpc` を使い続ければよく、回帰防止資産を温存できる。

ただし案 1 はバックアップとして実装コストが低いので「最小修正だけ先に出す」運用なら案 1 で凌ぎ、後で案 3 に寄せるのも可。案 2 は OS 設定負担が大きいため非推奨。

---

## 応急処置と恒久対策

### 応急処置（コードを触らずに今すぐ動かす）

1. **devcontainer 内で**別ターミナルを開き `node scripts/rpc-https-proxy.mjs` を起動。
2. **ホスト Mac でも**別途 `caddy run --config .devcontainer/Caddyfile.host` を起動（要 `caddy` インストール + `caddy trust`）。
3. ホスト Chrome で `https://localhost:8443/rpc` を開いて `thisisunsafe` で証明書を許可。
4. その後改めて `http://localhost:5173` で「パスキーで新規作成」。

→ A と B の両方を手作業で埋める形。OS と CLI 依存があるため恒久解にはならない。

### 恒久対策

- 案 3 を実装（Vite HTTPS dev + `/rpc` proxy）。
- 並行して以下の **UX / 診断改善** を入れる:
  - `apps/customer-app/src/pages/LoginPage.tsx:19-22` の `"Network Error"` 表示を「Soroban RPC エンドポイント (`<rpcUrl>`) に到達できません。`https://localhost:5173/rpc` が利用可能か確認してください。」のような原因ヒント付きに置き換え。
  - `apps/customer-app/src/contexts/AuthContext.tsx:66-68` のサイレント catch を `console.warn(...)` 付きに（本番でも害が少ない情報量）。
  - `apps/customer-app/.env` のコメントを案 3 の構成に合わせて書き換え（127.0.0.1:8443 の言及を撤去 or「E2E 用」と注記）。

---

## 再発防止策

1. **dev 起動の単一エントリ化**: `package.json` `dev:customer` / `dev:staff` を「proxy or Vite proxy 統合」のどちらか一本に揃え、開発者が「proxy を別端末で立てる」必要を排除。
2. **ホスト OS Chrome シナリオの smoke**: `scripts/smoke-customer-app.mjs` は devcontainer 同居前提の Chromium だが、これを CI（GitHub Actions など）で常時実行し、proxy or Vite 統合の経路を壊した PR を弾く。
3. **エラー UX**: axios の `error.message` を素通しで表示しない。`apps/customer-app/src/pages/LoginPage.tsx` と `apps/staff-app/src/pages/LoginPage.tsx` で「ネットワーク到達不能か証明書未信頼かの 2 種を切り分けるメッセージ」へ。
4. **ドキュメント**: CLAUDE.md「Gotchas」に「ホスト OS Chrome で dev を開く場合の必須セットアップ」を追記（または案 3 で不要化したことを明記）。
5. **`.devcontainer/Caddyfile.host` の去就を明確化**: 案 3 採用後はレガシー扱いの注記を入れる、または削除する。

---

## 検証手順（修正後の手動確認）

### 案 3 採用時

1. `bash scripts/deploy-localnet.sh && bash scripts/generate-bindings.sh`（既存の one-shot 前半）。
2. `pnpm --filter customer-app dev`（**proxy 別起動なし**）。
3. ホスト Chrome で `https://localhost:5173` を開く（初回のみ自己署名警告を許可）。
4. 「パスキーで新規作成」→ ダイアログ承認 → ホーム画面が表示されればアウト。
5. DevTools Network で `POST https://localhost:5173/rpc`（→ Vite proxy 経由で 8000 へ）が 200 で帰っていることを確認。
6. `pnpm test:e2e` を流して既存 E2E が壊れていないことを確認（global-setup が立てる proxy パスは独立して維持）。

### 案 1 採用時

1. `forwardPorts` に 8443 を追加 → VS Code Remote を一旦リロード（Rebuild なしでも `Ports` パネルの追加で十分なケースあり）。
2. `pnpm dev:customer`（concurrently で proxy + Vite が起動）。
3. ホスト Chrome で `https://127.0.0.1:8443/rpc` を一度開いて証明書例外を許可。
4. ホスト Chrome で `http://localhost:5173` を開き「パスキーで新規作成」を実行。
5. 同上で Network パネル確認。

---

## 結論

- 根本原因は **複合**: (A) proxy 未起動 + (B) `127.0.0.1` bind と `forwardPorts` 8443 欠落で **ホスト OS Chrome から到達不能**。`.devcontainer/Caddyfile.host` という素材はあるが dev フローから案内されていない。
- 単独で direct fix できる主因は無く、A/B のどちらか一方を直しても通らない。**dev 起動経路の再設計**が必要。
- 推奨修正は **案 3（Vite HTTPS dev + `/rpc` proxy）**。`apps/*/vite.config.ts` と `.env` の小さい変更で、proxy プロセス・8443 forward・loopback 不一致・自己署名 2 重信頼の全部が解消される。

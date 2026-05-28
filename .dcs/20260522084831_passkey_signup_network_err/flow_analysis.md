# 処理フロー分析 — passkey 新規作成 Network Error

**実施日時**: 2026-05-22 08:55 JST
**分析者**: Claude Code

[← インデックスに戻る](./index.md)

---

## 分析対象

customer-app（`apps/customer-app`、Vite dev サーバ port 5173、**ホスト OS の Chrome から開いている**）でログインフォームの「パスキーで新規作成」を押すと、パスキーダイアログ完了直後に画面下に `Network Error` カードが表示される。

ユーザから新たに判明した事実:

1. `scripts/rpc-https-proxy.mjs` は起動していない（`pnpm --filter customer-app dev` を単独実行）。
2. ブラウザは devcontainer の外（ホスト OS）。
3. ホスト OS で `https://127.0.0.1:8443/rpc` を開いても接続できない。

→ 原因は単一ではなく **複合**。
- A. devcontainer 内 proxy 自体が未起動。
- B. proxy が起動しても、`scripts/rpc-https-proxy.mjs:61` で `127.0.0.1` バインド限定のため、ホスト OS の `127.0.0.1:8443` には届かない。ホスト側で TLS 終端する仕組み（`.devcontainer/Caddyfile.host`）が**別に必要**だが、それは README/CLAUDE.md でも `pnpm dev` でも案内されていない。

---

## エントリーポイント

| # | ファイル / 行 | 役割 |
|---|---|---|
| E1 | `apps/customer-app/src/pages/LoginPage.tsx:13-26` | 「パスキーで新規作成」ボタン押下 → `handleCreate` → `login(name)` |
| E2 | `apps/customer-app/src/contexts/AuthContext.tsx:77-86` | `login` callback → `registerPasskeyWallet(name)` |
| E3 | `apps/customer-app/src/lib/passkey.ts:57-62` | `registerPasskeyWallet` → `ensureKit()` → `kit.createWallet(APP_NAME, name, { autoSubmit: true })` |
| E4 | （kit 内部 / バンドル）| `createWallet → buildDeployTransaction → deploy → specFromWasmHash → getContractWasmByHash → getLedgerEntries → axios POST https://127.0.0.1:8443/rpc` |

モジュール副作用エントリ:
- `apps/customer-app/src/lib/passkey.ts:25-32` — `proxyUrl = env.VITE_RPC_PROXY_URL || env.VITE_RPC_URL || "https://127.0.0.1:8443/rpc"` を組み立て、`setConfig({ ...TESTNET_CONFIG, rpcUrl: proxyUrl })` を**トップレベルで実行**。
- `apps/customer-app/src/contexts/AuthContext.tsx:53-75` — AuthProvider マウント時に `connectExisting()` を呼ぶ。IndexedDB に既存セッションが無ければ kit の WebAuthn 取得段で抜けるので、初回はネットワーク発火しないことが多い。失敗は `try { } catch { }`（行 66-68）で握りつぶされ、UI には出ない。

---

## 処理フローの詳細（ステップ番号付き）

```
[1] ユーザがホスト OS の Chrome で http://localhost:5173 を開く
       └ devcontainer.json:13 forwardPorts: [5173,5174,8000] によりホストにフォワード
[2] React 起動 → AuthProvider マウント → connectExisting() (silent restore)
       └ IndexedDB に保存無し → kit はネットワーク叩く前に null を返すパスで終了
       └ もしネットワークを叩いたとしても catch でサイレント
[3] LoginPage 表示 → ユーザが名前入力 → 「パスキーで新規作成」クリック
[4] LoginPage.handleCreate (LoginPage.tsx:13)
       ├ setBusy("create"); setError(null)
       └ await login(name.trim())                ← LoginPage.tsx:18
[5] AuthContext.login (AuthContext.tsx:77)
       └ const res = await registerPasskeyWallet(name)   ← AuthContext.tsx:78
[6] registerPasskeyWallet (passkey.ts:57)
       ├ ensureKit()                              ← passkey.ts:60
       │    └ kitInitialized=false → createKit()  ← passkey.ts:39
       │         └ new SmartAccountKit({          ← smart-account.ts:72-83
       │             rpcUrl: cfg.rpcUrl,          ← = "https://127.0.0.1:8443/rpc"
       │             ...
       │           })
       │      （IndexedDBStorage で kitInstance を確保）
       └ return kit.createWallet(APP_NAME, name, { autoSubmit: true })   ← passkey.ts:61
[7] kit.createWallet (バンドル内 / smart-account-kit 0.3.0)
       ├ createPasskey: WebAuthn `navigator.credentials.create()`
       │    └ Chrome のパスキー UI が出る → ユーザ承認 → credentialId 確保
       │      （SimpleWebAuthn の pubKeyCredParams 警告は致命ではない）
       ├ buildDeployTransaction
       │    └ deploy / specFromWasmHash
       │         └ getContractWasmByHash(VITE_ACCOUNT_WASM_HASH)
       │              └ getLedgerEntries
       │                   └ axios.post(rpcUrl, { jsonrpc:"2.0", method:"getLedgerEntries", ... })
       │                        ▼
       │                   POST https://127.0.0.1:8443/rpc
       │                        ▼   ← ★ 失敗
       │                   net::ERR_CONNECTION_CLOSED
       │                        ▼
       │              axios が `Error("Network Error")` を throw
[8] エラー伝播
       ├ kit 内に reflexive な fetch リトライは無い（axios 直接、try/catch ラップなし）
       ├ passkey.ts:61 の `return kit.createWallet(...)` は **catch 無し** → そのまま rethrow
       ├ AuthContext.tsx:77-86 の `login` も catch せず rethrow
       └ LoginPage.tsx:19-22 の catch が拾い `setError(e.message)` → "Network Error" が UI 表示
[9] setBusy(null) → ボタン活性化、ユーザは無限再試行可能（症状は再現する）
```

---

## データフローの詳細（特に rpcUrl）

`rpcUrl` がどう構築され、最終的に axios の URL に到達するか:

```
.env (apps/customer-app/.env:7-8)
  VITE_RPC_URL=https://127.0.0.1:8443/rpc
  VITE_RPC_PROXY_URL=https://127.0.0.1:8443/rpc
        │
        ▼ Vite が `import.meta.env` に注入（dev サーバ起動時に env を読む）
        │
        ▼ ① TESTNET_CONFIG 初期化（モジュール ロード時）
packages/sdk/src/config.ts:60-62
  rpcUrl: env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org"
  → currentConfig = TESTNET_CONFIG（行 84）
        │
        ▼ ② passkey.ts のトップレベル副作用で上書き
apps/customer-app/src/lib/passkey.ts:25-32
  proxyUrl = env.VITE_RPC_PROXY_URL || env.VITE_RPC_URL || "https://127.0.0.1:8443/rpc"
  setConfig({ ...TESTNET_CONFIG, rpcUrl: proxyUrl })
  → currentConfig.rpcUrl = "https://127.0.0.1:8443/rpc"
        │
        ▼ ③ createKit() で取り出し
packages/sdk/src/smart-account.ts:58-83
  const cfg = getConfig();
  new SmartAccountKit({ rpcUrl: cfg.rpcUrl, ... })
        │
        ▼ ④ kit 内の RpcServer / axios の baseURL に流入
        │   （バンドル `chunk-S4QUIW2P.js` = @stellar/stellar-sdk、`chunk-B3X4PE45.js` = kit）
        ▼
axios.post("https://127.0.0.1:8443/rpc", <jsonrpc body>)
```

→ 設定経路に**矛盾は無い**。値は一貫して `https://127.0.0.1:8443/rpc`。問題は「その URL の指し先（ホスト OS の loopback）に listener が居ない」点。

参考: `.devcontainer/devcontainer.json:13` の `forwardPorts: [5173, 5174, 8000]` には **8443 が含まれていない**。よって devcontainer 内で proxy を上げてもホスト側 8443 が自動フォワードされない。逆に、ホスト OS のブラウザから見た `127.0.0.1:8443` は「ホスト OS のループバック」であり、そこで何かを聞いてくれるプロセス（`.devcontainer/Caddyfile.host`）が**別途必要**。

---

## 状態変化の追跡

| 時刻 | 状態 | 値 |
|---|---|---|
| マウント直後 | `auth` (AuthContext.tsx:49) | `LOGGED_OUT`（`isLoggedIn:false`, `contractId:null`, ...）|
| マウント直後 | `restoring` (AuthContext.tsx:50) | `true` → `connectExisting()` 完了で `false` |
| `kitInitialized` (passkey.ts:34) | 初期 | `false` |
| `ensureKit()` 1 回目 (passkey.ts:37-43) | 直後 | `true`、`kitInstance` は IndexedDBStorage で確定 |
| WebAuthn UI 承認後 | パスキー credential（OS keychain） | **新規作成済**（ここまでは到達している）|
| WebAuthn UI 承認後 | kit 内 IndexedDB に credentialId 保存？ | createWallet が `autoSubmit:true` で deploy 失敗するため、**永続化されない可能性が高い**（kit は通常 deploy 成功で credential を `setItem` する。0.3.0 のバンドルは未読だが、初期調査と挙動から推定）|
| axios 失敗後 | LoginPage `error` (LoginPage.tsx:9) | `"Network Error"` |
| axios 失敗後 | `auth` | `LOGGED_OUT` のまま（`setAuth` は成功時のみ）|

→ パスキー credential が OS keychain には残り、IndexedDB には残らない可能性 → 次回「パスキーでサインイン」を押しても connect 側でも同じ rpc で死ぬので無関係。ただし**孤児パスキーが端末に蓄積**し続ける副作用は要確認。

---

## 条件分岐の分析

`kit.createWallet` 内部の error path（バンドル化されているため呼び出し論的に推定）:

| 分岐点 | 成立条件 | 観測された分岐 |
|---|---|---|
| `createPasskey` 失敗 | ユーザがダイアログをキャンセル | **不成立**（パスキーは作成された）|
| `specFromWasmHash` の `getContractWasmByHash` 失敗 | RPC が JSON-RPC エラー or ネットワーク失敗 | **成立**（axios "Network Error"）|
| `accountWasmHash` 不在 | env 未設定 | **不成立**（smart-account.ts:62-69、`.env:17` で設定済）|
| `webauthnVerifierAddress` 不在 | env 未設定 | **不成立**（`.env:18`）|
| `autoSubmit:true` で submit 段の失敗 | RPC は live だが simulation 失敗 | **未到達**（その手前で死ぬ）|

→ 失敗は `getContractWasmByHash` 段。`accountWasmHash` 自体は env にあるが、kit はチェーンから WASM をフェッチしてスペックを抽出する。**チェーンに繋がる前に死ぬ**ので localnet 内の `accountWasmHash` の正しさ自体は無関係。

---

## 異常系の処理

- **kit 内のリトライ**: axios 直接 POST、`@stellar/stellar-sdk` の `rpc.Server.getLedgerEntries` も基本リトライしない（バンドル上ロジック未読だが、Network Error が 1 回で UI に到達している事実から明らか）。
- **passkey.ts:61 の catch**: 無い。`return` のまま throw が外へ。
- **AuthContext.login (AuthContext.tsx:77-86) の catch**: 無い。throw が外へ。
- **LoginPage.handleCreate の catch (LoginPage.tsx:19-22)**: `e instanceof Error ? e.message : "Smart Account の作成に失敗しました"`。axios の `Error.message` は `"Network Error"` の文字列固定なので**そのまま表示**される。日本語化されない。
- **AuthProvider 起動時の connectExisting の catch (AuthContext.tsx:66-68)**: 「サイレント」設計。同じ rpcUrl 問題があっても起動時には**ログにも UI にも出ない**（コンソールには axios の network error がブラウザ DevTools にだけ出る）。

---

## 非同期処理の分析

- パスキー UI の `navigator.credentials.create()` は約 1-数秒の対話待ち。**完了直後**に kit は `buildDeployTransaction` を呼び、即 `axios.post` が走る。ユーザ視点では「指紋認証 → 直後に Network Error」となり、symptom と整合。
- React 側: `setBusy("create")` → `await login()` → catch → `setError(...)` → `finally setBusy(null)`。順序的に「作成中...」ボタンラベルが「パスキーで新規作成」に戻る瞬間に `Network Error` カードが現れる。
- AuthProvider の `useEffect` (AuthContext.tsx:53) は `cancelled` フラグで unmount 安全だが、本ケースはマウント維持されたまま失敗するので影響しない。

---

## 初期調査候補の検証と除外

| 候補 | 初期確度 | 検証結果（今回の事実反映） | 最終評価 |
|---|---|---|---|
| 1. `scripts/rpc-https-proxy.mjs` が未起動 | ⭐⭐⭐⭐⭐ | ユーザ証言で **proxy 未起動**確定。`scripts/rpc-https-proxy.mjs:61` が唯一の listener。`pnpm --filter customer-app dev` 側に spawn 無し（`apps/customer-app/package.json` の dev:"vite"、`apps/customer-app/vite.config.ts` プラグイン無し）。 | **確定要因 A**（必要条件）|
| 2. 自己署名証明書がブラウザ未信頼 | ⭐⭐⭐⭐ | proxy 未起動の段では到達せず検証不能。proxy 起動後にもう一段問題化する可能性あり（`Caddyfile.host` の `local_certs` も同種の課題）。 | **保留**（A/B を解消した次の段で再評価）|
| 3. devcontainer ↔ ホスト OS 127.0.0.1 ミスマッチ | ⭐⭐ | ユーザ証言で**ホスト OS ブラウザ**確定。`scripts/rpc-https-proxy.mjs:61` は `127.0.0.1` バインド限定 → devcontainer 外には届かない。`.devcontainer/devcontainer.json:13` の `forwardPorts: [5173,5174,8000]` に **8443 は無い**。`.devcontainer/Caddyfile.host` がホスト側 TLS 終端の仕掛けとして存在するが、CLAUDE.md / README / `pnpm dev` の流れには載っていない。 | **確定要因 B**（必要条件）|

→ **A と B は両方とも独立に成立**しており、どちらか片方を直しても接続は通らない。

---

## フロー分析からの所見（複合原因）

1. **設計上のギャップ**: 現在のリポジトリは「devcontainer 内で `sa-setup.mjs` / Playwright が proxy を spawn する一発実行」を前提としており、開発者が devcontainer 内で手動 `pnpm --filter customer-app dev` を上げる → **ホスト OS の Chrome から開く**、というインタラクティブ運用は実装フォロー外。これを成立させるには:
   - (a) devcontainer 内で proxy を立ち上げる（or apps の dev スクリプトが pre/post で起動する）。**かつ**
   - (b) `.devcontainer/devcontainer.json` の `forwardPorts` に 8443 を追加してホスト OS の Chrome から透過アクセスさせる、**もしくは**
   - (c) `.devcontainer/Caddyfile.host` をホスト OS で `caddy run` し、ホスト側で TLS 終端する（ファイル冒頭コメントが示す手順 — ただし `pnpm dev` の流れには案内が無い）。

2. **`apps/customer-app/.env:7-8` のハードコード `127.0.0.1:8443` がブラウザ実行マシンの loopback を指す**: これは「ブラウザと proxy が**同じマシン**で動く」前提。devcontainer + ホスト OS ブラウザ運用では成立しない。

3. **エラーメッセージが axios の `"Network Error"` 文字列そのまま**（LoginPage.tsx:20-22）。原因（proxy 未起動 / 証明書 / 接続先不一致）の切り分けにつながる情報が UI にもアプリ側コンソールログにも出ない。

4. **AuthProvider 起動時の `connectExisting()` 失敗が完全サイレント**（AuthContext.tsx:66-68）。同じ rpcUrl 問題が起動時にも起きているはずだが、DevTools コンソールにしか出ない → 開発者が「ボタン押下時点で初めて問題が顕在化した」と誤認しやすい。

---

## 次段階で詳しく調べるべき箇所

1. **listener 実状態の検証**: devcontainer 内 `lsof -i :8443` / ホスト OS 側 `lsof -i :8443` の双方。proxy 未起動が確実なら devcontainer 内も空のはず。
2. **`smart-account-kit@0.3.0` バンドル内**の `getContractWasmByHash` 呼び出し箇所（`chunk-B3X4PE45.js` 内）。axios エラーが `Network Error` 文字列でそのまま rethrow される経路を確認 — ラッピング無しの想定で進める。
3. **`scripts/rpc-https-proxy.mjs:61` の bind を `0.0.0.0` に広げる**+ **`devcontainer.json` の forwardPorts に 8443 追加**で「ホスト OS Chrome → forwarded 8443 → container 8443 → http://stellar-localnet:8000」が成立するか（OrbStack の forwardPorts 挙動を含めて確認）。または `.devcontainer/Caddyfile.host` をホスト側で起動するルートのほうが現実的か（`local_certs` の証明書信頼問題は別途あり）。
4. **`apps/customer-app/package.json` の dev スクリプトに proxy を組み込む or Vite middleware に統合する**設計案の妥当性（候補2の証明書信頼を Caddy の `local_certs` で根本対処するか、Vite が `server.https` で自前 TLS を喋るか）。
5. **`AuthContext.tsx:66-68` のサイレント catch を、起動失敗時の診断情報を残す形に修正**するべきか（開発体験）。
6. **孤児パスキー**: deploy 失敗時に OS keychain には残り IndexedDB には残らないかを 0.3.0 ソースで確認。残るなら開発中の credential が大量に溜まる UX 問題あり。

---

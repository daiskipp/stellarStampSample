# バグ初期調査結果

**実施日時**: 2026-05-22 08:48 JST
**分析者**: Claude Code

[← インデックスに戻る](./index.md)

---

## バグの基本情報

### 概要
customer-app (port 5173) でパスキーを使ってアカウントを新規作成しようとすると「Network Error」が表示される。kit (`smart-account-kit` 0.3.0) が `createWallet` → `buildDeployTransaction` → `specFromWasmHash` → `getContractWasmByHash` → axios `POST https://127.0.0.1:8443/rpc` を発行し、それが `net::ERR_CONNECTION_CLOSED` で失敗している。

### バグの種類
**環境依存バグ** が最有力（kit の HTTPS RPC 要求と、ローカル HTTPS プロキシの起動状態 / 証明書信頼の組合せ）。データ / 統合バグの線は低い（コード上の RPC 設定は一貫している）。

### 発生状況
常に発生（customer-app の新規アカウント作成フロー）。

### エラー情報

スタックトレースから注目すべき行:

1. `passkey.ts:61` — `apps/customer-app/src/lib/passkey.ts:61` の `return kit.createWallet(APP_NAME, name, { autoSubmit: true });`
2. `AuthContext.tsx:78` — `apps/customer-app/src/contexts/AuthContext.tsx:78` の `const res = await registerPasskeyWallet(name);`
3. `LoginPage.tsx:18` — `apps/customer-app/src/pages/LoginPage.tsx:18` の `await login(name.trim());`
4. kit 内部: `createWallet → buildDeployTransaction → deploy → specFromWasmHash → getContractWasmByHash → getLedgerEntries → axios POST` → `https://127.0.0.1:8443/rpc` で `net::ERR_CONNECTION_CLOSED`

冒頭の `pubKeyCredParams is missing ... ES256 and RS256` 警告は WebAuthn 側の SimpleWebAuthn 由来の警告で、ネットワーク失敗とは独立した別件（パスキー登録自体は完了している模様 — その後の `buildDeployTransaction` で失敗している）。

### 再現手順
1. localnet を起動した状態で `pnpm --filter customer-app dev` で customer-app を 5173 で起動
2. http://localhost:5173 を開く
3. LoginPage で名前を入力し「パスキーで新規作成」を押す
4. パスキーダイアログ完了直後に `Network Error` カードが表示される

---

## 関連コンポーネント・ファイル

### 主要な関連ファイル

#### [apps/customer-app/src/lib/passkey.ts](../../apps/customer-app/src/lib/passkey.ts)
- 役割: customer-app 側の kit 初期化ラッパー。SDK の `setConfig` で `rpcUrl` を上書きし、`kit.createWallet` を叩く。
- 関連度: 高
- 理由: スタックトレースに `passkey.ts:61` がそのまま現れる。
- 重要なコード箇所:
  - 行 25-32: env から `VITE_RPC_PROXY_URL || VITE_RPC_URL || "https://127.0.0.1:8443/rpc"` を組み立て、`setConfig({ ...TESTNET_CONFIG, rpcUrl: proxyUrl })` で SDK 設定を上書き。
  - 行 57-62 (特に行 61): `return kit.createWallet(APP_NAME, name, { autoSubmit: true });` — `autoSubmit: true` のため kit がそのまま deploy トランザクションを構築・送信。コメント: `localnet's passphrase is not a "Test" network so the kit skips friendbot funding`。

#### [apps/customer-app/src/contexts/AuthContext.tsx](../../apps/customer-app/src/contexts/AuthContext.tsx)
- 役割: ログイン状態管理。`login()` で `registerPasskeyWallet` を呼ぶ。
- 関連度: 高
- 重要なコード箇所:
  - 行 77-86: `login` callback。行 78 で `await registerPasskeyWallet(name)`。失敗時はそのまま `LoginPage` に伝播。

#### [apps/customer-app/src/pages/LoginPage.tsx](../../apps/customer-app/src/pages/LoginPage.tsx)
- 役割: 新規作成 / サインインボタンを持つログイン画面。エラーを catch して `setError(e.message)` で表示。
- 関連度: 高
- 重要なコード箇所:
  - 行 13-26: `handleCreate`。行 18 `await login(name.trim())`、行 19-22 で `e.message` をそのまま表示 → ここに「Network Error」が出る（axios の `error.message` がそのまま流れた典型）。

#### [scripts/rpc-https-proxy.mjs](../../scripts/rpc-https-proxy.mjs)
- 役割: `https://127.0.0.1:8443/*` を `http://stellar-localnet:8000/*` に転送する、TLS 終端付きの単純な HTTPS リバースプロキシ。
- 関連度: 最高
- 理由: kit / `@stellar/stellar-sdk` の `rpc.Server` が `allowHttp` を立てられず plain-http RPC を拒否するためのシム。**起動していないとこの URL は接続自体が成立しない。**
- 重要なコード箇所:
  - 行 27-31: `readFileSync(join(HARNESS, "proxy-key.pem"))` と `proxy-cert.pem` を読み込んで `https.createServer`。自己署名証明書。
  - 行 23-25: 上流 `RPC_UPSTREAM_HOST=stellar-localnet`, `RPC_UPSTREAM_PORT=8000`, 待受 `PROXY_PORT=8443`。
  - 行 61: `server.listen(LISTEN_PORT, "127.0.0.1", ...)` — **`127.0.0.1` バインド限定**（コンテナ外からは見えない / 同一プロセス空間 = devcontainer 内のブラウザからのみアクセス可）。

#### [packages/sdk/src/smart-account.ts](../../packages/sdk/src/smart-account.ts)
- 役割: `SmartAccountKit` の生成 (`createKit` / `getKit`) と `signAndSubmitTx` ラッパー。
- 関連度: 高
- 重要なコード箇所:
  - 行 58-84: `createKit()` は `getConfig()` から `cfg.rpcUrl` を取り、そのまま `new SmartAccountKit({ rpcUrl: cfg.rpcUrl, ... })` に渡す。`accountWasmHash` と `webauthnVerifierAddress` が欠けていれば例外（今回はそこは通過している）。

#### [packages/sdk/src/config.ts](../../packages/sdk/src/config.ts)
- 役割: `TESTNET_CONFIG` を Vite の `import.meta.env` から組み立て、`getConfig() / setConfig()` で公開する。
- 関連度: 中
- 重要なコード箇所:
  - 行 60-62: `rpcUrl: env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org"`。customer-app では `setConfig({ ...TESTNET_CONFIG, rpcUrl: proxyUrl })` で上書きされる。

#### [apps/customer-app/.env](../../apps/customer-app/.env)
- 役割: customer-app の Vite 環境変数。
- 関連度: 高
- 重要な値:
  - 行 7: `VITE_RPC_URL=https://127.0.0.1:8443/rpc`
  - 行 8: `VITE_RPC_PROXY_URL=https://127.0.0.1:8443/rpc`
  - 行 17: `VITE_ACCOUNT_WASM_HASH=8537b8166c0078440a5324c12f6db48d6340d157c306a54c5ea81405abcc2611`
  - 行 18: `VITE_WEBAUTHN_VERIFIER_ADDRESS=CDUK4SK...` (空でない → `createKit` の早期エラーは通過)。
  - 行 24: `VITE_RP_ID=localhost`
- → **env 自体は HTTPS プロキシを指している。指している URL が間違っているのではなく、その URL の listener が居ない / 接続が即切断されている可能性が高い。**

#### [tools/sa-harness/proxy-cert.pem / proxy-key.pem](../../tools/sa-harness/)
- 役割: rpc-https-proxy が読む自己署名証明書。
- 関連度: 高（ブラウザの証明書信頼の前提）。
- 補足: ファイル自体は存在することを確認。

### 補助的な関連ファイル

- [package.json](../../package.json): ルートに `dev:customer` / `dev:staff` はあるが、**プロキシを start するスクリプトは無い**。proxy は `scripts/sa-setup.mjs` / `scripts/smoke-customer-app.mjs` / `scripts/smoke-staff-app.mjs` / `e2e/global-setup.ts` がそれぞれ `spawn` するだけ。`pnpm --filter customer-app dev` 単独では起動しない。
- [apps/customer-app/package.json](../../apps/customer-app/package.json): `dev: "vite"` のみ。pre/post で proxy を立ち上げる仕掛けは無い。
- [apps/customer-app/vite.config.ts](../../apps/customer-app/vite.config.ts): `react()` プラグインのみ。proxy 用設定なし。
- [apps/staff-app/src/lib/passkey.ts](../../apps/staff-app/src/lib/passkey.ts) (行 27-51): customer-app と同じ proxy 前提のコメント。staff 側も同じ HTTPS シムを要求している。
- [scripts/sa-setup.mjs:53-83](../../scripts/sa-setup.mjs) / [e2e/global-setup.ts:119-122](../../e2e/global-setup.ts): proxy を spawn して "rpc-https-proxy:" の起動ログを待つ実装が両方にある。**この同梱が無いのは customer-app の単独 dev だけ。**

---

## 検索キーワードと結果

| キーワード | 検索範囲 | 主な所見 |
|---|---|---|
| `rpc-https-proxy` | repo 全体 | `scripts/rpc-https-proxy.mjs` 本体 / `sa-setup.mjs` `smoke-*.mjs` `e2e/global-setup.ts` の spawn / 各 `passkey.ts` のコメント。**`apps/*/package.json` や `vite.config.ts` には登場しない**（= dev サーバが proxy を子プロセス化しない）。 |
| `VITE_RPC` | `apps` / `packages` | `apps/customer-app/.env` 行 7-8 / `packages/sdk/src/config.ts:61` で参照。proxy URL `https://127.0.0.1:8443/rpc` が一貫して設定済。 |
| `setConfig`, `createKit` | `apps/customer-app/src` | `passkey.ts:32` (`setConfig`)、`passkey.ts:39` (`createKit()`)。`AuthContext` は import 経由でモジュール副作用として実行される（top-level の `setConfig`）。 |
| `proxy-cert.pem`, `proxy-key.pem` | `tools/sa-harness/` | 両ファイル存在を確認。`scripts/rpc-https-proxy.mjs:29-30` で同期 read。 |

---

## コードベース構造の理解

### アーキテクチャ上の位置づけ

```
[ブラウザ(devcontainer内)]
    customer-app (Vite 5173)
        └─ @dicekey/sdk (createKit) ─► smart-account-kit (.oz-build/...)
                                          └─ axios → fetch
                                                ▼
                                    https://127.0.0.1:8443/rpc  ← ★失敗ポイント
                                                ▼
                                  [scripts/rpc-https-proxy.mjs] (TLS 終端, 自己署名)
                                                ▼
                                    http://stellar-localnet:8000/rpc
                                                ▼
                                       Stellar quickstart / Soroban RPC
```

### データフローの概要

```
LoginPage.handleCreate (LoginPage.tsx:13-26)
  ↓ login(name)   ← AuthContext.tsx:77
  ↓ registerPasskeyWallet(name)   ← passkey.ts:57
  ↓ kit.createWallet(APP_NAME, name, { autoSubmit: true })   ← passkey.ts:61
      ├─ createPasskey (WebAuthn / ブラウザ — pubKeyCredParams 警告はここ、致命ではない)
      └─ buildDeployTransaction
          └─ deploy / specFromWasmHash
              └─ getContractWasmByHash(VITE_ACCOUNT_WASM_HASH)
                  └─ getLedgerEntries (axios POST application/json)
                      → POST https://127.0.0.1:8443/rpc
                          ▼
                      ERR_CONNECTION_CLOSED ← TCP は到達したが即 RST/FIN
                          ⇒ axios が "Network Error" を throw
                          ⇒ LoginPage 行 20-22 が e.message をそのまま表示
```

---

## 初期仮説

**確度⭐⭐以上、コード上の証拠がある候補のみ。**

### 候補1: `scripts/rpc-https-proxy.mjs` が起動していない（最有力）
- **確度: ⭐⭐⭐⭐⭐**
- 証拠:
  - `scripts/rpc-https-proxy.mjs:61` で `127.0.0.1:8443` に listen するのはこの 1 プロセスのみ。
  - `apps/customer-app/package.json` の `dev: "vite"` には proxy 起動なし。`vite.config.ts` にも無し。
  - proxy を spawn しているのは `scripts/sa-setup.mjs`, `scripts/smoke-customer-app.mjs`, `scripts/smoke-staff-app.mjs`, `e2e/global-setup.ts` の 4 つだけ。**`pnpm --filter customer-app dev` 単独実行ではどれも起動しない。**
  - 再現手順がまさに `pnpm --filter customer-app dev` で起動した状況。
- バグ症状との関連: `ERR_CONNECTION_CLOSED` は「TCP 接続が確立できないか、確立直後に切られた」典型サインで、リスナー不在 / 即切断と一致。`ERR_NAME_NOT_RESOLVED` でも `ERR_CONNECTION_REFUSED` でもないのが特徴的だが、いずれにせよ「proxy が居れば普通に成立するはず」のリクエストが切れている。
- 検証内容: `lsof -i :8443` / `curl -k https://127.0.0.1:8443/rpc -d '{}'` で listener 有無を確認。ない場合 → `node scripts/rpc-https-proxy.mjs` を別ターミナルで起動して再試行。
- 除外できない理由: 起動済みでも証明書未信頼で類似症状になり得る（→ 候補2）。

### 候補2: 自己署名証明書がブラウザ / Chrome に信頼されていない
- **確度: ⭐⭐⭐⭐**
- 証拠:
  - `scripts/rpc-https-proxy.mjs:29-30` が `tools/sa-harness/proxy-{key,cert}.pem` を読む → 自己署名。
  - `scripts/sa-setup.mjs:89` のコメント: `ignoreHTTPSErrors: the proxy uses a self-signed localhost cert.` ← Playwright (CDP) では `ignoreHTTPSErrors: true` で回避しているが、**ユーザの普通の Chrome では未対応**。
  - localhost → `127.0.0.1` への TLS で証明書が `localhost` 用かどうかも未確認だが、いずれにせよ未信頼のまま `fetch`/`axios` が走ると、Chrome は事前の手動許可 (`thisisunsafe`) を経ない限り接続をクローズする → 結果として `ERR_CONNECTION_CLOSED` / `ERR_CERT_AUTHORITY_INVALID` 系で落ちる。
- バグ症状との関連: Chromium 系では未信頼自己署名 + fetch (no-CORS context) では、まず警告ページを経由しないと接続が成立せず、`net::ERR_CONNECTION_CLOSED` 文字列で表面化することがある。
- 検証内容:
  - 直接 `https://127.0.0.1:8443/rpc` をブラウザで開いて警告画面 → 詳細 → 「アクセスする」を踏むと信頼例外が刻まれる。
  - もしくは Chrome を `--ignore-certificate-errors` で起動。
- 除外できない理由: proxy が起動していれば原因が候補1ではなく候補2側に移る。

### 候補3: customer-app dev サーバが devcontainer 外のホストで動いていて、`127.0.0.1` がコンテナ内 proxy を指せない
- **確度: ⭐⭐**
- 証拠:
  - `scripts/rpc-https-proxy.mjs:61` は `server.listen(LISTEN_PORT, "127.0.0.1", ...)`。**`127.0.0.1` バインド限定**。
  - CLAUDE.md「Gotchas」: 「devcontainer 内では `stellar-localnet:8000`、localhost ではない」とあり、ホスト名前提のミスマッチが起きやすい環境。
  - `apps/customer-app/.env` 行 7-8 は `https://127.0.0.1:8443/rpc` ハードコード。ブラウザの `127.0.0.1` 解釈は「ブラウザ実行中マシンのループバック」。devcontainer のポートフォワード経由でホスト OS の Chrome から開いた場合、ホスト側で 8443 を待っているプロセスは別物。
- バグ症状との関連: ブラウザ実行ホストの 127.0.0.1:8443 に listener が居なければ即 RST → `ERR_CONNECTION_CLOSED`。
- 検証内容: ブラウザが devcontainer 内のものか、ホスト OS のものか確認。後者なら 8443 のフォワード設定が必要。
- 除外できない理由: 候補1と区別がつきにくい — 「proxy は立っているが立っている場所と接続先が違う」ケース。

---

## 次段階の調査方針

### 処理フロー分析で確認すべき点
1. ユーザの実行環境を確認: (a) `pnpm --filter customer-app dev` の起動時に別ターミナルで proxy も起動していたか、(b) Chrome は devcontainer 内（VS Code の Simple Browser 等）か、ホスト OS か、(c) `https://127.0.0.1:8443/rpc` を一度 Chrome で直接開いて証明書例外を許可したか。
2. `kit.createWallet` の deploy 経路で `getContractWasmByHash(VITE_ACCOUNT_WASM_HASH)` が走るため、**最初の HTTP 通信のタイミング** がパスキーダイアログ完了直後（buildDeployTransaction 段）と一致するか確認（スタック上はそう）。
3. `apps/customer-app/src/lib/passkey.ts:32` の `setConfig` は **モジュール top-level の副作用**。AuthProvider が即マウントされ `connectExisting()` を呼ぶ (`AuthContext.tsx:57`) ため、ログイン前にも同 URL に接続が試みられる可能性。コンソール上でログイン前のリクエストも `ERR_CONNECTION_CLOSED` か確認すると、候補1 と 候補2 の切り分けに寄与する（前者なら起動時から、後者なら証明書例外を踏んだ後は成功するはず）。

### 追加で確認すべき情報（ユーザに尋ねたい）
- 別ターミナルで `node scripts/rpc-https-proxy.mjs` を実行していたか。
- `https://127.0.0.1:8443/rpc` を Chrome で直接開き「安全ではないが続行」していたか。
- 使用しているブラウザは devcontainer 内 (Simple Browser / Chromium) か、ホストの Chrome か。

---

## 制限事項
- minified バンドル (`chunk-S4QUIW2P.js` = @stellar/stellar-sdk、`chunk-B3X4PE45.js` = kit / contract-client) の中身は読まなかった。スタック上のシンボル名 (`getContractWasmByHash` / `specFromWasmHash` / `buildDeployTransaction`) から呼び出し経路は同定済。
- 実環境のプロセス起動状況 (`lsof -i :8443` 等) は確認できていない（実行サンドボックス上 `ss`/`netstat` の出力が取れず）。listener の有無は確認したい。
- Chrome の証明書信頼ストアの実状態（self-signed を一度許可しているか）は静的解析では追えない。

---

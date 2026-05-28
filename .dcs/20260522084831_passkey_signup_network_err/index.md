# バグ原因分析 - インデックス

**実施日時**: 2026-05-22 08:48 JST
**分析者**: Claude Code

---

## バグ情報

### 概要
customer-app (port 5173) でパスキー新規アカウント作成時に「Network Error」が発生。`kit.createWallet` 内の `buildDeployTransaction → getContractWasmByHash → getLedgerEntries` が `POST https://127.0.0.1:8443/rpc` を発行し、`net::ERR_CONNECTION_CLOSED` で失敗している。

### 種類
環境依存バグ（kit の HTTPS RPC 要求と、ローカル HTTPS プロキシ (`scripts/rpc-https-proxy.mjs`) の起動状態 / 自己署名証明書信頼の組合せ）。

---

## 分析結果ファイル一覧

### 調査段階
- [初期調査](./initial_investigation.md) - 関連コンポーネントの特定
- [処理フロー分析](./flow_analysis.md) - 完了
- [詳細原因分析](./root_cause_analysis.md) - 完了
- [最終レポート](./final_report.md) - 完了

---

## クイックサマリー

### 根本原因（複合）
- **要因 A**: `pnpm --filter customer-app dev` が HTTPS proxy を起動しない（`apps/customer-app/package.json` の `dev: "vite"`、proxy spawn は sa-setup / smoke / e2e の 4 箇所のみ）。
- **要因 B**: `scripts/rpc-https-proxy.mjs:61` が `127.0.0.1` バインド限定 + `.devcontainer/devcontainer.json:13` の `forwardPorts` に 8443 が無い。ホスト OS Chrome の `127.0.0.1:8443` は到達不能。
- **要因 C**: `.devcontainer/Caddyfile.host` という設計素材はあるが、CLAUDE.md / dev フローから案内されていない。

`smart-account-kit` 0.3.0 (`.oz-build/smart-account-kit/src/kit.ts:363`) は absolute https URL 必須で `allowHttp` を通せないため、proxy 不在では前進不可能。

### 推奨修正
**案 3（Vite 統合）** — `apps/*/vite.config.ts` を `server.https: true` + `server.proxy["/rpc"] → http://stellar-localnet:8000` に拡張し、`apps/*/.env` の `VITE_RPC_URL` を `https://localhost:5173/rpc` (staff は 5174) に変更。proxy プロセス・8443 forward・127.0.0.1 二重 loopback・自己署名二重信頼の 4 つを同時に解消。約半日工数。

### 次のアクション
**最終レポート参照** — 実装ステップ・テスト戦略・staff-app 同期改修・UX エラーメッセージ改善・残課題（孤児パスキー、E2E env override）を整理済み。

---

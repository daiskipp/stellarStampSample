---
id: "001"
title: "justfile に hq-setup-testnet recipe を追加"
status: done
priority: 1
dependencies: []
estimated_complexity: low
---

# Task: justfile に hq-setup-testnet recipe を追加

## Goal

`just hq-setup-testnet` で sa-harness を Testnet モード (`.env.testnet` 読込) の
foreground プロセスとして port 5180 に起動し、ホスト OS の Chrome から
host-browser passkey-driven の HQ ブートストラップ UI を操作できる状態を作る。
`just hq-setup` (localnet) の Testnet 変種にあたり、`rpc-https-proxy.mjs` の
起動は不要。

## Interfaces

justfile recipe ブロック (shell ベースなので "インターフェース" としては
最終的に表に立つ doc 注釈 + 出力メッセージ):

```just
# 🔴 HQ bootstrap UI for Stellar Testnet. UNLIKE `just hq-setup` (localnet),  # 🔵 既存 hq-setup pattern
#    this orphans the previous HQ Smart Account every run — the 5 dicekey
#    contracts must be freshly redeployed via `just deploy-testnet &&
#    just bindings-testnet` BEFORE invoking this recipe, otherwise the new
#    HQ will not be admin of those contracts. No rpc-https-proxy.mjs spawn:
#    Testnet RPC is already HTTPS, and harness branches on the localnet
#    passphrase to skip the proxy layer (tools/sa-harness/src/harness.ts:54-65).
[doc("Start the HQ setup UI for host-browser passkey-driven HQ on Testnet (IRREVERSIBLE)")]  # 🔵 既存パターン
hq-setup-testnet:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "=== HQ-SETUP-TESTNET — IRREVERSIBLE. Creates a NEW HQ Smart Account."  # 🔵 deploy-testnet 慣行
    echo "    Old HQ (if any) becomes orphaned. Prereq: just deploy-testnet &&"
    echo "    just bindings-testnet ran. Ctrl-C within 5s to abort. ==="
    sleep 5
    echo "[just hq-setup-testnet] starting sa-harness --mode testnet on :5180…"
    echo "[just hq-setup-testnet] open http://localhost:5180/ in the host browser,"
    echo "                        then follow docs/dev/plans/hq-setup-testnet/runbook.md."
    pnpm --filter sa-harness dev --mode testnet  # 🔵 既存 sa-harness の `--mode testnet` 経路で動作実績あり
```

信号機:
- 🔵 既存 `hq-setup` / `deploy-testnet` の慣行と完全に同じ骨組み (recipe doc 注釈、`🔴` マーカー、5 秒 abort window、foreground 起動)
- recipe 内 `pnpm --filter sa-harness dev --mode testnet` 経路は `just testnet` で動作実績ありなので不確定要素なし

## Test Strategy

- [ ] `just --list --unsorted` の出力に `hq-setup-testnet` の行が含まれ、doc 文に
      "(IRREVERSIBLE)" を含む `🔴`-class の表示になる
- [ ] `timeout 8s just hq-setup-testnet` を実行すると、最初の 5 秒で
      "=== HQ-SETUP-TESTNET — IRREVERSIBLE..." と "Ctrl-C within 5s to abort"
      のメッセージが標準出力される
- [ ] その後 sa-harness の Vite "Local:   http://127.0.0.1:5180/" が標準出力に
      出る (`just hq-setup` と同じ起動シグネチャ)
- [ ] devcontainer 外の host OS Chrome から `http://localhost:5180/` を開くと
      `#net` パネルが `rpc https://soroban-testnet.stellar.org` /
      `network Test SDF Network ; September 2015` を表示する
      (= `.env.testnet` が確実に読まれている)
- [ ] Ctrl-C で harness が完全に停止し、`ss -ltn 'sport = :5180' 2>/dev/null |
      grep LISTEN` が空文字を返す (port leak なし)
- [ ] `just hq-setup` (localnet 用、既存) を別途実行しても regression がなく、
      proxy 起動 / port 5180 起動が既存挙動通り

## Implementation Notes

- 参照すべき既存コード:
  - `/workspaces/StampSample/justfile` line 84-101 (`hq-setup` recipe) — 骨組みのコピー元
  - `/workspaces/StampSample/justfile` line 39-46 (`deploy-testnet` recipe) — `🔴` マーカー + 5 秒 abort window のパターン
  - `/workspaces/StampSample/justfile` line 178-207 (`testnet` recipe) — `pnpm --filter sa-harness dev --mode testnet` の動作実績
  - `/workspaces/StampSample/tools/sa-harness/src/harness.ts` line 54-65 — Testnet/localnet 分岐 (実装は既に対応済、変更不要)
- 実装のヒント:
  - 既存 `hq-setup` から `rpc-https-proxy.mjs` 関連の 4 行 (proxy 起動 / PROXY_PID / trap / sleep 1) を削る
  - `pnpm dev` を `pnpm --filter sa-harness dev --mode testnet` に置換する
  - foreground 実行 (trap 不要) なのは既存 `hq-setup` と同じ
- 注意事項:
  - 5 秒 abort window は **devcontainer の外から手元の Chrome を起動するまでの時間** にもなり、ユーザが操作タイミングを意識する助けになる。短縮しない
  - `pnpm --filter sa-harness dev` を bg にしない (just hq-setup の慣行)

## Files

- 新規: なし
- 変更: `/workspaces/StampSample/justfile` (末尾、または既存 `hq-setup` の下に追加配置)
- テスト: なし (recipe 自体は shell wrapper のためユニットテスト非適用。Test Strategy の動作確認は手動 + DoD で実機検証)

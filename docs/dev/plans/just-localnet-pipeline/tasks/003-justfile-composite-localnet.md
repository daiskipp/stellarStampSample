---
id: "003"
title: "合成 recipe `just localnet` を実装"
status: done
priority: 2
dependencies: ["002"]
estimated_complexity: medium
---

# Task: 合成 recipe `just localnet` を実装

## Goal

CLAUDE.md の **One-Shot Pipeline (localnet、順序必須)** を `just localnet` 一発で
完走させる。`build → deploy-localnet → bindings` は just の dependency で連結し、
`sa-harness` の background 起動 + ready 待ち + `sa-setup` 実行 + harness kill は
shebang recipe 内の bash で表現する。

## Interfaces

```just
# justfile (Task 002 で作成した内容に追記)

# 🔵 localnet: One-shot pipeline
#   build → deploy-localnet → bindings は just の依存で連鎖
#   harness を bg spawn → "Local:" を待つ → sa-setup → harness kill
localnet: build deploy-localnet bindings
    #!/usr/bin/env bash
    set -euo pipefail
    HARNESS_LOG=$(mktemp -t sa-harness.XXXXXX.log)
    echo "[just localnet] starting sa-harness (log: $HARNESS_LOG)…"
    pnpm --filter sa-harness dev >"$HARNESS_LOG" 2>&1 &
    HARNESS_PID=$!
    trap 'kill "$HARNESS_PID" 2>/dev/null || true; rm -f "$HARNESS_LOG"' EXIT
    for _ in $(seq 1 40); do
        grep -q "Local:" "$HARNESS_LOG" && break
        sleep 1
    done
    sleep 2
    echo "[just localnet] running sa-setup…"
    node scripts/sa-setup.mjs
    echo "[just localnet] done."
```

> 信号機:
> - `localnet: build deploy-localnet bindings` の依存連鎖 🔵 — CLAUDE.md 順序必須記述に直対応
> - harness を bg spawn → "Local:" needle で待機 🟡 — `e2e/global-setup.ts:49 waitForStdout` の bash 移植。timeout 40 秒は同 ts ファイルの定数
> - `trap` で harness kill 🟡 — recipe 失敗時の port 5180 リーク防止
> - `sleep 2` 🟡 — Vite が "Local:" 出力後にもう少しだけ socket bind 待つ（global-setup.ts:157 と同義）

## Test Strategy

- [ ] **DoD 等価性**: 既存 CLAUDE.md 手順を全部手で叩いた結果と `just localnet` の結果が一致
  - `tools/sa-harness/fixtures.json` に HQ SA / customer SA / 1 stamp が記録される
  - `.env.localnet` の `VITE_HQ_SMART_ACCOUNT`, `VITE_DEMO_CUSTOMER_SA` 等が埋まる
- [ ] **依存連鎖**: `just localnet` 実行時、先に `stellar contract build` → `scripts/deploy-localnet.sh` → `scripts/generate-bindings.sh` が走る（出力で確認）
- [ ] **harness ready 検知**: `Local:` を 40 秒以内に検知し、`sa-setup` 開始まで進む
- [ ] **後片付け**: 完走後 / 失敗後ともに harness プロセスが残らない（`lsof -ti tcp:5180` が空）
- [ ] **エッジケース 1**: 既に :5180 を占有しているプロセスがある状態で `just localnet` を実行 → harness 起動失敗を 40 秒以内に検知し非ゼロで終了
- [ ] **エッジケース 2**: `sa-setup.mjs` がエラーで非ゼロ終了した場合、harness は kill され、`just localnet` も非ゼロ終了

## Implementation Notes

- 参照すべき既存コード:
  - `e2e/global-setup.ts:49-77`（waitForStdout の bash 移植元）
  - `e2e/global-setup.ts:107-118`（spawnBg / detached pattern — bash では `&` + `trap`）
  - `scripts/sa-setup.mjs:22`（`HARNESS_URL = http://localhost:5180/` 前提）
  - CLAUDE.md の "One-Shot Pipeline (localnet、順序必須)" ブロック
- 実装のヒント:
  - just の shebang recipe は `#!/usr/bin/env bash` 行から始めれば 1 つの bash プロセスで全行実行される（行ごと exec しない）
  - `trap` の `EXIT` ハンドラで kill + ログ削除を統合（recipe 失敗時の cleanup を担保）
  - harness の "Local:" は Vite の起動完了マーカー（`e2e/global-setup.ts` も同じ needle）
- 注意事項:
  - `kill -9` ではなく `kill`（SIGTERM）にする — Vite の cleanup を走らせる
  - `mktemp -t` の `-t` 引数仕様は GNU coreutils 前提（devcontainer は Linux なので OK）
  - just の dependency 解決は **直列実行**。`build deploy-localnet bindings` は宣言順で順に走る（並列ではない）。CLAUDE.md の "順序必須" 要件と合致

## Files

- 変更: `justfile`（Task 002 で作成済み）
- テスト: 手動（`just localnet` 実行 + fixtures.json 確認 + lsof チェック）

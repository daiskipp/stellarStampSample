---
id: "002"
title: "justfile に atomic recipes を追加（既存 scripts の薄い wrap）"
status: done
priority: 2
dependencies: ["001"]
estimated_complexity: low
---

# Task: justfile に atomic recipes を追加（既存 scripts の薄い wrap）

## Goal

リポジトリルートに `justfile` を新規作成し、CLAUDE.md "Commands" 表とほぼ 1:1 で
対応する **atomic recipe**（単一の既存 script を呼ぶだけ）を 6 つ提供する。
`default` レシピは `just --list` でヘルプを出す。

## Interfaces

```just
# justfile (新規, project root)

set shell := ["bash", "-cu"]

# 🔵 default: 引数なし `just` でレシピ一覧を出す
default:
    @just --list --unsorted

# 🔵 build: Soroban contracts を wasm32v1-none に build
build:
    stellar contract build

# 🔵 test-contracts: 46 cargo tests（build に依存 — contractimport! が wasm 要求）
test-contracts: build
    cargo test

# 🔵 deploy-localnet: 5 contracts を localnet に fresh deploy + .env 同期
deploy-localnet:
    bash scripts/deploy-localnet.sh

# 🔵 bindings: TS bindings 再生成 + @dicekey/contracts build
bindings:
    bash scripts/generate-bindings.sh

# 🔵 sa-harness: in-browser kit harness を foreground 起動（:5180）
sa-harness:
    pnpm --filter sa-harness dev

# 🔵 sa-setup: HQ SA + 3 staff rules + initialize + wire + customer SA + 1 stamp
#   前提: sa-harness が :5180 で起動済み
sa-setup:
    node scripts/sa-setup.mjs
```

> 信号機の根拠: いずれの recipe も CLAUDE.md / `docs/dev/context.md` の Commands
> 表に明示されている既存コマンドの 1:1 ラッパ。AI 推論は介在しない。

## Test Strategy

- [ ] `just --list` が 7 recipes（default + 上記 6 つ）を表示する
- [ ] `just build` が `stellar contract build` と同一の挙動（target/wasm32v1-none/release/ に wasm が出る）
- [ ] `just test-contracts` が `build` を自動実行した後に `cargo test` を実行（依存解決の確認）
- [ ] `just deploy-localnet` が `bash scripts/deploy-localnet.sh` と同じ exit code / 出力
- [ ] `just bindings` 後に `packages/contracts/dist/` が更新される
- [ ] エッジケース: `stellar` CLI が PATH に無い場合、`just build` が CLI と同じエラーメッセージで失敗（just が握り潰さない）

## Implementation Notes

- 参照すべき既存コード:
  - CLAUDE.md "Commands" セクション（recipe 名の根拠）
  - `scripts/deploy-localnet.sh`, `scripts/generate-bindings.sh`, `scripts/sa-setup.mjs`（呼び出すスクリプト）
- 実装のヒント:
  - `set shell := ["bash", "-cu"]` を冒頭に置く。`-u` で undefined var を early fail。`-e` は recipe 本体で個別に必要なら付ける（just は recipe 行ごとに exit code を見るため `-e` は基本不要）
  - just は recipe body の各行を独立実行するので、複数行の bash 制御は shebang recipe にする（Task 003 で扱う）
  - 命名は CLAUDE.md Commands 表のキーと揃える（`build` / `bindings` / `sa-harness` / `sa-setup`）
- 注意事項:
  - `cd` を recipe body で使わない（just はデフォルトで justfile のあるディレクトリで実行する）
  - 既存 `scripts/*.sh|.mjs` は touch しない（薄い wrap に徹する）

## Files

- 新規: `justfile`
- テスト: 手動（`just --list` + 各 recipe を 1 度ずつ実行）

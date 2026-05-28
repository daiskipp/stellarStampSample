---
id: "004"
title: "CLAUDE.md の Commands 表を just 主＋bash 併記に更新"
status: done
priority: 3
dependencies: ["003"]
estimated_complexity: low
---

# Task: CLAUDE.md の Tool Mgmt + Commands 表を just 主＋bash 併記に更新（mise 記述削除）

## Goal

`CLAUDE.md` の "Tool Mgmt" 行から **mise の記述を削除**し、"Commands" セクション
（特に "localnet end-to-end (ONE-SHOT …)" ブロック）を `just` コマンド主の表記に
書き換える。詳細な bash コマンド列は **折りたたみ**（`<details>` ブロック）で
残し、開発者がスクリプトの中身を追える状態は維持する。

## Interfaces

### Tool Mgmt 行（CLAUDE.md L24 付近）

更新前:
```markdown
| Tool Mgmt | mise (pins pnpm); Nix flake / devcontainer for Rust + Node |
```

更新後:
```markdown
| Tool Mgmt | devcontainer (Dockerfile pins Node / just) + Nix flake (Rust / Node / just); pnpm via corepack |
```

> 🔵 Task 001 で実装する provisioning と 1:1 対応。

### Commands セクション

更新前（CLAUDE.md 抜粋）:

```markdown
## Commands

\`\`\`bash
mise install
bash scripts/build-kit.sh        # clean clone only: …
pnpm install

# Contracts — build to wasm32v1-none via `stellar contract build` (NOT cargo)
stellar contract build
cargo test

# localnet end-to-end (ONE-SHOT — see gotchas). Each run, in order:
bash scripts/deploy-localnet.sh
bash scripts/generate-bindings.sh
pnpm --filter sa-harness dev
node scripts/sa-setup.mjs

pnpm test:e2e
\`\`\`
```

更新後（推奨形）:

```markdown
## Commands

\`\`\`bash
# 初回 / devcontainer 再構築後
bash scripts/build-kit.sh         # clean clone only: smart-account-kit を build
pnpm install
\`\`\`

### just（推奨インターフェース）

\`\`\`bash
just                              # レシピ一覧
just build                        # stellar contract build
just test-contracts               # build + cargo test
just localnet                     # One-shot pipeline (build → deploy → bindings → harness → sa-setup)
just sa-harness                   # in-browser kit harness のみ起動 (:5180)
just sa-setup                     # 既起動の harness を使って HQ SA / customer / 1 stamp を bootstrap
\`\`\`

### just を経由しない場合（参考）

<details>
<summary>同等の bash 直叩き手順</summary>

\`\`\`bash
stellar contract build
cargo test
bash scripts/deploy-localnet.sh
bash scripts/generate-bindings.sh
pnpm --filter sa-harness dev      # 別ターミナル foreground
node scripts/sa-setup.mjs
\`\`\`

</details>

\`\`\`bash
pnpm test:e2e                     # globalSetup が pipeline 全走（just localnet と独立）
\`\`\`
```

> 信号機:
> - just コマンド列の各行 🔵 — Task 002/003 で実装する recipe と 1:1 対応
> - 折りたたみ内の bash 列 🔵 — 既存 CLAUDE.md と完全一致
> - `pnpm test:e2e` を併記 🟡 — Plan の DoD で「e2e と just localnet が独立」を担保するため、関係を明示

## Test Strategy

- [ ] 更新後 CLAUDE.md を grep して「壊れた手順がない」ことを確認:
  - `just localnet` が登場する
  - `stellar contract build` を含む bash コマンドが折りたたみ内に残っている
  - `node scripts/sa-setup.mjs` への参照が消えていない
  - **`mise` という単語が CLAUDE.md から消えている**（`rg -i mise CLAUDE.md` がヒットしない）
- [ ] CLAUDE.md の他セクション（Gotchas / Architecture / Conventions）と矛盾しない:
  - "順序必須" の説明が `just localnet` と整合
  - `kit needs HTTPS RPC` 等の制約は無変更（recipe では影響しない）
- [ ] レビュー観点: 開発者が CLAUDE.md を読んで just を知らなくても折りたたみで bash 手順に到達できる

## Implementation Notes

- 参照すべき既存コード:
  - `CLAUDE.md` "Commands" セクション
  - Task 002/003 の justfile interfaces
- 実装のヒント:
  - `<details><summary>…</summary>…</details>` は GitHub Flavored Markdown の標準（CLAUDE.md は GFM 想定）
  - 既存の "Gotchas" 節は無変更（One-Shot Pipeline の理由は `just localnet` の挙動説明として残す）
- 注意事項:
  - `mise install` の行は **削除**（Task 001 で mise.toml を削除済みのため。devcontainer rebuild が代わり）
  - `bash scripts/build-kit.sh` は clean clone 時のみ必要なので just recipe にはしない（実装ではなく説明側で吸収）
  - "Tool Mgmt" 表の更新は実装と同期する（Task 001 で実際に Dockerfile + flake.nix に just を入れた形と CLAUDE.md の説明を一致させる）

## Files

- 変更: `CLAUDE.md`
- テスト: 手動（CLAUDE.md を grep + 開発者視点の読み返し）

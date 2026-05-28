---
id: "005"
title: "docs/dev/context.md の常用コマンド表を just 主に同期"
status: done
priority: 3
dependencies: ["003"]
estimated_complexity: low
---

# Task: docs/dev/context.md の Tech Stack + 常用コマンド表を just 主に同期（mise 記述削除）

## Goal

`docs/dev/context.md` の Tech Stack 表（"Tool Manager" 行）と "One-Shot Pipeline
(localnet、順序必須)" + "常用コマンド" を Task 004 で更新する CLAUDE.md と整合
するよう書き換える。**mise の記述は削除**し、dev-context スキルが将来再生成
する際のベースが just 主の表記になるよう統一する。

## Interfaces

### Tech Stack 表（context.md の "Tool Manager" 行）

更新前:
```markdown
| Tool Manager | mise（pnpm をピン留め） | 🔵 |
```

更新後:
```markdown
| Tool Manager | devcontainer (Dockerfile が Node / just を pin) + Nix flake（Rust / Node / just）/ pnpm は corepack | 🔵 |
```

### One-Shot Pipeline + 常用コマンド

更新対象セクション:

```markdown
### One-Shot Pipeline (localnet、順序必須)

\`\`\`bash
# クリーンクローン時のみ
mise install
bash scripts/build-kit.sh
pnpm install

# 開発サイクル（毎回この順序で 1 パスで通す）
stellar contract build
cargo test
bash scripts/deploy-localnet.sh
bash scripts/generate-bindings.sh
pnpm --filter sa-harness dev
node scripts/sa-setup.mjs
\`\`\`

### 常用コマンド

| Command | Description |
|---------|------------|
| `stellar contract build` | … |
| `cargo test` | … |
| `pnpm build` | … |
| `pnpm dev` | … |
| `pnpm test:e2e` | … |
| `pnpm e2e:fund` | … |
```

更新後（推奨形）:

```markdown
### One-Shot Pipeline (localnet)

\`\`\`bash
# 初回 / devcontainer rebuild 後
bash scripts/build-kit.sh
pnpm install

# 開発サイクル
just localnet                     # build → deploy → bindings → harness → sa-setup
\`\`\`

just を経由しない bash 直叩き手順は CLAUDE.md "Commands" の折りたたみを参照。

### 常用コマンド

| just | 同等の bash | Description |
|------|-------------|-------------|
| `just build` | `stellar contract build` | Contracts を `wasm32v1-none` に build |
| `just test-contracts` | `cargo test`（要 build） | 46 cargo tests |
| `just deploy-localnet` | `bash scripts/deploy-localnet.sh` | 5 contracts を localnet に fresh deploy |
| `just bindings` | `bash scripts/generate-bindings.sh` | TS bindings 再生成 |
| `just sa-harness` | `pnpm --filter sa-harness dev` | in-browser kit harness (:5180) |
| `just sa-setup` | `node scripts/sa-setup.mjs` | HQ SA / customer / 1 stamp bootstrap |
| `just localnet` | 上記 6 つの合成 | One-shot pipeline |
| (n/a) | `pnpm build` | `tsc -b && vite build` 両 app |
| (n/a) | `pnpm dev` | customer (5173) + staff (5174) concurrent dev |
| (n/a) | `pnpm test:e2e` | Playwright（globalSetup が pipeline 全走） |
| (n/a) | `pnpm e2e:fund` | `scripts/fund-localnet.mjs` で localnet fund |
```

> 信号機:
> - 表の just 列 🔵 — Task 002/003 の justfile と 1:1 対応
> - 表の bash 列 🔵 — 既存 context.md と完全一致
> - 「(n/a)」行（pnpm build / dev / test:e2e / e2e:fund）🟡 — just 化スコープ外（plan.md の非ゴール参照）。将来別 plan で `just dev` / `just e2e` を追加するときに埋まる

## Test Strategy

- [ ] Tech Stack 表の "Tool Manager" 行から **`mise` が消えて** devcontainer / nix flake 主の記述になる
- [ ] context.md の "One-Shot Pipeline" が `just localnet` 主の表記に変わっている
- [ ] `mise install` の行が context.md から消える（`rg -i mise docs/dev/context.md` がヒットしない）
- [ ] "常用コマンド" 表に 2 カラム（just / bash）が並び、Task 002/003 の recipe が漏れなく登場
- [ ] `pnpm test:e2e` / `pnpm e2e:fund` が (n/a) 行として **残っている**（スコープ外で誤って消さない）
- [ ] dev-context スキル再走時の挙動: context.md 全体構造（Tech Stack / Architecture 等）と矛盾しないこと
- [ ] CLAUDE.md と context.md の表現が同期している（Task 004 完了後にレビュー）

## Implementation Notes

- 参照すべき既存コード:
  - `docs/dev/context.md` "One-Shot Pipeline" + "常用コマンド" 節
  - Task 004 の CLAUDE.md 更新内容（同期対象）
- 実装のヒント:
  - dev-context スキルは README/設定ファイルから再生成するので、生成テンプレが将来 just を含むよう **明示的に just テーブルを書く**ことが重要
  - 「(n/a)」行は将来 `just-daily-aliases` plan 等で埋まる前提のプレースホルダ
- 注意事項:
  - "Architecture" / "Build & Run" 等の他セクションは触らない
  - "順序必須" の理由（contracts 再 init で trap）は CLAUDE.md 側の Gotchas に詳細があるので context.md 側は表現を軽くする

## Files

- 変更: `docs/dev/context.md`
- テスト: 手動（CLAUDE.md との突き合わせ）

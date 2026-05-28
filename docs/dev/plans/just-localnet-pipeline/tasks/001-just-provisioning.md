---
id: "001"
title: "just を devcontainer (Dockerfile) + nix flake で提供し mise を廃止"
status: done
priority: 1
dependencies: []
estimated_complexity: low
---

# Task: just を devcontainer (Dockerfile) + nix flake で提供し mise を廃止

## Goal

`just` を devcontainer 内で必ず PATH に出るよう **Dockerfile に curl install**
で焼き付ける。host で `nix develop` する開発者向けに **flake.nix にも追加**。
現在死蔵されている **mise.toml は削除**（pnpm は corepack + nix flake が既に提供
しており重複していたため）。

## Context（なぜ mise を廃止するか）

| 既存資産 | pnpm の提供元 |
|---------|-------------|
| devcontainer | Dockerfile で `corepack enable` |
| host (`nix develop`) | `flake.nix` の `pkgs.pnpm` |
| `mise.toml` | `pnpm = "latest"` を pin するが、Dockerfile / setup-all.sh / devcontainer.json から **mise install が呼ばれていない**。実機能していない |

`mise install` という記述だけ CLAUDE.md / context.md に残り、実体は機能不全。
just を入れるタイミングで整理する。

## Interfaces

### Dockerfile に追加（`.devcontainer/Dockerfile`）

既存の Node.js install ブロックの後ろに just install を追加:

```dockerfile
# 🔵 NEW — just (command runner). `--tag` でバージョン固定。
ARG JUST_VERSION=1.36.0
RUN set -eux; \
    curl --proto '=https' --tlsv1.2 -sSfL \
      https://just.systems/install.sh \
      | bash -s -- --tag "${JUST_VERSION}" --to /usr/local/bin; \
    just --version
```

> 信号機: 🔵 just 公式 install script の standard 使用法
> 🟡 `JUST_VERSION` の具体的な値（1.36.0）は実装時の stable 最新を確認

### flake.nix に追加（`flake.nix`）

`packages = with pkgs; [ ... ]` の中に `just` を追記:

```nix
packages =
  with pkgs;
  [
    rustup
    pkg-config
    openssl
    cmake
    binaryen
    nodejs_22
    pnpm
    just              # 🔵 NEW
    jq
    curl
    docker-client
    git
  ]
  ++ optionalStellarCli;
```

> 🔵 nixpkgs の `pkgs.just` は標準パッケージ。version は nixpkgs unstable に追従。

### mise.toml の削除

```bash
git rm mise.toml
```

> 🔵 死蔵ファイルの整理。pnpm は Dockerfile (corepack) + nix flake で提供済み。

## Test Strategy

- [ ] devcontainer rebuild 後（`Dev Containers: Rebuild Container`）に
      `just --version` がバージョン固定値（例: `1.36.0`）を返す
- [ ] `which just` が `/usr/local/bin/just` を指す
- [ ] `nix develop -c just --version` が同じバージョン（または nixpkgs の just）を返す
- [ ] `mise.toml` が削除されたあと `pnpm --version` が引き続き返る（corepack 経由が壊れていない）
- [ ] devcontainer 再ビルドせずに既存コンテナ内では just が **無いまま** であること（Dockerfile 経由で焼く設計の確認）
- [ ] エッジケース: `JUST_VERSION` を意図的に存在しない値（`9.99.99`）にすると Docker build が失敗すること（install script の exit code が伝播）

## Implementation Notes

- 参照すべき既存コード:
  - `.devcontainer/Dockerfile`（Node.js install の curl + tar pattern）
  - `flake.nix`（packages array の構造）
  - `mise.toml`（削除対象）
- 実装のヒント:
  - Dockerfile への just install は **Node.js install の後** に置く（Node 依存ではないが、layer cache を温存するため stable 順に）
  - `--tag` で固定。`--to /usr/local/bin` は root 所有なので vscode user からも読める
  - flake.nix への追加は packages array の alphabetical 位置に配置（nix の慣習）
  - mise.toml の削除前に、本当に誰からも参照されていないことを `rg "mise" --type-add 'tomljson:*.{toml,json}' -t tomljson -t sh` で確認
- 注意事項:
  - **devcontainer を rebuild しないと just が入らない**。Task 002 以降の検証は rebuild 後に実施
  - `setup-all.sh` は触らない（Docker layer で焼く方が再現性が高い）
  - JUST_VERSION は将来 mise tasks 廃止後の version pin の唯一の場所になる → コメントで明示

## Files

- 変更: `.devcontainer/Dockerfile`, `flake.nix`
- 削除: `mise.toml`
- テスト: 手動（devcontainer rebuild + `just --version`）

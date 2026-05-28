FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NODE_VERSION=22.22.2
ARG TARGETARCH

# stellar CLI (prebuilt binary) dynamically links libdbus-1.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) node_arch="x64" ;; \
      arm64) node_arch="arm64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1; \
    rm "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    node --version; \
    npm --version; \
    corepack enable; \
    npm install -g @anthropic-ai/claude-code bun; \
    claude --version; \
    bun --version

# 🔵 Intent: just command runner. The repo's justfile drives the localnet
#   one-shot pipeline. Pinned via JUST_VERSION so devcontainer rebuilds give a
#   reproducible install (matches docs/dev/plans/just-localnet-pipeline/).
ARG JUST_VERSION=1.36.0
RUN set -eux; \
    curl --proto '=https' --tlsv1.2 -sSfL https://just.systems/install.sh \
      | bash -s -- --tag "${JUST_VERSION}" --to /usr/local/bin; \
    just --version

# 🔵 Intent: rtk (https://github.com/rtk-ai/rtk) — Rust LLM token-reduction
#   CLI. Wraps shell commands (git/cargo/test runners) and compresses output
#   so Claude Code etc. burn fewer tokens. Pinned via RTK_VERSION for
#   reproducible rebuilds; system-wide install matches just/Playwright.
#   After rebuild, run `rtk init -g` once per user to enable auto-rewriting.
ARG RTK_VERSION=v0.42.0
RUN set -eux; \
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh \
      | RTK_INSTALL_DIR=/usr/local/bin RTK_VERSION="${RTK_VERSION}" sh; \
    rtk --version

# 🔵 Intent: GitHub CLI (gh) for PR creation / issue management from inside the
#   container (gh pr create, gh api, etc.). Pinned via GH_VERSION for
#   reproducible rebuilds; tarball install to /usr/local/bin matches just/rtk.
#   gh auth still needs `gh auth login` once per user after a rebuild.
ARG GH_VERSION=2.93.0
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) gh_arch="amd64" ;; \
      arm64) gh_arch="arm64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${gh_arch}.tar.gz"; \
    tar -xzf "gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" -C /tmp; \
    mv "/tmp/gh_${GH_VERSION}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh; \
    rm -rf "gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" "/tmp/gh_${GH_VERSION}_linux_${gh_arch}"; \
    gh --version

# 🔵 Intent: Playwright chromium + its Linux system deps, pinned to the
#   workspace's @playwright/test version. Browser binary is installed to
#   PLAYWRIGHT_BROWSERS_PATH (chowned to vscode so user-side `playwright
#   install` can update it). This eliminates the post-rebuild "Executable
#   doesn't exist" / "Host system missing dependencies" failure that
#   scripts/sa-setup.mjs (Playwright + CDP virtual authenticator) and the
#   E2E suite hit on Ubuntu 24.04 every fresh image build.
ARG PLAYWRIGHT_VERSION=1.60.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN set -eux; \
    apt-get update; \
    npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p "${PLAYWRIGHT_BROWSERS_PATH}"; \
    npx --yes "playwright@${PLAYWRIGHT_VERSION}" install chromium; \
    chown -R vscode:vscode "${PLAYWRIGHT_BROWSERS_PATH}"

COPY profile.d/stampsample-shell.sh /etc/profile.d/stampsample-shell.sh
RUN printf '\nif [ -f /etc/profile.d/stampsample-shell.sh ]; then\n  . /etc/profile.d/stampsample-shell.sh\nfi\n' >>/etc/bash.bashrc

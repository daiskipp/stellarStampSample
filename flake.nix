{
  description = "dicekey Coffee Stamps local development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        optionalStellarCli =
          if pkgs ? stellar-cli then
            [ pkgs.stellar-cli ]
          else
            [ ];
      in
      {
        devShells.default = pkgs.mkShell {
          name = "stampsample-dev";

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
              just
              jq
              curl
              docker-client
              git
            ]
            ++ optionalStellarCli;

          RUST_BACKTRACE = "1";

          shellHook = ''
            export STAMPSHELL="nix:stampsample-dev"
            export STELLAR_NETWORK="''${STELLAR_NETWORK:-stampsample-local}"
            export STELLAR_RPC_URL="''${STELLAR_RPC_URL:-http://localhost:8000/rpc}"
            export STELLAR_FRIENDBOT_URL="''${STELLAR_FRIENDBOT_URL:-http://localhost:8000/friendbot}"
            export STELLAR_NETWORK_PASSPHRASE="''${STELLAR_NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
            export PATH="$HOME/.cargo/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
            export PS1="[nix:stampsample] ''${PS1:-\\u@\\h:\\w\\$ }"

            echo "dicekey Coffee Stamps dev shell"
            echo "  shell:  $STAMPSHELL"
            echo "  rust:   $(rustc --version 2>/dev/null || echo 'install with: rustup toolchain install stable')"
            echo "  cargo:  $(cargo --version 2>/dev/null || echo 'install with: rustup toolchain install stable')"
            echo "  node:   $(node --version 2>/dev/null || echo 'missing')"
            echo "  pnpm:   $(pnpm --version 2>/dev/null || echo 'missing')"
            echo "  just:   $(just --version 2>/dev/null || echo 'missing')"

            if command -v stellar >/dev/null 2>&1; then
              echo "  stellar: $(stellar version | head -n 1)"
            else
              echo "  stellar: missing"
              echo "           Install Stellar CLI if nixpkgs for this system does not provide stellar-cli."
            fi

            if command -v rustup >/dev/null 2>&1; then
              if ! rustup target list --installed 2>/dev/null | grep -qx "wasm32v1-none"; then
                echo "  note: run 'rustup target add wasm32v1-none' before building Soroban contracts."
              fi
            fi
          '';
        };
      }
    );
}

import { defineConfig } from "vite";

// The Smart Account WebAuthn RP id is `localhost` (VITE_RP_ID). The page MUST
// be served from the `localhost` origin so the virtual authenticator's rpId
// matches. The browser still reaches the localnet RPC via its routable host
// (http://stellar-localnet:8000/rpc) configured in .env.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
  },
  // .env in this dir provides all VITE_* localnet values (gitignored copy of
  // /workspaces/StampSample/.env.localnet).
  envDir: ".",
});

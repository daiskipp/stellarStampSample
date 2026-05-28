import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// 🔵 Intent: Plan 001/003 — HTTPS + same-origin `/rpc` proxy is the host-Chrome
//    `pnpm dev` path; `--mode test` (E2E / smoke) stays on plain HTTP and
//    delegates RPC TLS to the external `scripts/rpc-https-proxy.mjs` so the
//    existing test infra (CDP virtual authenticator, http://localhost:5173
//    page navigation, :8443 proxy) keeps working unchanged.
export default defineConfig(({ mode }) => {
  const isTest = mode === "test";
  return {
    plugins: isTest ? [react()] : [react(), basicSsl()],
    server: isTest
      ? {}
      : {
          https: true,
          proxy: {
            "/rpc": {
              target: "http://stellar-localnet:8000",
              changeOrigin: true,
              secure: false,
            },
            // 🟡 Intent: friendbot is localnet-only; same-origin keeps any
            //    future passkey-side fund flows from running into CORS.
            "/friendbot": {
              target: "http://stellar-localnet:8000",
              changeOrigin: true,
              secure: false,
            },
          },
        },
  };
});

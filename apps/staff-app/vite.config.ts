import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// 🔵 Intent: Plan 002/003 — mirror customer-app. `pnpm dev` runs HTTPS +
//    same-origin `/rpc`; `--mode test` (E2E / smoke) stays plain HTTP and
//    delegates RPC TLS to the external `scripts/rpc-https-proxy.mjs`.
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
            //    future staff-side fund flows from running into CORS.
            "/friendbot": {
              target: "http://stellar-localnet:8000",
              changeOrigin: true,
              secure: false,
            },
          },
        },
  };
});

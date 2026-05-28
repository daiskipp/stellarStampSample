#!/usr/bin/env node
// Minimal HTTPS -> HTTP reverse proxy for the localnet Soroban RPC.
//
// Why: @stellar/stellar-sdk's rpc.Server throws "Cannot connect to insecure
// Soroban RPC server if `allowHttp` isn't set" for any non-https URL, and
// smart-account-kit@0.2.10 constructs `new RpcServer(config.rpcUrl)` with no
// way to pass allowHttp. The localnet RPC is plain http. Terminating TLS here
// (self-signed, accepted via Playwright ignoreHTTPSErrors) lets the kit AND
// the contract bindings use an https:// URL with zero node_modules patching.
//
// Listens on https://127.0.0.1:8443 -> forwards to
// http://stellar-localnet:8000  (path preserved, e.g. /rpc, /friendbot).

import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(__dirname, "..", "tools", "sa-harness");

const UPSTREAM_HOST = process.env.RPC_UPSTREAM_HOST || "stellar-localnet";
const UPSTREAM_PORT = Number(process.env.RPC_UPSTREAM_PORT || 8000);
const LISTEN_PORT = Number(process.env.PROXY_PORT || 8443);
// 127.0.0.1 by default keeps the proxy invisible to anything outside the
// process/container (sufficient for sa-setup.mjs which runs Playwright in
// the same devcontainer). For `just hq-setup` we override to 0.0.0.0 so the
// host browser (Mac/Win) can reach it through Orbstack/Docker port mapping.
const LISTEN_HOST = process.env.PROXY_HOST || "127.0.0.1";

const server = https.createServer(
  {
    key: readFileSync(join(HARNESS, "proxy-key.pem")),
    cert: readFileSync(join(HARNESS, "proxy-cert.pem")),
  },
  (req, res) => {
    // CORS so the browser harness (origin http://localhost:5180) can call it.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const opts = {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` },
    };
    const up = http.request(opts, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    });
    up.on("error", (e) => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: "proxy upstream error", detail: String(e) }));
    });
    req.pipe(up);
  },
);

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `rpc-https-proxy: https://${LISTEN_HOST}:${LISTEN_PORT} -> http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
  );
});

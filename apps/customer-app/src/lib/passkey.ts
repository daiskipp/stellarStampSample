// Passkey (WebAuthn) helpers — thin wrappers around smart-account-kit.
//
// The previous hand-rolled WebAuthn (navigator.credentials) is gone: the kit
// owns the full passkey + Smart Account lifecycle (register credential, deploy
// the OZ smart-account contract, persist the credential to IndexedDB, sign
// __check_auth). We only delegate.
//
// Module load wires the SDK network config to the localnet HTTPS proxy, the
// same pattern tools/sa-harness/src/harness.ts uses: @stellar/stellar-sdk's
// rpc.Server rejects plain-http RPC, so VITE_RPC_PROXY_URL (scripts/
// rpc-https-proxy.mjs) terminates TLS in front of the http localnet RPC.

import {
  createKit,
  getKit,
  setConfig,
  getConfig,
  TESTNET_CONFIG,
  type CreateWalletResult,
  type ConnectWalletResult,
} from "@dicekey/sdk";

const APP_NAME = "dicekey Coffee Stamps";

const env = import.meta.env as unknown as Record<string, string | undefined>;
const proxyUrl =
  env.VITE_RPC_PROXY_URL || env.VITE_RPC_URL || "https://127.0.0.1:8443/rpc";

// Point the SDK (and the kit it builds) at the HTTPS proxy. TESTNET_CONFIG is
// already populated from import.meta.env (Vite injects .env), so we only
// rewrite rpcUrl.
setConfig({ ...TESTNET_CONFIG, rpcUrl: proxyUrl });

let kitInitialized = false;

/** Build the process-wide kit on first use (IndexedDBStorage by default). */
export function ensureKit() {
  if (!kitInitialized) {
    createKit(); // primes the @dicekey/sdk singleton with the proxied config
    kitInitialized = true;
  }
  return getKit();
}

/** The active network config (rpc / passphrase / contract ids). */
export function activeConfig() {
  return getConfig();
}

/**
 * Register a brand-new passkey and deploy the customer's own Smart Account.
 * autoSubmit:true makes the kit submit + await the deployment tx. autoFund is
 * intentionally omitted: localnet's passphrase is not a "Test" network so the
 * kit skips friendbot funding, and the SA needs no XLM (fees are paid by the
 * kit's deterministic deployer source account).
 *
 * `authenticatorAttachment` is forwarded to navigator.credentials.create via
 * the kit's authenticatorSelection. Default "platform" forces Touch ID /
 * Windows Hello (and surfaces a clean error if no platform authenticator
 * exists) instead of Chrome's hybrid (QR-to-phone) fallback — important for
 * devcontainer/test environments without a platform authenticator. Pass
 * "cross-platform" to allow USB security keys, or undefined to let the browser
 * decide.
 */
export async function registerPasskeyWallet(
  name: string,
  authenticatorAttachment: "platform" | "cross-platform" | undefined = "platform",
): Promise<CreateWalletResult> {
  const kit = ensureKit();
  return kit.createWallet(APP_NAME, name, {
    autoSubmit: true,
    authenticatorSelection: authenticatorAttachment
      ? { authenticatorAttachment }
      : undefined,
  });
}

/**
 * Connect to an existing Smart Account.
 *
 * - No args: silent restore from IndexedDB (returns null if no stored session).
 * - prompt:true: restore, otherwise prompt the user to pick a passkey.
 */
export async function connectExisting(opts?: {
  prompt?: boolean;
}): Promise<ConnectWalletResult | null> {
  const kit = ensureKit();
  return kit.connectWallet(opts ?? {});
}

/** Disconnect and clear the stored session. */
export async function disconnectWallet(): Promise<void> {
  const kit = ensureKit();
  await kit.disconnect();
}

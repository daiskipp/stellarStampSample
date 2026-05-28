// Network configuration for dicekey Coffee Stamps.

// Named *Env (not *Config) to avoid clashing with smart-account-kit's own
// exported `SmartAccountConfig` (its constructor options type).
export interface SmartAccountEnv {
  /** OpenZeppelin smart-account WASM hash (deployed on Testnet). */
  accountWasmHash: string;
  /** WebAuthn (secp256r1) verifier contract address. */
  webauthnVerifierAddress: string;
  /** Ed25519 verifier contract address. */
  ed25519VerifierAddress: string;
  /** Native XLM SAC contract (used by createWallet autoFund / transfer). */
  nativeTokenContract: string;
  /** WebAuthn relying-party id (host) and display name. */
  rpId: string;
  rpName: string;
  /** dicekey HQ Smart Account contract (admin of the 5 dicekey contracts). */
  hqSmartAccount: string;
  /** Context-rule id on the HQ Smart Account that scopes staff signers. */
  hqStaffContextRuleId: number | null;
  /** Optional policy contracts (only used if a rule attaches a policy). */
  thresholdPolicyAddress: string;
  spendingLimitPolicyAddress: string;
}

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    visitStamps: string;
    beansToken: string;
    benefits: string;
    badges: string;
    rewardPolicy: string;
  };
  smartAccount: SmartAccountEnv;
  /**
   * Optional kit relayer endpoint. When set, the kit POSTs invokeHostFunction
   * submissions to this URL instead of the rpc (kit's `getSubmissionMethod`
   * auto-routes — `signAndSubmitTx` itself stays unchanged). Must include the
   * full path the Worker exposes (e.g. `https://…/relayer`); the kit fetches
   * the URL verbatim and does NOT append a path segment.
   */
  relayerUrl?: string;
}

// import.meta.env is injected by Vite in the apps; fall back to process.env for
// node callers (setup scripts) so the same config works in both contexts.
// `process` is read via globalThis so this file needs no @types/node — the
// strict browser app tsconfigs (no node typings) would otherwise error on a
// bare `process` reference (TS2580).
const nodeProcess = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;
const env: Record<string, string | undefined> =
  ((typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env) ||
    nodeProcess?.env ||
    {}) ??
  {};

function num(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const TESTNET_CONFIG: NetworkConfig = {
  rpcUrl: env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase: env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  contracts: {
    visitStamps: env.VITE_VISIT_STAMPS_CONTRACT ?? "",
    beansToken: env.VITE_BEANS_TOKEN_CONTRACT ?? "",
    benefits: env.VITE_BENEFITS_CONTRACT ?? "",
    badges: env.VITE_BADGES_CONTRACT ?? "",
    rewardPolicy: env.VITE_REWARD_POLICY_CONTRACT ?? "",
  },
  smartAccount: {
    accountWasmHash: env.VITE_ACCOUNT_WASM_HASH ?? "",
    webauthnVerifierAddress: env.VITE_WEBAUTHN_VERIFIER_ADDRESS ?? "",
    ed25519VerifierAddress: env.VITE_ED25519_VERIFIER_ADDRESS ?? "",
    nativeTokenContract: env.VITE_NATIVE_TOKEN_CONTRACT ?? "",
    rpId: env.VITE_RP_ID ?? "localhost",
    rpName: env.VITE_RP_NAME ?? "dicekey Coffee Stamps",
    hqSmartAccount: env.VITE_HQ_SMART_ACCOUNT ?? "",
    hqStaffContextRuleId: num(env.VITE_HQ_STAFF_CONTEXT_RULE_ID),
    thresholdPolicyAddress: env.VITE_THRESHOLD_POLICY_ADDRESS ?? "",
    spendingLimitPolicyAddress: env.VITE_SPENDING_LIMIT_POLICY_ADDRESS ?? "",
  },
  // `|| undefined` (not `??`) so an empty-string env var falls through to
  // undefined — the kit treats undefined as "no relayer, use rpc directly",
  // which is what localnet dev expects (VITE_WORKER_URL unset or empty).
  relayerUrl: env.VITE_WORKER_URL || undefined,
};

let currentConfig: NetworkConfig = TESTNET_CONFIG;

export function setConfig(config: NetworkConfig) {
  currentConfig = config;
}

export function getConfig(): NetworkConfig {
  return currentConfig;
}

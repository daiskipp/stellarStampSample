// Passkey (WebAuthn) helpers for the staff-app — thin wrappers around
// smart-account-kit, same delegation pattern as customer-app/src/lib/passkey.
//
// THE KEY DIFFERENCE vs customer-app: staff do NOT own a Smart Account. They
// own a passkey credential that is registered as a *signer* on the dicekey HQ
// Smart Account's 3 staff CallContract context rules
// (VITE_HQ_STAFF_RULE_IDS, order = visit-stamps, beans-token, reward-policy).
//
// PROVEN SHAPE (scripts/sa-setup.mjs U2 PASS / tools/sa-harness setupStaffRules
// + issueStamp): a staff signer credential has NO Smart Account of its own, so
// it can NEVER be passed to kit.connectWallet — the kit's connectWithCredentials
// (.oz-build/smart-account-kit/src/kit/wallet-ops.ts:222-226) unconditionally
// overrides the supplied contractId with the credential's own (non-existent)
// SA, throwing "Smart account contract not found on-chain for credential".
//
// Instead the tablet stays connected to the HQ Smart Account with the HQ ROOT
// credential (the Default-context credential minted at HQ wallet creation;
// connectWallet({contractId: HQ, credentialId: hqRoot}) succeeds because the
// HQ contract IS deployed on-chain). issue() is then signed with the STAFF
// credential via signAndSubmit(tx, { credentialId: staffCred,
// resolveContextRuleIds: () => staffRuleIds }) WHILE connected as HQ — the
// staff credentialId only drives the WebAuthn allowCredentials prompt and the
// signer lookup is resolved from the on-chain staff rules, not local storage
// (.oz-build/.../kit/webauthn-ops.ts signAuthEntry). U2 case C: the 3 staff
// rule ids index-aligned to issue()'s 3 auth_contexts.
//
// Module load wires the SDK network config to the localnet HTTPS proxy
// (scripts/rpc-https-proxy.mjs): @stellar/stellar-sdk's rpc.Server rejects
// plain-http RPC, so VITE_RPC_PROXY_URL terminates TLS in front of it.

import {
  createKit,
  getKit,
  setConfig,
  getConfig,
  TESTNET_CONFIG,
  createWebAuthnSigner,
  createCallContractContext,
  type ConnectWalletResult,
} from "@dicekey/sdk";

const APP_NAME = "dicekey Staff";

/**
 * Create one staff WebAuthn credential, forwarding authenticatorSelection to
 * navigator.credentials.create.
 *
 * Why this exists: smart-account-kit 0.3.0's public `CredentialManager.create`
 * doesn't expose authenticatorSelection, but the kit's private `createPasskey`
 * (kit.ts:760 → kit/webauthn-ops.ts:54) already threads it through. We reach
 * that path via a runtime cast — kit is source-built at a pinned commit so the
 * shape is stable — and then persist the credential through the kit's own
 * `credentials.save` so the result is indistinguishable from the public API.
 *
 * Without this, on devices with no platform authenticator (most devcontainer
 * hosts) Chrome falls back to hybrid (QR-to-phone) or external security key,
 * and cancelling that throws NotAllowedError. Passing
 * authenticatorAttachment:"platform" forces Touch ID / Windows Hello and fails
 * fast on hosts that lack one (rather than silently dropping into the phone
 * flow).
 */
type KitCreatePasskeyFn = (
  appName: string,
  userName: string,
  selection?: {
    authenticatorAttachment?: "platform" | "cross-platform";
    residentKey?: "discouraged" | "preferred" | "required";
    userVerification?: "discouraged" | "preferred" | "required";
  },
) => Promise<{ credentialId: string; publicKey: Uint8Array }>;

async function createStaffPasskey(
  staffName: string,
  authenticatorAttachment: "platform" | "cross-platform" | undefined,
): Promise<{ credentialId: string; publicKey: Uint8Array }> {
  const kit = ensureKit();
  const createPasskey = (
    kit as unknown as { createPasskey: KitCreatePasskeyFn }
  ).createPasskey.bind(kit);
  const { credentialId, publicKey } = await createPasskey(APP_NAME, staffName, {
    authenticatorAttachment,
  });
  await kit.credentials.save({ credentialId, publicKey, nickname: staffName });
  return { credentialId, publicKey };
}

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

/** The dicekey HQ Smart Account C-address (admin of the 5 contracts). */
export function hqSmartAccount(): string {
  return getConfig().smartAccount.hqSmartAccount;
}

/**
 * The 3 staff context-rule ids on the HQ SA, parsed from
 * VITE_HQ_STAFF_RULE_IDS, in issue()-call order
 * [visit-stamps, beans-token, reward-policy].
 */
export function staffRuleIds(): number[] {
  const raw = env.VITE_HQ_STAFF_RULE_IDS || "";
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids;
}

/**
 * The benefits CallContract staff-rule id on the HQ SA, parsed from
 * VITE_HQ_STAFF_BENEFITS_RULE_ID. Used to resolve benefits.burn_from's single
 * auth_context (Receive Benefit). 0 if unset.
 */
export function staffBenefitsRuleId(): number {
  const n = Number((env.VITE_HQ_STAFF_BENEFITS_RULE_ID || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The HQ root (Default-context) passkey credential id, as written by
 * scripts/sa-setup.mjs into VITE_HQ_ROOT_CREDENTIAL_ID. Used by
 * `enrollStaffDevice` to authorise the add_context_rule txs for this device's
 * staff signer (no operator paste-in). Empty string if unset.
 */
export function hqRootCredentialIdFromEnv(): string {
  return (env.VITE_HQ_ROOT_CREDENTIAL_ID || "").trim();
}

/**
 * The first staff passkey credential id from `just hq-setup` (harness
 * setupStaffRules), written to VITE_HQ_STAFF_CREDENTIAL_ID. Lets staff-app
 * reuse the bootstrap staff signer on the same machine without re-running
 * enrollDevice (the passkey is rpId="localhost"-scoped, so a credential
 * registered at the harness origin :5180 is usable from staff-app :5174).
 * Empty string if unset (sa-setup.mjs/CDP path intentionally doesn't set it).
 */
export function hqStaffCredentialIdFromEnv(): string {
  return (env.VITE_HQ_STAFF_CREDENTIAL_ID || "").trim();
}

/** Display name for the bootstrap staff. Empty if unset. */
export function hqStaffNameFromEnv(): string {
  return (env.VITE_HQ_STAFF_NAME || "").trim();
}

// staff-app keeps, per browser/device (the "device setup" record, written once
// by an HQ admin at enroll time): the HQ Smart Account C-address, the HQ ROOT
// credential id (used to connectWallet to the HQ SA at daily sign-in — NOT the
// staff cred), this device's staff credentialId (the signer used only at
// issue() time), the staff display name, and the 3 CallContract rule ids
// created for this device's staff passkey. The rule ids are this device's
// resolveContextRuleIds for issue() (U2 case C). If enrollment used the pinned
// VITE rule ids instead of freshly created ones, this still records them so
// sign-in is self-contained.
const STAFF_CRED_KEY = "dicekey_staff_credential_id";
const STAFF_NAME_KEY = "dicekey_staff_name";
const STAFF_RULE_IDS_KEY = "dicekey_staff_rule_ids";
const STAFF_BENEFITS_RULE_KEY = "dicekey_staff_benefits_rule_id";
const STAFF_HQ_KEY = "dicekey_staff_hq_contract_id";
const STAFF_HQ_ROOT_KEY = "dicekey_staff_hq_root_credential_id";

export interface StoredStaffCredential {
  credentialId: string | null;
  staffName: string | null;
  ruleIds: number[] | null;
  /** benefits CallContract staff-rule id (Receive Benefit). 0/null if unset. */
  benefitsRuleId: number | null;
  /** HQ Smart Account C-address recorded at device setup. */
  hqContractId: string | null;
  /** HQ root credential id (Default-context) used to connect at sign-in. */
  hqRootCredentialId: string | null;
}

export function loadStoredStaffCredential(): StoredStaffCredential {
  let ruleIds: number[] | null = null;
  try {
    const raw = localStorage.getItem(STAFF_RULE_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((n) => typeof n === "number")
      ) {
        ruleIds = parsed as number[];
      }
    }
  } catch {
    ruleIds = null;
  }
  let benefitsRuleId: number | null = null;
  try {
    const raw = localStorage.getItem(STAFF_BENEFITS_RULE_KEY);
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) benefitsRuleId = n;
    }
  } catch {
    benefitsRuleId = null;
  }
  // 🟡 localStorage (per-device enrollDevice record) takes precedence; env
  //    fallbacks let `just hq-setup`'s bootstrap staff sign in without a
  //    redundant enrollment when the harness ran on this same machine.
  const envStaffCred = hqStaffCredentialIdFromEnv() || null;
  const envStaffName = hqStaffNameFromEnv() || null;
  const envHqContract = (getConfig().smartAccount.hqSmartAccount || "").trim() || null;
  const envHqRoot = hqRootCredentialIdFromEnv() || null;
  const envRuleIds = staffRuleIds();
  const envBenefitsRule = staffBenefitsRuleId();
  return {
    credentialId: localStorage.getItem(STAFF_CRED_KEY) || envStaffCred,
    staffName: localStorage.getItem(STAFF_NAME_KEY) || envStaffName,
    ruleIds: ruleIds ?? (envRuleIds.length === 3 ? envRuleIds : null),
    benefitsRuleId: benefitsRuleId ?? (envBenefitsRule > 0 ? envBenefitsRule : null),
    hqContractId: localStorage.getItem(STAFF_HQ_KEY) || envHqContract,
    hqRootCredentialId: localStorage.getItem(STAFF_HQ_ROOT_KEY) || envHqRoot,
  };
}

export function storeStaffCredential(args: {
  credentialId: string;
  staffName: string;
  ruleIds: number[];
  benefitsRuleId: number;
  hqContractId: string;
  hqRootCredentialId: string;
}) {
  localStorage.setItem(STAFF_CRED_KEY, args.credentialId);
  localStorage.setItem(STAFF_NAME_KEY, args.staffName);
  localStorage.setItem(STAFF_RULE_IDS_KEY, JSON.stringify(args.ruleIds));
  localStorage.setItem(
    STAFF_BENEFITS_RULE_KEY,
    String(args.benefitsRuleId),
  );
  localStorage.setItem(STAFF_HQ_KEY, args.hqContractId);
  localStorage.setItem(STAFF_HQ_ROOT_KEY, args.hqRootCredentialId);
}

export function clearStoredStaffCredential() {
  localStorage.removeItem(STAFF_CRED_KEY);
  localStorage.removeItem(STAFF_NAME_KEY);
  localStorage.removeItem(STAFF_RULE_IDS_KEY);
  localStorage.removeItem(STAFF_BENEFITS_RULE_KEY);
  localStorage.removeItem(STAFF_HQ_KEY);
  localStorage.removeItem(STAFF_HQ_ROOT_KEY);
}

/**
 * Device setup (端末セットアップ) — register THIS tablet as a staff terminal,
 * with an HQ administrator in attendance.
 *
 * Chicken-and-egg: a new staff passkey can only sit on the HQ SA if an
 * existing HQ-authorised credential signs for it. So this requires the HQ
 * *root* passkey (the Default-context credential from HQ wallet creation) to
 * be present on this authenticator. The credential id itself comes from
 * VITE_HQ_ROOT_CREDENTIAL_ID (written by scripts/sa-setup.mjs); the operator
 * only needs to be holding the HQ authenticator, not paste its id in.
 *
 * The kit's public SignerManager.addPasskey mints a NEW credential per call,
 * so it cannot put ONE staff credential on the 3 existing staff rules. Instead
 * we use the proven tools/sa-harness `setupStaffRules` shape: create ONE staff
 * WebAuthn credential, then create 3 fresh CallContract context rules (one per
 * contract: visit-stamps, beans-token, reward-policy) each carrying that same
 * single signer, all authorised by the HQ root credential. issue()'s 3
 * auth_contexts are then resolved against THESE 3 rule ids (U2 case C). A
 * single visit-stamps rule is rejected with #3014. The freshly created rule
 * ids are persisted per device (they differ from the pinned VITE_HQ_STAFF_
 * RULE_IDS, which only describes the sa-setup.mjs bootstrap rules).
 *
 * The HQ contract id + HQ root credential id are persisted too: daily sign-in
 * reconnects to the HQ SA with the HQ ROOT credential (NOT the staff cred —
 * see module header), so the tablet must remember both after the admin leaves.
 */
export async function enrollStaffDevice(
  staffName: string,
  authenticatorAttachment: "platform" | "cross-platform" | undefined = "platform",
): Promise<{
  credentialId: string;
  ruleIds: number[];
  benefitsRuleId: number;
  hqContractId: string;
  hqRootCredentialId: string;
}> {
  const hqRootCredentialId = hqRootCredentialIdFromEnv();
  if (!hqRootCredentialId) {
    throw new Error(
      "VITE_HQ_ROOT_CREDENTIAL_ID が未設定です。scripts/sa-setup.mjs を実行して .env を更新してください。",
    );
  }
  const kit = ensureKit();
  const cfg = getConfig();
  const hqContractId = cfg.smartAccount.hqSmartAccount;

  // Connect to the HQ SA with its ROOT credential so the add_context_rule txs
  // are authorised by the HQ Default context rule. The HQ root credential is
  // NOT in this tablet's IndexedDB (it lives on the authenticator only), so
  // connectWithCredentials keeps the supplied HQ contractId — which IS
  // deployed on-chain — instead of overriding it (the staff-cred failure mode).
  await kit.connectWallet({
    contractId: hqContractId,
    credentialId: hqRootCredentialId,
  });

  // One staff passkey credential, used as the signer on ALL 3 staff rules
  // (so a single staff signature can resolve issue()'s 3 auth_contexts).
  // Forces authenticatorAttachment so we can pin Touch ID / Windows Hello and
  // skip Chrome's hybrid (QR) fallback — see createStaffPasskey header.
  const cred = await createStaffPasskey(staffName, authenticatorAttachment);
  const signer = createWebAuthnSigner(
    cfg.smartAccount.webauthnVerifierAddress,
    cred.publicKey,
    cred.credentialId,
  );

  // OZ MAX_NAME_SIZE = 20 bytes — keep rule names short. Order matters: index-
  // aligned to issue()'s auth_contexts (issue -> beans.mint -> on_stamp_issued).
  async function addRule(scope: string, name: string): Promise<number> {
    const ctxType = createCallContractContext(scope);
    const tx = await kit.rules.add(ctxType, name, [signer], new Map());
    const r = await kit.signAndSubmit(tx, {
      credentialId: hqRootCredentialId,
    });
    if (!r.success) {
      throw new Error(`enroll: add rule ${name} failed: ${r.error}`);
    }
    let ruleId: number | undefined = (
      tx as unknown as { result?: { id?: number } }
    ).result?.id;
    if (ruleId == null) {
      const rules = (await kit.rules.getAll(ctxType)) as unknown as Array<{
        id: number;
        name: string;
      }>;
      const found = rules.filter((x) => x.name === name);
      if (found.length === 0) {
        throw new Error(`enroll: rule ${name} not found after add`);
      }
      ruleId = found[found.length - 1].id;
    }
    return ruleId;
  }

  const ruleVisitStamps = await addRule(cfg.contracts.visitStamps, "staff-vs");
  const ruleBeans = await addRule(cfg.contracts.beansToken, "staff-beans");
  const rulePolicy = await addRule(cfg.contracts.rewardPolicy, "staff-policy");
  const ruleIds = [ruleVisitStamps, ruleBeans, rulePolicy];
  // 4th rule: benefits CallContract scope, same staff passkey signer, so the
  // staff signature can authorise benefits.burn_from (Receive Benefit). Not
  // part of issue()'s 3-context tree — issue never touches benefits.
  const benefitsRuleId = await addRule(cfg.contracts.benefits, "staff-benefit");

  storeStaffCredential({
    credentialId: cred.credentialId,
    staffName,
    ruleIds,
    benefitsRuleId,
    hqContractId,
    hqRootCredentialId,
  });
  return {
    credentialId: cred.credentialId,
    ruleIds,
    benefitsRuleId,
    hqContractId,
    hqRootCredentialId,
  };
}

/**
 * Daily sign-in: connect the kit to the HQ Smart Account with the HQ ROOT
 * credential recorded at device setup.
 *
 * This deliberately does NOT pass the staff signer credential to
 * connectWallet: a staff cred owns no Smart Account, and the kit's
 * connectWithCredentials overrides the supplied HQ contractId with the
 * credential's own (non-existent) SA, throwing "Smart account contract not
 * found on-chain for credential" (the confirmed bug). The HQ root credential
 * is not in this tablet's IndexedDB (it lives on the authenticator only), so
 * the kit keeps the supplied — and on-chain-deployed — HQ contractId and
 * connects. The staff cred is used only at issue() time (signAndSubmit while
 * connected as HQ), exactly as scripts/sa-setup.mjs proves U2 PASS.
 */
export async function staffSignIn(
  hqContractId: string,
  hqRootCredentialId: string,
): Promise<ConnectWalletResult> {
  const kit = ensureKit();
  const res = await kit.connectWallet({
    contractId: hqContractId,
    credentialId: hqRootCredentialId,
  });
  if (!res) {
    throw new Error(
      "本部 Smart Account に接続できませんでした。端末セットアップを確認してください。",
    );
  }
  return res;
}

/** Disconnect and clear the kit session (local staff pointer is kept/cleared by caller). */
export async function staffSignOut(): Promise<void> {
  const kit = ensureKit();
  try {
    await kit.disconnect();
  } catch {
    // ignore — caller clears local state regardless
  }
}

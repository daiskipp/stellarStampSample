// Headless WebAuthn setup harness for dicekey Smart Account integration.
//
// Runs in a real browser (driven by Playwright + a CDP virtual authenticator)
// so smart-account-kit's WebAuthn passkey flow executes end-to-end against
// localnet. Every operation is exposed on `window.saHarness` and returns a
// plain JSON-serialisable result so the Node runner can drive + assert it.
//
// Fee model (resolved): smart-account-kit submits via RPC with NO relayer.
// The fee payer / tx source is the kit's hardcoded deterministic deployer
// keypair Keypair.fromRawEd25519Seed(hash("openzeppelin-smart-account-kit"))
// => GAAH4OT3...  It must exist & be funded on localnet (friendbot). The HQ
// Smart Account itself does NOT need to hold XLM; auth is provided by the
// __check_auth passkey signature, fees by the deployer source account.

import {
  createKit,
  setConfig,
  getConfig,
  TESTNET_CONFIG,
  createCallContractContext,
  createWebAuthnSigner,
  MemoryStorage,
  type SmartAccountKit,
} from "@dicekey/sdk";
import { makeDicekeyClients, type DicekeyClients } from "@dicekey/contracts";

type LogType = "info" | "success" | "error";
const logEl = document.getElementById("log") as HTMLPreElement;
const lines: string[] = [];
function log(msg: string, type: LogType = "info") {
  const line = `[${type}] ${msg}`;
  lines.push(line);
  logEl.textContent = lines.join("\n");
  // eslint-disable-next-line no-console
  console.log(line);
}

// The SDK builds its config from import.meta.env at module load. Vite injects
// .env (or .env.testnet when started with --mode testnet) so TESTNET_CONFIG
// already reflects whichever network the harness was launched for.
//
// Localnet: @stellar/stellar-sdk rpc.Server rejects plain-http URLs and
// smart-account-kit gives no allowHttp escape hatch, so
// scripts/rpc-https-proxy.mjs terminates TLS in front of the http localnet
// RPC. VITE_RPC_PROXY_URL points at it. Use `localhost` (not 127.0.0.1) so
// the host browser only needs to accept the self-signed cert for ONE Chrome
// origin. sa-setup.mjs's Chromium ignores cert errors via Playwright, so the
// hostname switch doesn't affect it.
//
// Testnet: TESTNET_CONFIG.rpcUrl is the public https://soroban-testnet.stellar.org
// — no proxy required. We branch on the network passphrase (`Standalone …` is
// the localnet marker, baked into .env.localnet) so harness can run unchanged
// under `pnpm --filter sa-harness dev --mode testnet`.
const isLocalnet = TESTNET_CONFIG.networkPassphrase.includes("Standalone");
if (isLocalnet) {
  const proxyUrl =
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_RPC_PROXY_URL || "https://localhost:8443/rpc";
  setConfig({
    ...TESTNET_CONFIG,
    rpcUrl: proxyUrl,
  });
} else {
  setConfig(TESTNET_CONFIG);
}
const cfg = getConfig();
log(`config rpc=${cfg.rpcUrl} pass=${JSON.stringify(cfg.networkPassphrase)}`);
log(`visitStamps=${cfg.contracts.visitStamps}`);

// Single kit + storage for the whole harness session. MemoryStorage keeps
// credentials only for this page lifetime; the Node runner persists the
// public credential ids / contract ids to fixtures.json.
const storage = new MemoryStorage();
let kit: SmartAccountKit = createKit({ storage });

let connectedContractId: string | null = null;
let connectedCredentialId: string | null = null;

function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 🔴 Bypass `kit.credentials.create(...)` for staff passkey registration.
// kit's createWallet exposes `authenticatorSelection` (Mac Touch ID / Windows
// Hello / DevTools VA pinning) but the credential-manager API drops it on the
// floor: kit.ts:465 wires `(appName, userName) => createPasskey(appName,
// userName)` without forwarding the selection arg that exists on the lower
// `createPasskey` (kit.ts:760-783). Without `authenticatorAttachment:"platform"`
// Chrome m120+ on Mac shows the full passkey+security key+QR picker by default,
// which the user sees as "別端末のパスキー" and times out → NotAllowedError.
// This helper re-implements the registration ceremony with the same options
// createWallet uses (es256 only, residentKey required, UV required, platform
// only), matching kit's `extractPublicKeyFromAttestation` (utils.ts:215) so the
// resulting publicKey is the 65-byte uncompressed secp256r1 point that
// createWebAuthnSigner expects.
async function createPlatformPasskey(
  appName: string,
  userName: string,
): Promise<{ credentialId: string; publicKey: Uint8Array }> {
  const now = new Date();
  const displayName = `${userName} — ${now.toLocaleString()}`;
  const userId = new TextEncoder().encode(
    `${userName}:${now.getTime()}:${Math.random()}`,
  );
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: cfg.smartAccount.rpId, name: appName },
      user: { id: userId, name: displayName, displayName },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("navigator.credentials.create returned null");
  const att = cred.response as AuthenticatorAttestationResponse;

  let pubKey: Uint8Array | null = null;
  // Prefer Level-3 getPublicKey() (SPKI) → raw via WebCrypto.
  const getPub = (att as unknown as { getPublicKey?: () => ArrayBuffer | null })
    .getPublicKey;
  if (typeof getPub === "function") {
    const spki = getPub.call(att);
    if (spki) {
      const imported = await crypto.subtle.importKey(
        "spki",
        spki,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        [],
      );
      pubKey = new Uint8Array(await crypto.subtle.exportKey("raw", imported));
    }
  }
  if (!pubKey) {
    // Fallback: parse credentialPublicKey from authenticatorData using kit's
    // offsets (utils.ts:262-274). authData layout: 37-byte header +
    // 16-byte AAGUID + 2-byte credIdLen + credId + 77-byte ES256 COSE key
    // (10-byte prefix a5 01 02 03 26 20 01 21 58 20 + 32-byte x + 3-byte
    // marker 22 58 20 + 32-byte y).
    const getAuth = (
      att as unknown as { getAuthenticatorData?: () => ArrayBuffer }
    ).getAuthenticatorData;
    if (typeof getAuth !== "function") {
      throw new Error("no publicKey and no authenticatorData on attestation");
    }
    const authData = new Uint8Array(getAuth.call(att));
    const credIdLen = (authData[53] << 8) | authData[54];
    const x = authData.slice(65 + credIdLen, 97 + credIdLen);
    const y = authData.slice(100 + credIdLen, 132 + credIdLen);
    if (x.length !== 32 || y.length !== 32) {
      throw new Error("malformed EC coords in authenticatorData");
    }
    pubKey = new Uint8Array(65);
    pubKey[0] = 0x04;
    pubKey.set(x, 1);
    pubKey.set(y, 33);
  }
  if (pubKey.length !== 65 || pubKey[0] !== 0x04) {
    throw new Error(`unexpected public key shape len=${pubKey.length}`);
  }
  return { credentialId: bufferToBase64url(cred.rawId), publicKey: pubKey };
}

// The dicekey binding `Client` builds & simulates its AssembledTransaction
// with `publicKey` as the Stellar tx SOURCE account. A Smart Account is a
// contract `C...` address, which @stellar/stellar-sdk's TransactionBuilder
// rejects as a source ("invalid version byte"). smart-account-kit 0.3.0's
// signResimulateAndPrepare anyway REBUILDS the tx from scratch using the kit
// deployer G-account as source and layers the SA passkey __check_auth on top,
// so the source account on the incoming tx is irrelevant — it just has to be
// a valid funded G-account. Use the kit's deterministic deployer key.
function clients(_smartAccountId?: string): DicekeyClients {
  return makeDicekeyClients({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.networkPassphrase,
    contracts: cfg.contracts,
    publicKey: kit.deployerPublicKey,
  });
}

function errStr(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function createWallet(appName: string, userName: string) {
  log(`createWallet(${appName}, ${userName})`);
  const res = await kit.createWallet(appName, userName, {
    autoSubmit: true,
    // autoFund uses friendbot+native SAC transfer; only valid on networks
    // whose passphrase contains "Test". localnet passphrase is "Standalone
    // Network ; February 2017" so autoFund is skipped — the SA does not need
    // XLM (fees are paid by the kit deployer source account).
    //
    // userVerification: "required" forces Chrome to demand biometric / device
    // unlock (Touch ID, Windows Hello, DevTools VA's UV) on registration, so
    // the resulting credential's authData.flags has UV bit set. Subsequent
    // get() calls then satisfy webauthn_verifier's VerifiedBitNotSet (#3117).
    // residentKey: "required" makes the credential discoverable (so future
    // signAndSubmit doesn't need to keep the credentialId in IndexedDB).
    // authenticatorAttachment: "platform" pins Touch ID / Windows Hello and
    // skips Chrome's QR/USB hybrid fallback on hosts without a platform
    // authenticator (we use DevTools VA in that case).
    authenticatorSelection: {
      userVerification: "required",
      residentKey: "required",
      authenticatorAttachment: "platform",
    },
  });
  connectedContractId = res.contractId;
  connectedCredentialId = res.credentialId;
  log(`  -> contractId=${res.contractId} credentialId=${res.credentialId}`, "success");
  return {
    ok: true,
    contractId: res.contractId,
    credentialId: res.credentialId,
  };
}

async function connectWallet(opts: Record<string, unknown>) {
  log(`connectWallet(${JSON.stringify(opts)})`);
  const res = await kit.connectWallet(opts as never);
  if (!res) {
    log("  -> null (no wallet)", "error");
    return { ok: false, error: "connectWallet returned null" };
  }
  connectedContractId = res.contractId ?? connectedContractId;
  connectedCredentialId =
    (res as { credentialId?: string }).credentialId ?? connectedCredentialId;
  log(`  -> contractId=${res.contractId}`, "success");
  return { ok: true, contractId: res.contractId, credentialId: connectedCredentialId };
}

// Create a CallContract-scoped context rule under the connected HQ Smart
// Account. The OZ smart-account contract rejects a rule with no signers/
// policies (Error #3004), so the rule is created WITH its first staff passkey
// already attached. Returns the new ruleId AND that first staff credentialId.
// Authorised by the HQ root passkey (Default context rule).
async function addContextRule(
  scopeContractId: string,
  name: string,
  firstStaffApp: string,
  firstStaffUser: string,
) {
  log(
    `addContextRule(scope=${scopeContractId}, name=${name}, firstStaff=${firstStaffUser})`,
  );
  const ctxType = createCallContractContext(scopeContractId);

  // Mint the first staff passkey credential. createPlatformPasskey pins
  // Touch ID / Windows Hello / DevTools VA — see its docblock for why
  // kit.credentials.create can't be used here.
  const cred = await createPlatformPasskey(firstStaffApp, firstStaffUser);
  const signer = createWebAuthnSigner(
    cfg.smartAccount.webauthnVerifierAddress,
    cred.publicKey,
    cred.credentialId,
  );
  log(`  first staff credentialId=${cred.credentialId}`);

  const tx = await kit.rules.add(ctxType, name, [signer], new Map());
  const r = await kit.signAndSubmit(tx, {
    credentialId: connectedCredentialId ?? undefined,
  });
  if (!r.success) {
    log(`  -> add_context_rule submit FAILED: ${r.error}`, "error");
    return { ok: false, error: r.error, hash: r.hash };
  }
  // kit 0.3.0 API diff: add_context_rule is AssembledTransaction<ContextRule>,
  // so the simulated `tx.result` already carries the new rule (with its id).
  // 0.2.10's rules.getAll returned an AssembledTransaction needing .simulate();
  // 0.3.0's rules.getAll returns ContextRule[] directly (resolved via the
  // built-in low-id on-chain probe — no indexer required). Prefer tx.result;
  // fall back to enumerating by unique name.
  let ruleId: number | undefined = (
    tx as unknown as { result?: { id?: number; name?: string } }
  ).result?.id;
  if (ruleId == null) {
    const rules = (await kit.rules.getAll(ctxType)) as unknown as Array<{
      id: number;
      name: string;
    }>;
    const found = rules.filter((x) => x.name === name);
    if (found.length === 0) {
      log(
        `  -> rule submitted but not found by name; rules=${JSON.stringify(rules.map((x) => ({ id: x.id, name: x.name })))}`,
        "error",
      );
      return { ok: false, error: "rule not found after add", hash: r.hash };
    }
    ruleId = found[found.length - 1].id;
  }
  log(`  -> ruleId=${ruleId} firstStaffCred=${cred.credentialId} hash=${r.hash}`, "success");
  return {
    ok: true,
    ruleId,
    firstStaffCredentialId: cred.credentialId,
    hash: r.hash,
  };
}

// Add a passkey signer to an existing context rule. Returns the new staff
// credentialId. The transaction is authorised by the HQ root passkey.
async function addPasskeySigner(ruleId: number, appName: string, userName: string) {
  log(`addPasskeySigner(ruleId=${ruleId}, ${appName}, ${userName})`);
  const { credentialId, transaction } = await kit.signers.addPasskey(
    ruleId,
    appName,
    userName,
  );
  const r = await kit.signAndSubmit(transaction, {
    credentialId: connectedCredentialId ?? undefined,
  });
  if (!r.success) {
    log(`  -> addPasskey submit FAILED: ${r.error}`, "error");
    return { ok: false, error: r.error, credentialId, hash: r.hash };
  }
  log(`  -> staff credentialId=${credentialId} hash=${r.hash}`, "success");
  return { ok: true, credentialId, hash: r.hash };
}

// Case C (U2): visit-stamps.issue's auth tree makes THREE admin.require_auth
// calls — issue@visit-stamps, mint@beans-token, on_stamp_issued@reward-policy
// — so __check_auth receives 3 auth_contexts and AuthPayload.context_rule_ids
// must be a length-3 vector index-aligned to them (else SmartAccountError
// #3014 ContextRuleIdsLengthMismatch). One CallContract(visit-stamps) rule is
// insufficient. Create 3 CallContract rules (one per contract) all carrying
// the SAME staff passkey, so the single staff signature authorises every
// context. Returns the staff credential + the 3 rule ids in issue-call order.
async function setupStaffRules(staffApp: string, staffUser: string) {
  log(`setupStaffRules(staff=${staffUser})`);
  // Pin platform authenticator so Mac/Win prompt Touch ID / Hello directly
  // (kit.credentials.create drops authenticatorSelection — see helper docblock).
  const cred = await createPlatformPasskey(staffApp, staffUser);
  const signer = createWebAuthnSigner(
    cfg.smartAccount.webauthnVerifierAddress,
    cred.publicKey,
    cred.credentialId,
  );
  log(`  staff credentialId=${cred.credentialId}`);

  async function addRule(scope: string, name: string): Promise<number> {
    const ctxType = createCallContractContext(scope);
    const tx = await kit.rules.add(ctxType, name, [signer], new Map());
    const r = await kit.signAndSubmit(tx, {
      credentialId: connectedCredentialId ?? undefined,
    });
    if (!r.success) throw new Error(`add rule ${name}: ${r.error}`);
    let ruleId: number | undefined = (
      tx as unknown as { result?: { id?: number } }
    ).result?.id;
    if (ruleId == null) {
      const rules = (await kit.rules.getAll(ctxType)) as unknown as Array<{
        id: number;
        name: string;
      }>;
      const found = rules.filter((x) => x.name === name);
      if (found.length === 0) throw new Error(`rule ${name} not found`);
      ruleId = found[found.length - 1].id;
    }
    log(`  rule ${name} -> id=${ruleId}`);
    return ruleId;
  }

  try {
    // Order matters: index-aligned to the auth_contexts produced during
    // issue() execution (issue -> beans.mint -> reward-policy.on_stamp_issued).
    // OZ MAX_NAME_SIZE = 20 bytes — keep rule names short.
    const ruleVisitStamps = await addRule(
      cfg.contracts.visitStamps,
      "staff-vs",
    );
    const ruleBeans = await addRule(cfg.contracts.beansToken, "staff-beans");
    const rulePolicy = await addRule(
      cfg.contracts.rewardPolicy,
      "staff-policy",
    );
    // 4th rule: a CallContract(benefits) scope carrying the SAME staff passkey
    // so the staff signature can also authorise benefits.burn_from (Receive
    // Benefit). benefits.burn_from makes ONE admin.require_auth => a single
    // benefits auth_context, resolved against THIS rule id alone (NOT part of
    // issue()'s 3-context tree — issue() never touches benefits).
    const ruleBenefits = await addRule(cfg.contracts.benefits, "staff-benefit");
    return {
      ok: true as const,
      staffCredentialId: cred.credentialId,
      contextRuleIds: [ruleVisitStamps, ruleBeans, rulePolicy],
      benefitsRuleId: ruleBenefits,
    };
  } catch (e) {
    log(`  setupStaffRules FAILED: ${errStr(e)}`, "error");
    return { ok: false as const, error: errStr(e) };
  }
}

// initialize the 5 dicekey contracts with admin = HQ Smart Account C-address.
// initialize() does NOT call require_admin (only stores the admin), so it can
// Read-only simulate of is_initialized() on each of the 5 dicekey contracts.
// Returns { allInitialized, anyInitialized, perContract } so the setup UI can
// block / warn / proceed without invoking initialize() blindly (which traps
// UnreachableCodeReached when state already exists, ruining the next 4
// initializes in the loop).
async function checkInitialization(adminC?: string) {
  log(`checkInitialization`);
  const c = clients(connectedContractId ?? adminC ?? cfg.contracts.visitStamps);
  const probes: Array<[string, () => Promise<unknown>]> = [
    ["visitStamps", async () => c.visitStamps.is_initialized()],
    ["beansToken", async () => c.beansToken.is_initialized()],
    ["benefits", async () => c.benefits.is_initialized()],
    ["badges", async () => c.badges.is_initialized()],
    ["rewardPolicy", async () => c.rewardPolicy.is_initialized()],
  ];
  const perContract: Record<string, { initialized: boolean | null; error?: string }> = {};
  for (const [label, build] of probes) {
    try {
      const tx = (await build()) as unknown as {
        result?: boolean;
        simulate?: () => Promise<unknown>;
      };
      // 0.3.0 bindings: AssembledTransaction<boolean> — .result already
      // populated by simulate during build (read-only, no auth path).
      const v = tx.result;
      perContract[label] = { initialized: typeof v === "boolean" ? v : null };
      log(`  ${label}.is_initialized: ${perContract[label].initialized}`);
    } catch (e) {
      // Most likely the contract is a stale id (post-fresh-deploy without
      // bindings regen) or the kit's contractId resolution failed. Surface
      // as null so the UI can warn distinctly from a clean "false".
      perContract[label] = { initialized: null, error: errStr(e) };
      log(`  ${label}.is_initialized: ERROR ${errStr(e)}`, "error");
    }
  }
  const values = Object.values(perContract).map((v) => v.initialized);
  const allInitialized = values.every((v) => v === true);
  const anyInitialized = values.some((v) => v === true);
  return {
    ok: true,
    allInitialized,
    anyInitialized,
    perContract,
  };
}

// be invoked from the kit-deployer source account without HQ passkey auth.
// We submit each via signAndSubmit with the HQ credential so the kit's
// resimulate/submit path is exercised consistently.
async function initializeDicekey(adminC: string) {
  log(`initializeDicekey(admin=${adminC})`);
  const c = clients(connectedContractId ?? adminC);
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["visitStamps.initialize", async () => c.visitStamps.initialize({ admin: adminC })],
    ["beansToken.initialize", async () => c.beansToken.initialize({ admin: adminC })],
    ["benefits.initialize", async () => c.benefits.initialize({ admin: adminC })],
    ["badges.initialize", async () => c.badges.initialize({ admin: adminC })],
    [
      "rewardPolicy.initialize",
      async () =>
        c.rewardPolicy.initialize({
          admin: adminC,
          visit_stamps: cfg.contracts.visitStamps,
          benefits: cfg.contracts.benefits,
          badges: cfg.contracts.badges,
        }),
    ],
  ];
  const results: Record<string, unknown> = {};
  for (const [label, build] of steps) {
    try {
      const tx = (await build()) as never;
      const r = await kit.signAndSubmit(tx, {
        credentialId: connectedCredentialId ?? undefined,
      });
      results[label] = { success: r.success, hash: r.hash, error: r.error };
      log(
        `  ${label}: ${r.success ? "OK" : "FAIL " + r.error} (${r.hash})`,
        r.success ? "success" : "error",
      );
    } catch (e) {
      results[label] = { success: false, error: errStr(e) };
      log(`  ${label}: THREW ${errStr(e)}`, "error");
    }
  }
  const ok = Object.values(results).every(
    (v) => (v as { success?: boolean }).success,
  );
  return { ok, results };
}

// Wire visit-stamps -> beans-token and visit-stamps -> reward-policy.
// set_beans_contract / set_policy_contract DO call require_admin(HQ), so the
// HQ passkey must sign (auth scope = visit-stamps contract call).
async function wireContracts(adminC: string) {
  log(`wireContracts(admin=${adminC})`);
  const c = clients(connectedContractId ?? adminC);
  const steps: Array<[string, () => Promise<unknown>]> = [
    [
      "set_beans_contract",
      async () =>
        c.visitStamps.set_beans_contract({
          admin: adminC,
          beans_contract: cfg.contracts.beansToken,
        }),
    ],
    [
      "set_policy_contract",
      async () =>
        c.visitStamps.set_policy_contract({
          admin: adminC,
          policy_contract: cfg.contracts.rewardPolicy,
        }),
    ],
  ];
  const results: Record<string, unknown> = {};
  for (const [label, build] of steps) {
    try {
      const tx = (await build()) as never;
      const r = await kit.signAndSubmit(tx, {
        credentialId: connectedCredentialId ?? undefined,
      });
      results[label] = { success: r.success, hash: r.hash, error: r.error };
      log(
        `  ${label}: ${r.success ? "OK" : "FAIL " + r.error} (${r.hash})`,
        r.success ? "success" : "error",
      );
    } catch (e) {
      results[label] = { success: false, error: errStr(e) };
      log(`  ${label}: THREW ${errStr(e)}`, "error");
    }
  }
  const ok = Object.values(results).every(
    (v) => (v as { success?: boolean }).success,
  );
  return { ok, results };
}

// THE U2 MEASUREMENT. Staff passkey (staffCredentialId) calls
// visit-stamps.issue(admin=HQ, to, venue). issue() internally cross-calls
// beans-token.mint(admin=HQ,...) and reward-policy.on_stamp_issued(admin=HQ,
// ...), each of which require_admin(HQ) => HQ.__check_auth. Whether one
// CallContract(visit-stamps) rule authorises the whole tree is the open
// question.
async function issueStamp(
  adminC: string,
  toC: string,
  venue: string,
  staffCredentialId: string,
  contextRuleIds: number[],
) {
  log(
    `issueStamp(admin=${adminC}, to=${toC}, venue=${venue}, staffCred=${staffCredentialId}, ruleIds=[${contextRuleIds.join(",")}])`,
  );
  const c = clients(connectedContractId ?? adminC);
  try {
    const tx = await c.visitStamps.issue({
      admin: adminC,
      to: toC,
      venue: venue as never,
    });
    // issue()'s auth tree = 3 admin.require_auth calls (issue@visit-stamps,
    // mint@beans-token, on_stamp_issued@reward-policy). OZ __check_auth needs
    // AuthPayload.context_rule_ids index-aligned to those 3 auth_contexts
    // (kit 0.3.0: resolveContextRuleIds(entry,index) callback). Return the
    // 3 staff rule ids [visit-stamps, beans-token, reward-policy] in order.
    const r = await kit.signAndSubmit(tx as never, {
      credentialId: staffCredentialId,
      resolveContextRuleIds: () => contextRuleIds,
    });
    if (!r.success) {
      log(`  -> issue FAILED: ${r.error}`, "error");
      return { ok: false, error: r.error, hash: r.hash };
    }
    log(`  -> issue OK hash=${r.hash}`, "success");
    return { ok: true, hash: r.hash };
  } catch (e) {
    log(`  -> issue THREW: ${errStr(e)}`, "error");
    return { ok: false, error: errStr(e) };
  }
}

// The generated dicekey binding methods are async and auto-simulate on
// build, so the resolved AssembledTransaction already carries `.result`.
// (Earlier code called `.simulate()` on the unresolved Promise -> "tx.simulate
// is not a function".)
async function readStampCount(ownerC: string) {
  log(`readStampCount(${ownerC})`);
  const c = clients(ownerC);
  const tx = await c.visitStamps.stamp_count({ owner: ownerC });
  const v = (tx as { result?: unknown }).result;
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? NaN);
  log(`  -> stamp_count=${n}`, "success");
  return { ok: true, value: n };
}

async function getBeansBalance(ownerC: string) {
  log(`getBeansBalance(${ownerC})`);
  const c = clients(ownerC);
  const tx = await c.beansToken.balance({ id: ownerC });
  const v = (tx as { result?: unknown }).result;
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? NaN);
  log(`  -> beans balance=${n}`, "success");
  return { ok: true, value: n };
}

async function getBeansAllowance(fromC: string, spenderC: string) {
  log(`getBeansAllowance(from=${fromC}, spender=${spenderC})`);
  const c = clients(fromC);
  const tx = await c.beansToken.allowance({ from: fromC, spender: spenderC });
  const v = (tx as { result?: unknown }).result;
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? NaN);
  log(`  -> allowance=${n}`, "success");
  return { ok: true, value: n };
}

async function getBenefitsBalance(ownerC: string) {
  log(`getBenefitsBalance(${ownerC})`);
  const c = clients(ownerC);
  const tx = await c.benefits.balance({ owner: ownerC });
  const v = (tx as { result?: unknown }).result;
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? NaN);
  log(`  -> benefits balance=${n}`, "success");
  return { ok: true, value: n };
}

async function listBenefitIds(ownerC: string) {
  log(`listBenefitIds(${ownerC})`);
  const c = clients(ownerC);
  const tx = await c.benefits.list_tokens({ owner: ownerC });
  const v = ((tx as { result?: unknown }).result ?? []) as Array<
    bigint | number
  >;
  const ids = v.map((x) => (typeof x === "bigint" ? Number(x) : Number(x)));
  log(`  -> ids=[${ids.join(",")}]`, "success");
  return { ok: true, ids };
}

// Customer grants the HQ Smart Account a beans allowance. Signed by the
// CUSTOMER credential. approve makes ONE from.require_auth (the customer SA)
// — its OZ Default context rule (single rule, index 0) authorises it, so no
// resolveContextRuleIds override is needed (kit resolves to the Default rule).
async function approveBeans(
  customerC: string,
  customerCredentialId: string,
  hqC: string,
  amount: number,
) {
  log(
    `approveBeans(customer=${customerC}, spender(HQ)=${hqC}, amount=${amount})`,
  );
  const c = clients(customerC);
  try {
    const tx = await c.beansToken.approve({
      from: customerC,
      spender: hqC,
      amount: BigInt(amount) as never,
    });
    const r = await kit.signAndSubmit(tx as never, {
      credentialId: customerCredentialId,
    });
    if (!r.success) {
      log(`  -> approve FAILED: ${r.error}`, "error");
      return { ok: false, error: r.error, hash: r.hash };
    }
    log(`  -> approve OK hash=${r.hash}`, "success");
    return { ok: true, hash: r.hash };
  } catch (e) {
    log(`  -> approve THREW: ${errStr(e)}`, "error");
    return { ok: false, error: errStr(e) };
  }
}

// HQ mints a benefit voucher to a customer. mint() calls require_admin(HQ) =>
// ONE admin.require_auth (HQ SA). Signed by the HQ ROOT credential against its
// Default rule (the kit resolves the single Default context rule).
async function mintBenefit(
  hqC: string,
  hqCredentialId: string,
  toC: string,
  kind: string,
  expiresAt: number,
) {
  log(`mintBenefit(admin(HQ)=${hqC}, to=${toC}, kind=${kind})`);
  const c = clients(hqC);
  try {
    const tx = await c.benefits.mint({
      admin: hqC,
      to: toC,
      kind: kind as never,
      expires_at: BigInt(expiresAt) as never,
    });
    const r = await kit.signAndSubmit(tx as never, {
      credentialId: hqCredentialId,
    });
    if (!r.success) {
      log(`  -> mintBenefit FAILED: ${r.error}`, "error");
      return { ok: false, error: r.error, hash: r.hash };
    }
    // mint() returns the new token id (the resolved AssembledTransaction's
    // .result carries the simulated value).
    const idv = (tx as unknown as { result?: unknown }).result;
    const tokenId =
      typeof idv === "bigint" ? Number(idv) : Number(idv ?? NaN);
    log(`  -> mintBenefit OK tokenId=${tokenId} hash=${r.hash}`, "success");
    return { ok: true, hash: r.hash, tokenId };
  } catch (e) {
    log(`  -> mintBenefit THREW: ${errStr(e)}`, "error");
    return { ok: false, error: errStr(e) };
  }
}

// Staff burns a customer's beans via the HQ allowance (Use Beans). burn_from
// makes ONE spender.require_auth (HQ SA) => a single beans-token auth_context,
// resolved against the single beans-token staff rule.
async function staffUseBeans(
  hqC: string,
  customerC: string,
  amount: number,
  staffCredentialId: string,
  beansRuleId: number,
) {
  log(
    `staffUseBeans(HQ=${hqC}, customer=${customerC}, amount=${amount}, beansRule=${beansRuleId})`,
  );
  const c = clients(hqC);
  try {
    const tx = await c.beansToken.burn_from({
      spender: hqC,
      from: customerC,
      amount: BigInt(amount) as never,
    });
    const r = await kit.signAndSubmit(tx as never, {
      credentialId: staffCredentialId,
      resolveContextRuleIds: () => [beansRuleId],
    });
    if (!r.success) {
      log(`  -> staffUseBeans FAILED: ${r.error}`, "error");
      return { ok: false, error: r.error, hash: r.hash };
    }
    log(`  -> staffUseBeans OK hash=${r.hash}`, "success");
    return { ok: true, hash: r.hash };
  } catch (e) {
    log(`  -> staffUseBeans THREW: ${errStr(e)}`, "error");
    return { ok: false, error: errStr(e) };
  }
}

// Staff burns a customer's benefit voucher via benefits.burn_from (Receive
// Benefit). burn_from makes ONE admin.require_auth (HQ SA) => a single
// benefits auth_context, resolved against the single benefits staff rule.
async function staffReceiveBenefit(
  hqC: string,
  customerC: string,
  tokenId: number,
  staffCredentialId: string,
  benefitsRuleId: number,
) {
  log(
    `staffReceiveBenefit(HQ=${hqC}, customer=${customerC}, tokenId=${tokenId}, benefitsRule=${benefitsRuleId})`,
  );
  const c = clients(hqC);
  try {
    const tx = await c.benefits.burn_from({
      admin: hqC,
      owner: customerC,
      token_id: BigInt(tokenId) as never,
    });
    const r = await kit.signAndSubmit(tx as never, {
      credentialId: staffCredentialId,
      resolveContextRuleIds: () => [benefitsRuleId],
    });
    if (!r.success) {
      log(`  -> staffReceiveBenefit FAILED: ${r.error}`, "error");
      return { ok: false, error: r.error, hash: r.hash };
    }
    log(`  -> staffReceiveBenefit OK hash=${r.hash}`, "success");
    return { ok: true, hash: r.hash };
  } catch (e) {
    log(`  -> staffReceiveBenefit THREW: ${errStr(e)}`, "error");
    return { ok: false, error: errStr(e) };
  }
}

// Recreate the kit (fresh in-memory storage) so a previously created
// credential from CDP addCredential can be connected to without stale session
// state. Used between HQ setup and staff issue phases if needed.
function resetKit() {
  kit = createKit({ storage });
  connectedContractId = null;
  connectedCredentialId = null;
  return { ok: true };
}

declare global {
  interface Window {
    saHarness: typeof api;
  }
}

const api = {
  createWallet,
  connectWallet,
  addContextRule,
  addPasskeySigner,
  setupStaffRules,
  checkInitialization,
  initializeDicekey,
  wireContracts,
  issueStamp,
  readStampCount,
  getBeansBalance,
  getBeansAllowance,
  getBenefitsBalance,
  listBenefitIds,
  approveBeans,
  mintBenefit,
  staffUseBeans,
  staffReceiveBenefit,
  resetKit,
  _config: () => ({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.networkPassphrase,
    contracts: cfg.contracts,
    rpId: cfg.smartAccount.rpId,
    accountWasmHash: cfg.smartAccount.accountWasmHash,
    webauthnVerifierAddress: cfg.smartAccount.webauthnVerifierAddress,
  }),
};

window.saHarness = api;
log("window.saHarness ready", "success");

// ===========================================================================
// Setup UI wiring — drives the buttons in index.html through the same API
// the Node sa-setup.mjs uses. Each step persists its result into setupState
// so later steps can chain; the final .env block is rendered from that state.
// Real Touch ID / Windows Hello on the host browser signs each step (or the
// DevTools Virtual Authenticator if no platform authenticator is available).
// ===========================================================================

type SetupState = {
  hq?: { contractId: string; credentialId: string };
  initWired?: boolean;
  staffRules?: {
    contextRuleIds: number[];
    benefitsRuleId: number;
    staffCredentialId: string;
    staffName: string;
  };
};
const setupState: SetupState = {};

// 🔵 Single-shot bootstrap guard. When VITE_HQ_SMART_ACCOUNT is already set
//    (= the env reflects a prior successful run), re-running Step 1 would
//    create a second HQ that the deployed contracts wouldn't recognise as
//    admin — `initialize` would trap `already initialized` (or the new HQ
//    would be silently powerless against the old contracts). Lock the UI
//    instead of letting the user discover that mid-WebAuthn.
const hqLocked = cfg.smartAccount.hqSmartAccount.length > 0;

const $ = (id: string) => document.getElementById(id);

function setResult(id: string, text: string, kind: "" | "ok" | "err" = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "result" + (kind ? " " + kind : "");
}

function setBusy(buttonId: string, busy: boolean, restoreLabel?: string) {
  const b = $(buttonId) as HTMLButtonElement | null;
  if (!b) return;
  b.disabled = busy;
  if (busy) {
    b.dataset.label = b.textContent || "";
    b.textContent = "Working…";
  } else if (restoreLabel !== undefined) {
    b.textContent = restoreLabel || b.dataset.label || "";
  } else {
    b.textContent = b.dataset.label || b.textContent || "";
  }
}

function renderEnvBlock() {
  const el = $("envBlock");
  const copyBtn = $("btnCopyEnv") as HTMLButtonElement | null;
  if (!el) return;
  const { hq, initWired, staffRules } = setupState;
  if (!hq || !initWired || !staffRules) {
    el.textContent = "— 上のステップを完了すると出力されます —";
    if (copyBtn) copyBtn.disabled = true;
    return;
  }
  const lines = [
    `VITE_HQ_SMART_ACCOUNT=${hq.contractId}`,
    `VITE_HQ_ROOT_CREDENTIAL_ID=${hq.credentialId}`,
    `VITE_HQ_STAFF_CONTEXT_RULE_ID=${staffRules.contextRuleIds[0]}`,
    `VITE_HQ_STAFF_RULE_IDS=${staffRules.contextRuleIds.join(",")}`,
    `VITE_HQ_STAFF_BENEFITS_RULE_ID=${staffRules.benefitsRuleId}`,
    // 🟡 The first staff registered above is a real signer on the 3 staff
    //    rules; exposing its credentialId + name lets staff-app skip the
    //    redundant enrollDevice on this same machine (passkey is rpId=
    //    "localhost"-scoped, so the credential created at :5180 is reusable
    //    by :5174). loadStoredStaffCredential falls back to these env vars
    //    when localStorage is empty.
    `VITE_HQ_STAFF_CREDENTIAL_ID=${staffRules.staffCredentialId}`,
    `VITE_HQ_STAFF_NAME=${staffRules.staffName}`,
  ];
  el.textContent = lines.join("\n");
  if (copyBtn) copyBtn.disabled = false;
}

function refreshButtons() {
  const createBtn = $("btnCreateHq") as HTMLButtonElement | null;
  const initBtn = $("btnInitWire") as HTMLButtonElement | null;
  const staffBtn = $("btnStaffRules") as HTMLButtonElement | null;
  // hqLocked wins over the normal step-chain enable rules so re-running an
  // already-bootstrapped network can't accidentally fire a WebAuthn prompt.
  if (createBtn) createBtn.disabled = hqLocked;
  if (initBtn) initBtn.disabled = hqLocked || !setupState.hq;
  if (staffBtn) staffBtn.disabled = hqLocked || !setupState.initWired;
  renderEnvBlock();
}

function renderNetwork() {
  const el = $("net");
  if (!el) return;
  el.textContent =
    `rpId         ${cfg.smartAccount.rpId}\n` +
    `network      ${cfg.networkPassphrase}\n` +
    `rpc          ${cfg.rpcUrl}\n` +
    `visitStamps  ${cfg.contracts.visitStamps}\n` +
    `beansToken   ${cfg.contracts.beansToken}\n` +
    `benefits     ${cfg.contracts.benefits}\n` +
    `badges       ${cfg.contracts.badges}\n` +
    `rewardPolicy ${cfg.contracts.rewardPolicy}`;
}

function inputValue(id: string): string {
  const el = $(id) as HTMLInputElement | null;
  return (el?.value || "").trim();
}

async function onCreateHq() {
  const appName = inputValue("hqAppName") || "dicekey HQ";
  const userName = inputValue("hqUserName") || "hq-admin";
  setBusy("btnCreateHq", true);
  setResult("resultHq", "creating wallet… (passkey の承認が必要です)");
  try {
    const res = await createWallet(appName, userName);
    if (!res.ok) {
      setResult("resultHq", `FAILED: ${JSON.stringify(res)}`, "err");
      return;
    }
    setupState.hq = {
      contractId: res.contractId,
      credentialId: res.credentialId,
    };
    setResult(
      "resultHq",
      `contractId   ${res.contractId}\ncredentialId ${res.credentialId}`,
      "ok",
    );
    refreshButtons();
  } catch (e) {
    setResult("resultHq", `THREW: ${errStr(e)}`, "err");
  } finally {
    setBusy("btnCreateHq", false, "Create HQ Wallet");
  }
}

// Classify an error string to a more actionable hint. UnreachableCodeReached
// during initialize means the contract's "already initialized" assert tripped
// — the deploy is stale (someone else, e.g. just localnet, initialized these
// contracts with a different admin). The only real fix is fresh deploy.
function isAlreadyInitializedError(s: string): boolean {
  return s.includes("UnreachableCodeReached");
}

async function onInitWire() {
  if (!setupState.hq) return;
  const admin = setupState.hq.contractId;
  setBusy("btnInitWire", true);
  setResult("resultInitWire", "checking existing initialization state…");

  // Precheck: read-only is_initialized() across the 5 contracts.
  try {
    const probe = await checkInitialization(admin);
    if (probe.allInitialized) {
      setResult(
        "resultInitWire",
        "全 5 コントラクトが既に initialize 済みです。" +
          "別の HQ で deploy 済みのコントラクトは再利用できません — " +
          "ターミナルで `just deploy-localnet && just bindings` を実行し、" +
          "その後 Step 1 から再度やり直してください。",
        "err",
      );
      return;
    }
    if (probe.anyInitialized) {
      const partial = Object.entries(probe.perContract)
        .map(([k, v]) => `${k}=${v.initialized}`)
        .join(", ");
      setResult(
        "resultInitWire",
        "コントラクトの初期化状態が中途半端です: " +
          partial +
          " — `just deploy-localnet && just bindings` で fresh deploy してから Step 1 から再開してください。",
        "err",
      );
      return;
    }
  } catch (e) {
    // Precheck shouldn't block the user if the read-only probe itself fails
    // (e.g. stale bindings vs new contract id). Log and proceed.
    log(`  precheck error (continuing): ${errStr(e)}`, "error");
  }

  setResult(
    "resultInitWire",
    "initialize 5 contracts → wire admin (passkey 承認が複数回必要です)",
  );
  try {
    const initRes = await initializeDicekey(admin);
    if (!initRes.ok) {
      const errs = Object.values(initRes.results)
        .map((r) => (r as { error?: string }).error || "")
        .filter(Boolean);
      const initializedHit = errs.some(isAlreadyInitializedError);
      const hint = initializedHit
        ? "\n\n→ 'UnreachableCodeReached' は『既に initialize 済み』を意味します。" +
          "別の HQ で初期化済みなので、`just deploy-localnet && just bindings` で fresh deploy し、" +
          "Step 1 から再実行してください。"
        : "";
      setResult(
        "resultInitWire",
        `initialize FAILED:\n${JSON.stringify(initRes.results, null, 2)}${hint}`,
        "err",
      );
      return;
    }
    const wireRes = await wireContracts(admin);
    if (!wireRes.ok) {
      // 🟡 Intent: detect WebAuthn UV bit failure (#3117) at the wire step.
      //    wire is the first call that triggers HQ SA's __check_auth, so if the
      //    browser's authenticator returns assertions with UV=0 (e.g. DevTools
      //    Virtual Authenticator added without "Supports user verification",
      //    or per-VA "User verified" toggle OFF) the OZ webauthn verifier
      //    traps Error(Contract, #3117) VerifiedBitNotSet. The raw JSON dump is
      //    opaque to operators — translate to an actionable Japanese hint.
      const errs = Object.values(wireRes.results)
        .map((r) => (r as { error?: string }).error || "")
        .join("\n");
      const uvFailed = errs.includes("#3117");
      const hint = uvFailed
        ? "\n\n→ #3117 (VerifiedBitNotSet) はパスキー認証時に User Verified bit が立っていません。" +
          "Chrome DevTools → WebAuthn パネルで Virtual Authenticator を再作成し、" +
          "『Supports user verification』を ON、『Is user verified』も ON にしてください。" +
          "macOS Touch ID / Windows Hello を使う場合はシステムのロック解除（生体認証）が必要です。" +
          "認証器を直してから Step 1（Create HQ Wallet）からやり直してください。"
        : "";
      setResult(
        "resultInitWire",
        `wire FAILED:\n${JSON.stringify(wireRes.results, null, 2)}${hint}`,
        "err",
      );
      return;
    }
    setupState.initWired = true;
    setResult(
      "resultInitWire",
      "initialize + wire: OK (5 contracts admin=HQ, visit-stamps wired to beans+policy)",
      "ok",
    );
    refreshButtons();
  } catch (e) {
    setResult("resultInitWire", `THREW: ${errStr(e)}`, "err");
  } finally {
    setBusy("btnInitWire", false, "Initialize + Wire");
  }
}

async function onSetupStaffRules() {
  if (!setupState.initWired) return;
  const staffApp = inputValue("staffAppName") || "dicekey Staff";
  const staffUser = inputValue("staffUserName") || "shibuya-tanaka";
  setBusy("btnStaffRules", true);
  setResult(
    "resultStaffRules",
    "creating staff passkey + 4 context rules… (passkey 承認が複数回必要です)",
  );
  try {
    const res = await setupStaffRules(staffApp, staffUser);
    if (!res.ok) {
      setResult("resultStaffRules", `FAILED: ${res.error}`, "err");
      return;
    }
    setupState.staffRules = {
      contextRuleIds: res.contextRuleIds,
      benefitsRuleId: res.benefitsRuleId,
      staffCredentialId: res.staffCredentialId,
      staffName: staffUser,
    };
    setResult(
      "resultStaffRules",
      `ruleIds      ${res.contextRuleIds.join(",")}\n` +
        `benefitsRule ${res.benefitsRuleId}\n` +
        `staffCred    ${res.staffCredentialId}`,
      "ok",
    );
    refreshButtons();
  } catch (e) {
    setResult("resultStaffRules", `THREW: ${errStr(e)}`, "err");
  } finally {
    setBusy("btnStaffRules", false, "Setup Staff Rules");
  }
}

async function onCopyEnv() {
  const el = $("envBlock");
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent || "");
    setResult("resultCopy", "copied to clipboard", "ok");
  } catch (e) {
    setResult("resultCopy", `clipboard write failed: ${errStr(e)}`, "err");
  }
}

renderNetwork();
if (hqLocked) {
  const banner = $("hqLockedBanner");
  if (banner) banner.hidden = false;
  log(
    `hqLocked: VITE_HQ_SMART_ACCOUNT=${cfg.smartAccount.hqSmartAccount} — Step 1-3 disabled`,
    "info",
  );
}
$("btnCreateHq")?.addEventListener("click", onCreateHq);
$("btnInitWire")?.addEventListener("click", onInitWire);
$("btnStaffRules")?.addEventListener("click", onSetupStaffRules);
$("btnCopyEnv")?.addEventListener("click", onCopyEnv);
refreshButtons();

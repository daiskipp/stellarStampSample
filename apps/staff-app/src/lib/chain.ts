// Real localnet chain reads + the staff issue/burn transactions.
//
// Reads are read-only `simulateTransaction` (no auth) via the typed
// @dicekey/contracts bindings — same proven path as customer-app/src/lib/chain
// and tools/sa-harness. Writes go through the kit's signAndSubmit with the
// staff credential resolved against the 3 staff context rule ids (U2 case C).

import { getConfig, signAndSubmitTx } from "@dicekey/sdk";
import { makeDicekeyClients } from "@dicekey/contracts";
import { ensureKit } from "./passkey";

// Venues the contracts key venue_count by.
export const VENUES: { id: string; name: string }[] = [
  { id: "shibuya", name: "dicekey 渋谷店" },
  { id: "shinjuku", name: "dicekey 新宿店" },
  { id: "kyoto", name: "dicekey 京都店" },
];

export const VENUE_NAMES: Record<string, string> = Object.fromEntries(
  VENUES.map((v) => [v.id, v.name]),
);

// The binding Client builds its AssembledTransaction tx SOURCE from publicKey.
// @stellar/stellar-sdk's TransactionBuilder rejects a Smart Account C-address
// as a source, and the kit anyway rebuilds the tx from the deployer G-account
// + layers the SA passkey __check_auth on top, so the source only has to be a
// syntactically valid funded G-address — use the kit's deterministic deployer.
function clients() {
  const cfg = getConfig();
  return makeDicekeyClients({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.networkPassphrase,
    contracts: cfg.contracts,
    publicKey: ensureKit().deployerPublicKey,
  });
}

function toNum(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
}

export interface CustomerSnapshot {
  stampCount: number;
  beansBalance: number;
  venueBreakdown: Record<string, number>;
}

/** Read a customer SA's stamp count, beans balance, and per-venue counts. */
export async function getCustomerSnapshot(
  saAddress: string,
): Promise<CustomerSnapshot> {
  const c = clients();
  const [stampTx, beansTx, ...venueTxs] = await Promise.all([
    c.visitStamps.stamp_count({ owner: saAddress }),
    c.beansToken.balance({ id: saAddress }),
    ...VENUES.map((v) =>
      c.visitStamps.venue_count({ owner: saAddress, venue: v.id }),
    ),
  ]);
  const venueBreakdown: Record<string, number> = {};
  VENUES.forEach((v, i) => {
    venueBreakdown[v.id] = toNum(venueTxs[i]?.result);
  });
  return {
    stampCount: toNum(stampTx.result),
    beansBalance: toNum(beansTx.result),
    venueBreakdown,
  };
}

/** beans-token total supply (a real chain value for the dashboard). */
export async function getBeansTotalSupply(): Promise<number> {
  const c = clients();
  const tx = await c.beansToken.total_supply();
  return toNum(tx.result);
}

export interface BenefitToken {
  id: number;
  kind: string;
  label: string;
}

/** Benefit-voucher NFTs owned by a customer SA. */
export async function getBenefits(
  saAddress: string,
): Promise<BenefitToken[]> {
  const c = clients();
  const listTx = await c.benefits.list_tokens({ owner: saAddress });
  const ids = (listTx.result ?? []) as Array<bigint | number>;
  const tokens = await Promise.all(
    ids.map(async (id) => {
      const tx = await c.benefits.get_token({ token_id: id as never });
      return tx.result as
        | { id: bigint | number; kind: string; meta: { name: string } }
        | undefined;
    }),
  );
  return tokens
    .filter((t): t is NonNullable<typeof t> => t != null)
    .map((t) => ({
      id: toNum(t.id),
      kind: t.kind,
      label: t.meta?.name || t.kind,
    }));
}

export interface IssueResult {
  ok: boolean;
  hash?: string;
  error?: string;
  /** Post-issue chain reads (only when ok). */
  stampCount?: number;
  beansBalance?: number;
}

/**
 * Issue a visit stamp to a customer SA, signed by the staff passkey.
 *
 * U2 case C (proven by scripts/sa-setup.mjs): visit-stamps.issue's auth tree
 * makes 3 admin.require_auth calls — issue@visit-stamps, mint@beans-token,
 * on_stamp_issued@reward-policy — so the OZ __check_auth needs
 * context_rule_ids index-aligned to those 3 auth_contexts. We pass the staff
 * credential + the device's 3 staff rule ids in that exact order. One rule is
 * rejected with SmartAccountError #3014 (ContextRuleIdsLengthMismatch).
 */
export async function issueStamp(opts: {
  hqSmartAccount: string;
  customerSA: string;
  venue: string;
  staffCredentialId: string;
  ruleIds: number[];
}): Promise<IssueResult> {
  const c = clients();
  try {
    const tx = await c.visitStamps.issue({
      admin: opts.hqSmartAccount,
      to: opts.customerSA,
      venue: opts.venue as never,
    });
    const r = await signAndSubmitTx(tx as never, {
      credentialId: opts.staffCredentialId,
      resolveContextRuleIds: () => opts.ruleIds,
    });
    if (!r.success) {
      return { ok: false, error: r.error, hash: r.hash };
    }
    const snap = await getCustomerSnapshot(opts.customerSA);
    return {
      ok: true,
      hash: r.hash,
      stampCount: snap.stampCount,
      beansBalance: snap.beansBalance,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface BurnResult {
  ok: boolean;
  hash?: string;
  error?: string;
}

/**
 * Use Beans — burn the customer's beans on behalf of the store.
 *
 * AUTH CONSTRAINT (read contracts/dicekey-beans-token/src/lib.rs):
 *   pub fn burn(env, from, amount)   { from.require_auth(); ... }
 *   pub fn burn_from(spender, from, amount) { spender.require_auth(); ... }
 *
 * `burn` requires the CUSTOMER's auth (from = customer SA) — the HQ SA / staff
 * passkey CANNOT authorise spending a customer's balance, by design. The only
 * HQ-authorisable path is `burn_from(spender = HQ SA, from = customer)`, which
 * additionally needs a pre-existing customer -> HQ allowance. So this is a
 * single-auth_context call on beans-token (NOT the 3-context issue tree): the
 * staff signature resolves against the single beans-token staff rule.
 *
 * The customer grants the HQ allowance from customer-app (RewardsPage's
 * "店舗で使えるように承認" -> beans-token.approve, customer-authorised). Once
 * that allowance exists this burn_from succeeds; if it does not (or is too
 * small) the chain traps "insufficient allowance" and we surface a clear
 * Japanese hint instead of the raw error.
 */
export async function useBeans(opts: {
  hqSmartAccount: string;
  customerSA: string;
  amount: number;
  staffCredentialId: string;
  beansRuleId: number;
}): Promise<BurnResult> {
  const c = clients();
  try {
    const tx = await c.beansToken.burn_from({
      spender: opts.hqSmartAccount,
      from: opts.customerSA,
      amount: BigInt(opts.amount) as never,
    });
    const r = await signAndSubmitTx(tx as never, {
      credentialId: opts.staffCredentialId,
      // burn_from makes ONE spender.require_auth (HQ SA) -> 1 auth_context,
      // resolved against the single beans-token staff rule.
      resolveContextRuleIds: () => [opts.beansRuleId],
    });
    if (!r.success) {
      return { ok: false, error: explainBurnError(r.error), hash: r.hash };
    }
    return { ok: true, hash: r.hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: explainBurnError(msg) };
  }
}

/** Map raw chain errors to actionable Japanese messages for the counter. */
function explainBurnError(raw?: string): string {
  const s = raw ?? "不明なエラー";
  if (/insufficient allowance/i.test(s)) {
    return (
      "顧客が本部へ十分な beans 利用枠を承認していません。" +
      "顧客アプリの「店舗で使えるように承認」を実行してもらってください。" +
      `（詳細: ${s}）`
    );
  }
  if (/insufficient balance/i.test(s)) {
    return `顧客の beans 残高が不足しています。（詳細: ${s}）`;
  }
  return s;
}

/**
 * Receive Benefit — burn a customer's benefit voucher NFT at the counter.
 *
 * AUTH (read contracts/dicekey-benefits/src/lib.rs):
 *   pub fn burn(env, owner, token_id)            { owner.require_auth(); ... }
 *   pub fn burn_from(env, admin, owner, token_id){ require_admin(admin); ... }
 *
 * `burn` needs the voucher OWNER's auth (customer). `burn_from` is the new
 * admin-gated path: shared::require_admin(admin) => admin.require_auth() where
 * admin = the HQ Smart Account. It makes ONE admin.require_auth, i.e. a single
 * benefits auth_context (NOT issue()'s 3-context tree — issue never touches
 * benefits). The staff passkey signs it, resolved against the single benefits
 * staff CallContract rule (VITE_HQ_STAFF_BENEFITS_RULE_ID).
 */
export async function receiveBenefit(opts: {
  hqSmartAccount: string;
  customerSA: string;
  tokenId: number;
  staffCredentialId: string;
  benefitsRuleId: number;
}): Promise<BurnResult> {
  const c = clients();
  try {
    const tx = await c.benefits.burn_from({
      admin: opts.hqSmartAccount,
      owner: opts.customerSA,
      token_id: BigInt(opts.tokenId) as never,
    });
    const r = await signAndSubmitTx(tx as never, {
      credentialId: opts.staffCredentialId,
      // burn_from makes ONE admin.require_auth (HQ SA) -> 1 auth_context,
      // resolved against the single benefits staff rule.
      resolveContextRuleIds: () => [opts.benefitsRuleId],
    });
    if (!r.success) return { ok: false, error: r.error, hash: r.hash };
    return { ok: true, hash: r.hash };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

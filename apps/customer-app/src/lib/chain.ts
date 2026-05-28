// Real localnet chain reads for the customer's own Smart Account.
//
// Replaces the former demo mock layer. Every call is a read-only
// `simulateTransaction` (no auth, no signature) so it works for a Smart
// Account C-address owner.
//
// All reads use the typed @dicekey/contracts bindings (same path the proven
// tools/sa-harness uses): each method returns an AssembledTransaction that
// auto-simulates on build, so after `await tx` the value is in `tx.result`,
// already decoded to a bigint for u64/i128 (the @dicekey/sdk simulateNumber
// helper mis-decodes i128 balances to NaN, so it is intentionally not used).
//
// The binding clients are built with publicKey = the kit deployer G-account
// (a C-address tx source is rejected by TransactionBuilder); simulation never
// validates the source, it only needs a syntactically-usable G-address.

import { getConfig, signAndSubmitTx } from "@dicekey/sdk";
import { makeDicekeyClients } from "@dicekey/contracts";
import { ensureKit } from "./passkey";

// Venues the contracts key venue_count by.
export const VENUES: { id: string; name: string }[] = [
  { id: "shibuya", name: "dicekey 渋谷店" },
  { id: "shinjuku", name: "dicekey 新宿店" },
  { id: "kyoto", name: "dicekey 京都店" },
];

export interface ChainBenefit {
  id: number;
  kind: string;
  label: string;
  description: string;
  expiresAt: number; // ms epoch (0 = no expiry)
  daysLeft: number;
}

export interface ChainBadge {
  kind: string;
  label: string;
  awardedAt: number; // ms epoch
}

export interface CustomerData {
  stampCount: number;
  beansBalance: number;
  benefitCount: number;
  badgeCount: number;
  venueBreakdown: Record<string, number>;
  benefits: ChainBenefit[];
  badges: ChainBadge[];
}

// The binding Client builds an AssembledTransaction whose Stellar tx SOURCE
// is `publicKey`. @stellar/stellar-sdk's TransactionBuilder rejects a Smart
// Account `C...` address as a source ("invalid version byte"), so we use the
// kit's deterministic deployer G-account (same fix as tools/sa-harness's
// `clients()`). These are read-only simulate calls — the source account is
// never validated, it only has to be a syntactically valid G-address.
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

// Contract timestamps are unix seconds (u64). Convert to ms; treat 0 / huge
// values defensively.
function secToMs(v: unknown): number {
  const n = toNum(v);
  return n > 0 ? n * 1000 : 0;
}

function daysLeft(expiresAtMs: number): number {
  if (expiresAtMs <= 0) return 0;
  return Math.max(0, Math.floor((expiresAtMs - Date.now()) / 86_400_000));
}

/** Read everything the customer pages need for one Smart Account address. */
export async function getCustomerData(
  saAddress: string,
): Promise<CustomerData> {
  const c = clients();

  const [stampTx, beansTx, ...venueTxs] = await Promise.all([
    c.visitStamps.stamp_count({ owner: saAddress }),
    c.beansToken.balance({ id: saAddress }),
    ...VENUES.map((v) =>
      c.visitStamps.venue_count({ owner: saAddress, venue: v.id }),
    ),
  ]);

  const stampCount = toNum(stampTx.result);
  const beansBalance = toNum(beansTx.result);

  const venueBreakdown: Record<string, number> = {};
  VENUES.forEach((v, i) => {
    venueBreakdown[v.id] = toNum(venueTxs[i]?.result);
  });

  const [benefits, badges] = await Promise.all([
    getBenefits(saAddress),
    getBadges(saAddress),
  ]);

  return {
    stampCount,
    beansBalance,
    benefitCount: benefits.length,
    badgeCount: badges.length,
    venueBreakdown,
    benefits,
    badges,
  };
}

/** Benefit-voucher NFTs owned by the SA. */
export async function getBenefits(
  saAddress: string,
): Promise<ChainBenefit[]> {
  const c = clients();
  const listTx = await c.benefits.list_tokens({ owner: saAddress });
  const ids = (listTx.result ?? []) as Array<bigint | number>;

  const tokens = await Promise.all(
    ids.map(async (id) => {
      const tx = await c.benefits.get_token({ token_id: id as never });
      return tx.result as
        | {
            id: bigint | number;
            kind: string;
            expires_at: bigint | number;
            meta: { name: string; description: string };
          }
        | undefined;
    }),
  );

  return tokens
    .filter((t): t is NonNullable<typeof t> => t != null)
    .map((t) => {
      const expiresAt = secToMs(t.expires_at);
      return {
        id: toNum(t.id),
        kind: t.kind,
        label: t.meta?.name || t.kind,
        description: t.meta?.description || "",
        expiresAt,
        daysLeft: daysLeft(expiresAt),
      };
    });
}

export interface ApproveResult {
  ok: boolean;
  hash?: string;
  error?: string;
  /** Post-approve on-chain allowance (only when ok). */
  allowance?: number;
}

/**
 * Grant the dicekey HQ Smart Account a beans allowance so the store can later
 * redeem (burn_from) the customer's beans at the counter.
 *
 * beans-token.approve(from = customer SA, spender = HQ SA, amount) makes ONE
 * from.require_auth — the customer's own auth. The customer SA's OZ smart
 * account has a single Default context rule, so the kit's default
 * resolveConnectedContextRuleIds resolves it (no override needed). Signed with
 * the customer's connected passkey credential.
 *
 * AUTH (read contracts/dicekey-beans-token/src/lib.rs):
 *   pub fn approve(env, from, spender, amount) { from.require_auth(); ... }
 *   pub fn burn_from(env, spender, from, amount) { spender.require_auth();
 *     assert!(allowance(from, spender) >= amount, "insufficient allowance"); }
 * So the store's burn_from(spender = HQ) only works AFTER this approval.
 */
export async function approveBeans(opts: {
  customerSA: string;
  customerCredentialId: string;
  amount: number;
}): Promise<ApproveResult> {
  const cfg = getConfig();
  const hq = cfg.smartAccount.hqSmartAccount;
  if (!hq) {
    return {
      ok: false,
      error:
        "本部 Smart Account が設定されていません (VITE_HQ_SMART_ACCOUNT)。",
    };
  }
  const c = clients();
  try {
    const tx = await c.beansToken.approve({
      from: opts.customerSA,
      spender: hq,
      amount: BigInt(opts.amount) as never,
    });
    const r = await signAndSubmitTx(tx as never, {
      credentialId: opts.customerCredentialId,
    });
    if (!r.success) return { ok: false, error: r.error, hash: r.hash };
    const allowTx = await c.beansToken.allowance({
      from: opts.customerSA,
      spender: hq,
    });
    return { ok: true, hash: r.hash, allowance: toNum(allowTx.result) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Current beans allowance the customer has granted the HQ Smart Account. */
export async function getHqBeansAllowance(
  customerSA: string,
): Promise<number> {
  const cfg = getConfig();
  const hq = cfg.smartAccount.hqSmartAccount;
  if (!hq) return 0;
  const c = clients();
  const tx = await c.beansToken.allowance({ from: customerSA, spender: hq });
  return toNum(tx.result);
}

/** Badge SBTs owned by the SA. */
export async function getBadges(saAddress: string): Promise<ChainBadge[]> {
  const c = clients();
  const listTx = await c.badges.list_badges({ owner: saAddress });
  const kinds = (listTx.result ?? []) as string[];

  const badges = await Promise.all(
    kinds.map(async (kind) => {
      const tx = await c.badges.get_badge({ owner: saAddress, kind });
      return tx.result as
        | {
            kind: string;
            awarded_at: bigint | number;
            meta: { name: string };
          }
        | undefined;
    }),
  );

  return badges
    .filter((b): b is NonNullable<typeof b> => b != null)
    .map((b) => ({
      kind: b.kind,
      label: b.meta?.name || b.kind,
      awardedAt: secToMs(b.awarded_at),
    }));
}

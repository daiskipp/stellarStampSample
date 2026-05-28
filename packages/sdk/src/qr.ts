// QR payload helpers for the staff-side stamp-issue scanner.
//
// The QR carries the customer's Smart Account C-address plus a short-lived
// envelope (iat / exp / nonce) so the staff app can reject expired or replayed
// scans. The schema reserves `sig` / `alg` so a future revision can add a real
// signature without changing the wire format. This sample uses `alg: "none"` —
// the QR is NOT a proof of ownership, it is a transport for the C-address with
// freshness metadata. Real-world deployments should switch to a signed scheme
// (e.g. WebAuthn assertion verified offchain).
//
// Format on the wire: JSON.stringify(payload) — the QR library encodes it
// directly. No base64 wrapper, keeps QR small enough for phone cameras.

export const QR_SCHEMA_VERSION = 1 as const;
export const QR_DEFAULT_TTL_SEC = 60;

export interface StampRequestQRv1 {
  v: 1;
  action: "issue_stamp";
  sa: string;
  iat: number;
  exp: number;
  nonce: string;
  alg?: "none";
  sig?: string;
}

export interface CreateStampRequestQROptions {
  sa: string;
  ttlSec?: number;
  now?: () => number;
  rng?: () => Uint8Array;
}

export interface CreateStampRequestQRResult {
  payload: StampRequestQRv1;
  text: string;
}

const C_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}

function defaultRng(): Uint8Array {
  const out = new Uint8Array(16);
  crypto.getRandomValues(out);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createStampRequestQR(
  opts: CreateStampRequestQROptions,
): CreateStampRequestQRResult {
  if (!C_ADDRESS_RE.test(opts.sa)) {
    throw new Error(`createStampRequestQR: invalid C-address: ${opts.sa}`);
  }
  const now = (opts.now ?? defaultNow)();
  const ttl = opts.ttlSec ?? QR_DEFAULT_TTL_SEC;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 3600) {
    throw new Error(`createStampRequestQR: ttlSec out of range: ${ttl}`);
  }
  const rng = (opts.rng ?? defaultRng)();
  const payload: StampRequestQRv1 = {
    v: 1,
    action: "issue_stamp",
    sa: opts.sa,
    iat: now,
    exp: now + ttl,
    nonce: toBase64Url(rng),
    alg: "none",
  };
  return { payload, text: JSON.stringify(payload) };
}

export type ParseResult =
  | { ok: true; payload: StampRequestQRv1 }
  | {
      ok: false;
      reason:
        | "not-json"
        | "schema"
        | "unsupported-version"
        | "unsupported-action";
    };

export function parseStampRequestQR(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, reason: "schema" };
  const o = raw as Record<string, unknown>;
  if (o.v !== QR_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported-version" };
  }
  if (o.action !== "issue_stamp") {
    return { ok: false, reason: "unsupported-action" };
  }
  if (
    typeof o.sa !== "string" ||
    typeof o.iat !== "number" ||
    typeof o.exp !== "number" ||
    typeof o.nonce !== "string"
  ) {
    return { ok: false, reason: "schema" };
  }
  const payload: StampRequestQRv1 = {
    v: 1,
    action: "issue_stamp",
    sa: o.sa,
    iat: o.iat,
    exp: o.exp,
    nonce: o.nonce,
    alg: o.alg === "none" ? "none" : undefined,
    sig: typeof o.sig === "string" ? o.sig : undefined,
  };
  return { ok: true, payload };
}

export interface VerifyOptions {
  now?: () => number;
  seenNonces?: Set<string>;
  // Allow small clock skew between customer and staff devices.
  clockSkewSec?: number;
}

export type VerifyResult =
  | { ok: true; sa: string; nonce: string }
  | {
      ok: false;
      reason: "expired" | "future-iat" | "replay" | "bad-sa";
    };

export function verifyStampRequestQR(
  payload: StampRequestQRv1,
  opts: VerifyOptions = {},
): VerifyResult {
  if (!C_ADDRESS_RE.test(payload.sa)) {
    return { ok: false, reason: "bad-sa" };
  }
  const now = (opts.now ?? defaultNow)();
  const skew = opts.clockSkewSec ?? 30;
  if (payload.iat - skew > now) return { ok: false, reason: "future-iat" };
  if (payload.exp + skew < now) return { ok: false, reason: "expired" };
  if (opts.seenNonces) {
    if (opts.seenNonces.has(payload.nonce)) {
      return { ok: false, reason: "replay" };
    }
    opts.seenNonces.add(payload.nonce);
  }
  return { ok: true, sa: payload.sa, nonce: payload.nonce };
}

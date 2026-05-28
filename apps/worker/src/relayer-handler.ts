import type { Context } from "hono";

// 🔵 Intent: kit's official RelayerResponse shape
//    (.oz-build/smart-account-kit/src/relayer.ts:22-43). errorCode strings are
//    string-matched by the kit so they must stay verbatim.
export type RelayerErrorCode =
  | "INVALID_PARAMS"
  | "INVALID_XDR"
  | "POOL_CAPACITY"
  | "SIMULATION_FAILED"
  | "ONCHAIN_FAILED"
  | "INVALID_TIME_BOUNDS"
  | "FEE_LIMIT_EXCEEDED"
  | "UNAUTHORIZED";

export interface RelayerResponse {
  success: boolean;
  transactionId?: string;
  hash?: string;
  status?: "SUCCESS" | "FAILED" | "PENDING";
  error?: string;
  errorCode?: RelayerErrorCode;
}

// 🟡 Intent: the handler talks to Stellar through this narrow interface so it
//    stays unit-testable (the real backend that builds + signs + submits lives
//    in stellar-backend.ts; production wires StellarRpcBackend into RelayerDeps).
export type SubmissionOutcome =
  | { status: "success"; hash: string }
  | { status: "pending"; hash: string }
  | { status: "simulation_failed"; error: string }
  | { status: "onchain_failed"; hash?: string; error: string };

export interface StellarBackend {
  submitFuncAuth(
    funcB64: string,
    authB64s: string[],
  ): Promise<SubmissionOutcome>;
  submitXdr(xdrB64: string): Promise<SubmissionOutcome>;
}

export interface RelayerDeps {
  backend: StellarBackend;
  // 🔵 Intent: csv from ALLOWED_CONTRACTS env. Empty list disables the gate
  //    (development convenience — production deploys must set it).
  allowedContracts: string[];
  // 🟡 Intent: injected so handler tests don't need real XDR. Production wires
  //    extractInvokeContractId from xdr-helpers.ts.
  extractTarget: (funcB64: string) => string | null;
}

type Body =
  | { kind: "func"; func: string; auth: string[] }
  | { kind: "xdr"; xdr: string }
  | { kind: "invalid"; errorCode: "INVALID_PARAMS" | "INVALID_XDR" };

function parseBody(raw: unknown): Body {
  if (!raw || typeof raw !== "object") {
    return { kind: "invalid", errorCode: "INVALID_PARAMS" };
  }
  const obj = raw as Record<string, unknown>;

  if ("xdr" in obj) {
    if (typeof obj.xdr !== "string" || obj.xdr.length === 0) {
      return { kind: "invalid", errorCode: "INVALID_XDR" };
    }
    return { kind: "xdr", xdr: obj.xdr };
  }

  if ("func" in obj || "auth" in obj) {
    const func = obj.func;
    const auth = obj.auth;
    if (typeof func !== "string" || !Array.isArray(auth)) {
      return { kind: "invalid", errorCode: "INVALID_PARAMS" };
    }
    if (!auth.every((a: unknown): a is string => typeof a === "string")) {
      return { kind: "invalid", errorCode: "INVALID_PARAMS" };
    }
    return { kind: "func", func, auth: auth as string[] };
  }

  return { kind: "invalid", errorCode: "INVALID_PARAMS" };
}

function toResponse(
  outcome: SubmissionOutcome,
): { body: RelayerResponse; status: number } {
  switch (outcome.status) {
    case "success":
      return {
        body: { success: true, hash: outcome.hash, status: "SUCCESS" },
        status: 200,
      };
    case "pending":
      // 🔵 Intent: kit's submitWithRelayer treats success:true as "now poll
      //    rpc.pollTransaction(hash)" (.oz-build/.../tx-ops.ts:128). Returning
      //    success+PENDING hands the poll off to the kit's own retry loop.
      return {
        body: { success: true, hash: outcome.hash, status: "PENDING" },
        status: 200,
      };
    case "simulation_failed":
      return {
        body: {
          success: false,
          errorCode: "SIMULATION_FAILED",
          error: outcome.error,
        },
        status: 502,
      };
    case "onchain_failed":
      return {
        body: {
          success: false,
          hash: outcome.hash,
          errorCode: "ONCHAIN_FAILED",
          error: outcome.error,
        },
        status: 502,
      };
  }
}

// 🔵 Intent: POST /relayer route — accepts kit's two payload shapes,
//    enforces the contract allowlist for the func/auth path, dispatches to
//    the Stellar backend, and serializes the outcome into kit's
//    RelayerResponse format. All Stellar / signing / DO work lives in
//    StellarBackend so this stays pure for unit tests.
export function createRelayerHandler(deps: RelayerDeps) {
  return async (c: Context): Promise<Response> => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json<RelayerResponse>(
        { success: false, errorCode: "INVALID_PARAMS" },
        400,
      );
    }

    const body = parseBody(raw);
    if (body.kind === "invalid") {
      return c.json<RelayerResponse>(
        { success: false, errorCode: body.errorCode },
        400,
      );
    }

    if (body.kind === "func") {
      const target = deps.extractTarget(body.func);
      if (
        target !== null &&
        deps.allowedContracts.length > 0 &&
        !deps.allowedContracts.includes(target)
      ) {
        return c.json<RelayerResponse>(
          {
            success: false,
            errorCode: "UNAUTHORIZED",
            error: `target ${target} not in allowlist`,
          },
          403,
        );
      }
      const outcome = await deps.backend.submitFuncAuth(body.func, body.auth);
      const { body: respBody, status } = toResponse(outcome);
      return c.json<RelayerResponse>(respBody, status as 200 | 502);
    }

    // body.kind === "xdr"
    const outcome = await deps.backend.submitXdr(body.xdr);
    const { body: respBody, status } = toResponse(outcome);
    return c.json<RelayerResponse>(respBody, status as 200 | 502);
  };
}

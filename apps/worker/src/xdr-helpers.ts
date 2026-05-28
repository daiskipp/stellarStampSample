import { StrKey, xdr } from "@stellar/stellar-sdk";

// 🟡 Intent: parse a base64 HostFunction XDR and return the C-address of the
//    target contract for `invokeContract` calls. Returns null for
//    deploy/upload functions (no single target) or on parse error so the
//    handler treats them as "cannot enforce allowlist" rather than rejecting
//    them outright. The deploy path normally takes the `{xdr}` route anyway.
export function extractInvokeContractId(funcB64: string): string | null {
  let func: xdr.HostFunction;
  try {
    func = xdr.HostFunction.fromXDR(funcB64, "base64");
  } catch {
    return null;
  }

  if (func.switch().name !== "hostFunctionTypeInvokeContract") {
    return null;
  }

  try {
    const addr = func.invokeContract().contractAddress();
    if (addr.switch().name !== "scAddressTypeContract") {
      return null;
    }
    const contractIdBytes = addr.contractId();
    return StrKey.encodeContract(
      Buffer.from(contractIdBytes as unknown as Uint8Array),
    );
  } catch {
    return null;
  }
}

// Soroban RPC client wrapper.

import {
  Account,
  Keypair,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { getConfig } from "./config.js";

let serverInstance: rpc.Server | null = null;

export function getServer(): rpc.Server {
  if (!serverInstance) {
    const config = getConfig();
    serverInstance = new rpc.Server(config.rpcUrl);
  }
  return serverInstance;
}

export function resetServer() {
  serverInstance = null;
}

/**
 * Simulate a read-only contract call and return the numeric result.
 *
 * Uses a throwaway source account — simulation verifies neither signatures nor
 * balances — so reads work for Smart Account (C-address) owners, which
 * `server.getAccount()` cannot resolve.
 */
export async function simulateNumber(op: xdr.Operation): Promise<number> {
  const server = getServer();
  const config = getConfig();
  const tx = new TransactionBuilder(
    new Account(Keypair.random().publicKey(), "0"),
    { fee: "100", networkPassphrase: config.networkPassphrase },
  )
    .addOperation(op)
    .setTimeout(30)
    .build();

  const response = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(response) && response.result) {
    return Number(response.result.retval.value());
  }
  return 0;
}

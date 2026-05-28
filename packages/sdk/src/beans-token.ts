// SDK for interacting with the dicekey-beans-token contract.

import {
  Contract,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { getConfig } from "./config.js";
import { simulateNumber } from "./client.js";

function contractId(): string {
  return getConfig().contracts.beansToken;
}

function contract(): Contract {
  return new Contract(contractId());
}

/// Build a transaction to mint beans. Caller must sign and submit.
export function buildMintBeansTx(
  admin: string,
  to: string,
  amount: number,
): xdr.Operation {
  return contract().call(
    "mint",
    new Address(admin).toScVal(),
    new Address(to).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
  );
}

/// Build a transaction to transfer beans.
export function buildTransferBeansTx(
  from: string,
  to: string,
  amount: number,
): xdr.Operation {
  return contract().call(
    "transfer",
    new Address(from).toScVal(),
    new Address(to).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
  );
}

/// Build a transaction to burn beans (redemption at store).
export function buildBurnBeansTx(
  from: string,
  amount: number,
): xdr.Operation {
  return contract().call(
    "burn",
    new Address(from).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
  );
}

/// Query the beans balance for a user.
export async function getBeansBalance(owner: string): Promise<number> {
  return simulateNumber(
    contract().call("balance", new Address(owner).toScVal()),
  );
}

/// Query the total supply of beans.
export async function getBeansTotalSupply(): Promise<number> {
  return simulateNumber(contract().call("total_supply"));
}

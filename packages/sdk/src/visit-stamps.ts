// SDK for interacting with the dicekey-visit-stamps contract.

import {
  Contract,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { getConfig } from "./config.js";
import { simulateNumber } from "./client.js";

export interface VisitStamp {
  id: number;
  owner: string;
  venue: string;
  timestamp: number;
}

function contractId(): string {
  return getConfig().contracts.visitStamps;
}

function contract(): Contract {
  return new Contract(contractId());
}

/// Build the `issue` operation. Legacy: the write path now uses generated
/// bindings + kit.signAndSubmit (see docs §11.2); kept for read/debug parity.
export function buildIssueStampTx(
  admin: string,
  to: string,
  venue: string,
): xdr.Operation {
  return contract().call(
    "issue",
    new Address(admin).toScVal(),
    new Address(to).toScVal(),
    nativeToScVal(venue, { type: "string" }),
  );
}

/// Query the stamp count for a user.
export async function getStampCount(owner: string): Promise<number> {
  return simulateNumber(
    contract().call("stamp_count", new Address(owner).toScVal()),
  );
}

/// Query the venue-specific stamp count for a user.
export async function getVenueCount(
  owner: string,
  venue: string,
): Promise<number> {
  return simulateNumber(
    contract().call(
      "venue_count",
      new Address(owner).toScVal(),
      nativeToScVal(venue, { type: "string" }),
    ),
  );
}

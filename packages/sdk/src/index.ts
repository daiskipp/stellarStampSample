export { getConfig, setConfig, TESTNET_CONFIG } from "./config.js";
export type { NetworkConfig, SmartAccountEnv } from "./config.js";
export { getServer, resetServer } from "./client.js";
export {
  buildIssueStampTx,
  getStampCount,
  getVenueCount,
} from "./visit-stamps.js";
export type { VisitStamp } from "./visit-stamps.js";
export {
  buildMintBeansTx,
  buildTransferBeansTx,
  buildBurnBeansTx,
  getBeansBalance,
  getBeansTotalSupply,
} from "./beans-token.js";

// Smart Account client layer (smart-account-kit wrapper).
export {
  createKit,
  getKit,
  resetKit,
  signAndSubmitTx,
  SmartAccountKit,
  IndexedDBStorage,
  MemoryStorage,
  LocalStorageAdapter,
  createDefaultContext,
  createCallContractContext,
  createWebAuthnSigner,
  createDelegatedSigner,
  createThresholdParams,
  createSpendingLimitParams,
  WalletNotConnectedError,
  SimulationError,
  SubmissionError,
  WebAuthnError,
} from "./smart-account.js";
export type {
  CreateKitOptions,
  SignSubmitOptions,
  StorageAdapter,
  AssembledTransaction,
  TransactionResult,
  CreateWalletResult,
  ConnectWalletResult,
  ContextRule,
  ContextRuleType,
  ContractSigner,
} from "./smart-account.js";

// QR payload helpers for the staff-side stamp-issue scanner.
export {
  createStampRequestQR,
  parseStampRequestQR,
  verifyStampRequestQR,
  QR_SCHEMA_VERSION,
  QR_DEFAULT_TTL_SEC,
} from "./qr.js";
export type {
  StampRequestQRv1,
  CreateStampRequestQROptions,
  CreateStampRequestQRResult,
  ParseResult,
  VerifyOptions,
  VerifyResult,
} from "./qr.js";

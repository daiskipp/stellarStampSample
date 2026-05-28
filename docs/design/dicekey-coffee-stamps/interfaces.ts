// ============================================================
// dicekey Coffee Stamps - TypeScript Interface Definitions
// Reverse-engineered from codebase on 2026-05-19
// ============================================================

// ============================================================
// Shared Types (contracts/shared)
// ============================================================

/** NFT/SBT metadata structure (shared across all token contracts) */
export interface TokenMeta {
  name: string;
  description: string;
  image_uri: string;
  extra_uri: string;
}

/** Store location identifier */
export type VenueId = string; // e.g., "shibuya", "shinjuku", "kyoto"

/** Global error codes */
export enum DicekeyError {
  NotAuthorized = 1,
  AlreadyClaimed = 2,
  Expired = 3,
  NotFound = 4,
  InvalidInput = 5,
  PolicyNotMet = 6,
}

// ============================================================
// Visit Stamps (contracts/dicekey-visit-stamps)
// ============================================================

/** A single visit stamp (SEP-50 Soulbound NFT) */
export interface VisitStamp {
  id: number; // u64, auto-increment
  owner: string; // Stellar Address
  venue: VenueId;
  timestamp: number; // u64, ledger timestamp
  meta: TokenMeta;
}

// ============================================================
// Beans Token (contracts/dicekey-beans-token)
// ============================================================

// SEP-41 Fungible Token — no custom type needed.
// name: "dicekey Beans", symbol: "BEANS", decimals: 0.
// Balance and amounts are i128 (represented as number in TS SDK).

/** Beans per visit constant */
export const BEANS_PER_VISIT = 10;

// ============================================================
// Benefits (contracts/dicekey-benefits)
// ============================================================

/** A benefit NFT (SEP-50, transferable, with optional expiry) */
export interface BenefitNft {
  id: number; // u64, auto-increment
  owner: string; // Stellar Address (changes on transfer)
  kind: string; // e.g., "free_drink_voucher"
  expires_at: number; // u64, 0 = no expiry
  meta: TokenMeta;
}

// ============================================================
// Badges (contracts/dicekey-badges)
// ============================================================

/** An achievement badge (SEP-50 Soulbound NFT, non-transferable) */
export interface Badge {
  id: number; // u64, auto-increment
  owner: string; // Stellar Address
  kind: string; // e.g., "coffee_master", "morning_master", "spring_2026"
  awarded_at: number; // u64, ledger timestamp
  meta: TokenMeta;
}

/** Known badge kinds */
export type BadgeKind = "coffee_master" | "morning_master" | "spring_2026";

// ============================================================
// Reward Policy (contracts/dicekey-reward-policy)
// ============================================================

/** Policy identifiers */
export type PolicyId =
  | "10visit_bonus"
  | "100visit_master"
  | "morning_lover"
  | "spring_campaign";

/** Policy definition */
export interface PolicyDefinition {
  id: PolicyId;
  threshold: number;
  rewardType: "benefit" | "badge";
  rewardKind: string;
  trigger: "automatic" | "manual";
}

/** Hardcoded policy table */
export const POLICIES: PolicyDefinition[] = [
  {
    id: "10visit_bonus",
    threshold: 10,
    rewardType: "benefit",
    rewardKind: "free_drink_voucher",
    trigger: "automatic",
  },
  {
    id: "100visit_master",
    threshold: 100,
    rewardType: "badge",
    rewardKind: "coffee_master",
    trigger: "automatic",
  },
  {
    id: "morning_lover",
    threshold: 20,
    rewardType: "badge",
    rewardKind: "morning_master",
    trigger: "manual",
  },
  {
    id: "spring_campaign",
    threshold: 5,
    rewardType: "badge",
    rewardKind: "spring_2026",
    trigger: "manual",
  },
];

// ============================================================
// SDK Configuration (packages/sdk)
// ============================================================

/** Network configuration for Soroban RPC connection */
export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    visitStamps: string; // VITE_VISIT_STAMPS_CONTRACT
    beansToken: string; // VITE_BEANS_TOKEN_CONTRACT
    benefits: string; // VITE_BENEFITS_CONTRACT
    badges: string; // VITE_BADGES_CONTRACT
    rewardPolicy: string; // VITE_REWARD_POLICY_CONTRACT
  };
}

// ============================================================
// Authentication (apps/customer-app)
// ============================================================

/** Customer authentication state */
export interface AuthState {
  isLoggedIn: boolean;
  publicKey: string | null; // Stellar public key
  displayName: string | null;
}

/** Passkey registration result */
export interface PasskeyCredential {
  credentialId: string;
  publicKey: ArrayBuffer;
}

/** Staff authentication state */
export interface StaffAuthState {
  isLoggedIn: boolean;
  venue: VenueId | null;
  venueName: string | null;
}

// ============================================================
// QR Code Payloads (apps/staff-app → customer-app)
// ============================================================

/** Base QR payload fields */
interface QrPayloadBase {
  timestamp: number;
  nonce: string;
  valid_until: number;
}

/** Stamp issuance QR (60s validity) */
export interface IssueStampQrPayload extends QrPayloadBase {
  action: "issue_stamp";
  venue: VenueId;
}

/** Beans usage QR (120s validity) */
export interface UseBeansQrPayload extends QrPayloadBase {
  action: "use_beans";
  item: string;
  beans: number;
}

/** Benefit redemption QR (120s validity) */
export interface BurnBenefitQrPayload extends QrPayloadBase {
  action: "burn_benefit";
}

/** Union of all QR payload types */
export type QrPayload =
  | IssueStampQrPayload
  | UseBeansQrPayload
  | BurnBenefitQrPayload;

// ============================================================
// UI State (apps/*)
// ============================================================

/** Issue stamp page state machine */
export type IssueStampState = "idle" | "showing" | "done";

/** Menu items for beans usage */
export interface MenuItem {
  name: string;
  beans: number;
}

/** Predefined menu items */
export const MENU_ITEMS: MenuItem[] = [
  { name: "ドリップコーヒー (S)", beans: 30 },
  { name: "ドリップコーヒー (M)", beans: 35 },
  { name: "カフェラテ (S)", beans: 40 },
  { name: "カフェラテ (M)", beans: 45 },
  { name: "カプチーノ", beans: 45 },
  { name: "カフェモカ", beans: 55 },
];

/** Venue options for staff login */
export const VENUES: Array<{ id: VenueId; name: string }> = [
  { id: "shibuya", name: "dicekey Shibuya" },
  { id: "shinjuku", name: "dicekey Shinjuku" },
  { id: "kyoto", name: "dicekey Kyoto" },
];

// ============================================================
// Design Tokens (packages/ui-components)
// ============================================================

/** CSS custom property values extracted from tokens.css */
export const DESIGN_TOKENS = {
  colors: {
    bg: "#f5ede0",
    bg2: "#ebe0cc",
    bg3: "#e1d3b8",
    bgElev: "#fbf6ec",
    ink: "#2b1a0e",
    ink2: "#5c4530",
    ink3: "#8a7a66",
    ink4: "#c5b699",
    accent: "#a8632d",
    accent2: "#c2774a",
    accentSoft: "#e8c597",
    accentPale: "#f4dfba",
    onAccent: "#fbf6ec",
    warn: "#c44a3a",
    good: "#4d6b3a",
  },
  fonts: {
    display: "'DM Serif Display', 'Noto Sans JP', serif",
    body: "'Noto Sans JP', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'DM Mono', ui-monospace, monospace",
  },
} as const;

// ============================================================
// Soroban Events
// ============================================================

/** Event topic types emitted by contracts */
export type ContractEvent =
  | { contract: "stamps"; topic: ["stamp", "issued"]; data: { to: string; id: number; timestamp: number } }
  | { contract: "beans"; topic: ["beans", "mint"]; data: { to: string; amount: number } }
  | { contract: "beans"; topic: ["beans", "xfer"]; data: { from: string; to: string; amount: number } }
  | { contract: "beans"; topic: ["beans", "burn"]; data: { from: string; amount: number } }
  | { contract: "beans"; topic: ["beans", "approve"]; data: { from: string; spender: string; amount: number } }
  | { contract: "benefits"; topic: ["benefit", "mint"]; data: { to: string; id: number } }
  | { contract: "benefits"; topic: ["benefit", "xfer"]; data: { from: string; to: string; token_id: number } }
  | { contract: "benefits"; topic: ["benefit", "burn"]; data: { owner: string; token_id: number } }
  | { contract: "badges"; topic: ["badge", "issued"]; data: { to: string; kind: string; id: number } }
  | { contract: "policy"; topic: ["policy", "reward"]; data: { user: string; policy_id: string } };

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  enrollStaffDevice,
  staffSignIn,
  staffSignOut,
  hqSmartAccount,
  staffRuleIds as envStaffRuleIds,
  staffBenefitsRuleId as envStaffBenefitsRuleId,
  loadStoredStaffCredential,
} from "../lib/passkey";
import { VENUE_NAMES } from "../lib/chain";

// staff-app is the MULTI-SIG side: a staff member does NOT own a Smart
// Account. They authenticate with a passkey that is a signer on the dicekey HQ
// Smart Account's staff context rules; every action is a real transaction
// submitted against the HQ SA (admin of the 5 contracts).
interface StaffAuth {
  isLoggedIn: boolean;
  /** Logged-in venue id (which store this terminal is operating at). */
  venue: string | null;
  venueName: string | null;
  /** The dicekey HQ Smart Account C-address (admin / tx subject). */
  hqContractId: string | null;
  /** This device's staff passkey credential id (signer on the staff rules). */
  staffCredentialId: string | null;
  /** The 3 staff context-rule ids for issue() (U2 case C order). */
  staffRuleIds: number[];
  /** benefits CallContract staff-rule id for Receive Benefit (0 if unset). */
  staffBenefitsRuleId: number;
}

interface StaffAuthContextType extends StaffAuth {
  /**
   * Device setup (端末セットアップ, HQ admin in attendance): register THIS
   * tablet as a staff terminal. Requires the HQ root passkey (HQ admin
   * credential) on this authenticator to authorise adding the new staff signer
   * to the HQ SA — its credential id comes from VITE_HQ_ROOT_CREDENTIAL_ID.
   * Persists HQ contract id + HQ root cred id so daily sign-in is
   * self-contained. Returns the new staff credential id.
   */
  enrollDevice: (staffName: string) => Promise<string>;
  /**
   * Daily sign-in: pick a venue + connect the kit to the HQ SA with the HQ
   * ROOT credential recorded at device setup (NOT the staff cred — that owns
   * no SA). The staff cred is used only at issue() time.
   */
  signIn: (venue: string) => Promise<void>;
  /** Disconnect the HQ SA session (keeps the enrolled device credential). */
  signOut: () => Promise<void>;
  /** Whether this device has an enrolled staff credential. */
  hasEnrolledDevice: boolean;
  enrolledStaffName: string | null;
  /** True while a persisted shift is being re-established after a page load. */
  restoring: boolean;
}

const StaffAuthContext = createContext<StaffAuthContextType | null>(null);

const VENUE_KEY = "dicekey_staff_venue";

const LOGGED_OUT: StaffAuth = {
  isLoggedIn: false,
  venue: null,
  venueName: null,
  hqContractId: null,
  staffCredentialId: null,
  staffRuleIds: [],
  staffBenefitsRuleId: 0,
};

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StaffAuth>(LOGGED_OUT);
  const stored = loadStoredStaffCredential();
  const [enrolledStaffName, setEnrolledStaffName] = useState<string | null>(
    stored.staffName,
  );
  const [hasEnrolledDevice, setHasEnrolledDevice] = useState<boolean>(
    !!stored.credentialId,
  );

  const enrollDevice = useCallback(async (staffName: string) => {
    const { credentialId } = await enrollStaffDevice(staffName);
    setEnrolledStaffName(staffName);
    setHasEnrolledDevice(true);
    return credentialId;
  }, []);

  // Establish the HQ session: connect the kit to the HQ SA with the HQ ROOT
  // credential recorded at device setup (the staff cred owns no SA — passing
  // it to connectWallet throws "Smart account contract not found"), then
  // hydrate the in-memory auth state. Shared by interactive sign-in and the
  // on-reload session restore so both take the proven shape.
  const establishSession = useCallback(async (venue: string) => {
    const s = loadStoredStaffCredential();
    if (!s.credentialId) {
      throw new Error(
        "この端末はスタッフ登録されていません。先に端末セットアップを行ってください。",
      );
    }
    // Fall back to the configured HQ SA address if an older device-setup
    // record predates HQ persistence.
    const hqContractId = s.hqContractId ?? hqSmartAccount();
    const hqRootCredentialId = s.hqRootCredentialId;
    if (!hqRootCredentialId) {
      throw new Error(
        "本部ルート credential が未保存です。端末セットアップをやり直してください。",
      );
    }
    const res = await staffSignIn(hqContractId, hqRootCredentialId);
    // Prefer the per-device rule ids recorded at device setup; fall back to the
    // pinned VITE_HQ_STAFF_RULE_IDS (sa-setup.mjs bootstrap rules).
    const ruleIds =
      s.ruleIds && s.ruleIds.length === 3 ? s.ruleIds : envStaffRuleIds();
    // Prefer the per-device benefits rule id recorded at enrollment; fall back
    // to the pinned VITE_HQ_STAFF_BENEFITS_RULE_ID (sa-setup.mjs bootstrap).
    const benefitsRuleId =
      s.benefitsRuleId && s.benefitsRuleId > 0
        ? s.benefitsRuleId
        : envStaffBenefitsRuleId();
    localStorage.setItem(VENUE_KEY, venue);
    setAuth({
      isLoggedIn: true,
      venue,
      venueName: VENUE_NAMES[venue] ?? venue,
      hqContractId: res.contractId ?? hqContractId,
      // The staff signer credential — used ONLY at issue() time
      // (signAndSubmit while connected as HQ root), never for connectWallet.
      staffCredentialId: s.credentialId,
      staffRuleIds: ruleIds,
      staffBenefitsRuleId: benefitsRuleId,
    });
  }, []);

  const signIn = useCallback(
    async (venue: string) => {
      await establishSession(venue);
    },
    [establishSession],
  );

  const signOut = useCallback(async () => {
    localStorage.removeItem(VENUE_KEY);
    await staffSignOut();
    setAuth(LOGGED_OUT);
  }, []);

  // On (re)load the kit singleton is fresh and NOT connected, and the React
  // auth state is in-memory only, so a tablet page reload / SPA hard-nav would
  // otherwise drop a logged-in shift. If a venue was persisted at sign-in and
  // the device is enrolled, transparently re-establish the HQ session (no
  // WebAuthn prompt — the HQ root credential is not in storage, so the kit
  // verifies the HQ contract on-chain and reconnects). `restoring` gates the
  // login screen so it doesn't flash before the restore resolves.
  const [restoring, setRestoring] = useState<boolean>(() => {
    const v = localStorage.getItem(VENUE_KEY);
    return !!v && !!stored.credentialId;
  });
  const restoreStarted = useRef(false);
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    const venue = localStorage.getItem(VENUE_KEY);
    if (!venue || !stored.credentialId) {
      setRestoring(false);
      return;
    }
    establishSession(venue)
      .catch(() => {
        // Stale/invalid session — fall back to the login screen.
        localStorage.removeItem(VENUE_KEY);
      })
      .finally(() => setRestoring(false));
  }, [establishSession, stored.credentialId]);

  return (
    <StaffAuthContext.Provider
      value={{
        ...auth,
        enrollDevice,
        signIn,
        signOut,
        hasEnrolledDevice,
        enrolledStaffName,
        restoring,
      }}
    >
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth(): StaffAuthContextType {
  const ctx = useContext(StaffAuthContext);
  if (!ctx)
    throw new Error("useStaffAuth must be used within StaffAuthProvider");
  return ctx;
}

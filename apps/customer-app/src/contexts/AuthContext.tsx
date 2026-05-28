import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  registerPasskeyWallet,
  connectExisting,
  disconnectWallet,
} from "../lib/passkey";

// The customer's own Smart Account. `contractId` is the SA C-address (the
// identity that owns stamps/beans/benefits/badges on chain). There is no
// G-account / raw keypair anymore — auth is the passkey __check_auth.
interface AuthState {
  isLoggedIn: boolean;
  contractId: string | null;
  credentialId: string | null;
  displayName: string | null;
}

interface AuthContextType extends AuthState {
  /** Register a new passkey + deploy the customer's Smart Account. */
  login: (name: string) => Promise<void>;
  /** Connect to an existing Smart Account via passkey. */
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  /** True until the silent session-restore on startup has finished. */
  restoring: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Only the display name is local UI sugar; the kit owns the credential
// (IndexedDB). We keep the last name so a restored session greets by name.
const NAME_KEY = "dicekey_display_name";

const LOGGED_OUT: AuthState = {
  isLoggedIn: false,
  contractId: null,
  credentialId: null,
  displayName: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(LOGGED_OUT);
  const [restoring, setRestoring] = useState(true);

  // Startup: silently restore a stored Smart Account session (IndexedDB).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await connectExisting();
        if (!cancelled && res) {
          setAuth({
            isLoggedIn: true,
            contractId: res.contractId,
            credentialId: res.credentialId,
            displayName: localStorage.getItem(NAME_KEY) || "ゲスト",
          });
        }
      } catch {
        // No restorable session — stay logged out.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (name: string) => {
    const res = await registerPasskeyWallet(name);
    localStorage.setItem(NAME_KEY, name);
    setAuth({
      isLoggedIn: true,
      contractId: res.contractId,
      credentialId: res.credentialId,
      displayName: name,
    });
  }, []);

  const connect = useCallback(async () => {
    const res = await connectExisting({ prompt: true });
    if (!res) {
      throw new Error(
        "接続できるパスキーが見つかりませんでした。新規作成してください。",
      );
    }
    setAuth({
      isLoggedIn: true,
      contractId: res.contractId,
      credentialId: res.credentialId,
      displayName: localStorage.getItem(NAME_KEY) || "ゲスト",
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await disconnectWallet();
    } catch {
      // ignore — clear local state regardless
    }
    localStorage.removeItem(NAME_KEY);
    setAuth(LOGGED_OUT);
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...auth, login, connect, logout, restoring }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

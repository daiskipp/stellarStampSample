import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { StampsPage } from "./pages/StampsPage";
import { RewardsPage } from "./pages/RewardsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { QRPage } from "./pages/QRPage";
import { IconHome, IconStamp, IconGift, IconSettings } from "@dicekey/ui-components";
import "@dicekey/ui-components/src/tokens.css";

const TABS = [
  { path: "/", label: "ホーム", Icon: IconHome },
  { path: "/stamps", label: "スタンプ", Icon: IconStamp },
  { path: "/rewards", label: "リワード", Icon: IconGift },
  { path: "/settings", label: "設定", Icon: IconSettings },
] as const;

function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "var(--bg-elev)",
      borderTop: "1px solid var(--line)",
      padding: "10px 8px 22px",
      display: "flex", justifyContent: "space-around", alignItems: "center",
      zIndex: 50,
    }}>
      {TABS.map(({ path, label, Icon }) => {
        const active = pathname === path;
        return (
          <Link key={path} to={path} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            color: active ? "var(--ink)" : "var(--ink-3)",
            fontSize: 10, fontWeight: 600, letterSpacing: "0.03em",
            flex: 1, padding: "2px 0", textDecoration: "none",
          }}>
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AppRoutes() {
  const { isLoggedIn, restoring } = useAuth();

  if (restoring) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--ink-3)",
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          letterSpacing: "0.06em",
        }}
      >
        セッションを確認中…
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh" }}>
      <div style={{ padding: "0 22px 90px" }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/stamps" element={<StampsPage />} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/qr" element={<QRPage />} />
        </Routes>
      </div>
      <TabBar />
    </div>
  );
}

// Strip trailing slash so the basename is "" (root) when Vite's BASE_URL is
// "/", or "/staff" / "/customer" etc. when the app is built into a sub-path
// of a shared CF Pages host (see scripts/build-pages.sh).
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "");

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter basename={BASENAME}>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

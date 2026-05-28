import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { StaffAuthProvider, useStaffAuth } from "./contexts/StaffAuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StaffLoginPage } from "./pages/StaffLoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { IssueStampPage } from "./pages/IssueStampPage";
import { ReceiveBenefitPage } from "./pages/ReceiveBenefitPage";
import { UseBeansPage } from "./pages/UseBeansPage";
import { CupGlyph } from "@dicekey/ui-components";
import "@dicekey/ui-components/src/tokens.css";

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dow = DAY_NAMES[d.getDay()];
  return `${y}.${m}.${day} \u00b7 ${dow}`;
}

function NavLink({ to, label }: { to: string; label: string }) {
  const { pathname } = useLocation();
  const active = pathname === to;
  return (
    <Link
      to={to}
      style={{
        textDecoration: "none",
        fontFamily: "var(--f-body)",
        fontSize: 14,
        fontWeight: active ? 700 : 400,
        color: active ? "var(--ink)" : "var(--ink-3)",
        padding: "0 6px",
      }}
    >
      {label}
    </Link>
  );
}

function AppRoutes() {
  const { isLoggedIn, restoring, venueName, enrolledStaffName, signOut } =
    useStaffAuth();
  const { pathname } = useLocation();

  // While a persisted shift is being re-established after a page (re)load,
  // hold the route render so the login screen doesn't flash before the HQ
  // session reconnects.
  if (!isLoggedIn && restoring) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--ink-3)",
          gap: 16,
        }}
      >
        <CupGlyph size={40} color="var(--accent)" />
        <p style={{ fontSize: 14 }}>セッションを復元しています...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <StaffLoginPage />;
  }

  const showBottomNav = pathname !== "/";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        color: "var(--ink)",
      }}
    >
      {/* ── Top header bar ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 32px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-elev)",
        }}
      >
        {/* Left: wordmark + venue */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CupGlyph size={26} color="var(--accent)" />
            <span
              style={{
                fontFamily: "var(--f-display)",
                fontStyle: "italic",
                fontSize: 22,
                color: "var(--ink)",
                letterSpacing: -0.5,
              }}
            >
              dicekey
            </span>
            <span
              style={{
                fontFamily: "var(--f-body)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1.5,
                color: "var(--ink-3)",
                marginLeft: 2,
              }}
            >
              Coffee
            </span>
          </div>

          <div
            style={{
              width: 1,
              height: 24,
              background: "var(--line-2)",
              margin: "0 4px",
            }}
          />

          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--f-body)",
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              {venueName}
            </span>
            <span
              style={{
                fontFamily: "var(--f-body)",
                fontSize: 13,
                color: "var(--ink-3)",
              }}
            >
              ダッシュボード
            </span>
          </div>
        </div>

        {/* Right: date + user chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 13,
              color: "var(--ink-3)",
              letterSpacing: 0.3,
            }}
          >
            {formatDate(new Date())}
          </span>

          <button
            onClick={() => {
              void signOut();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--f-body)",
              fontSize: 13,
              color: "var(--ink-2)",
              background: "var(--bg-2)",
              border: "1px solid var(--line)",
              borderRadius: 20,
              padding: "6px 14px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {enrolledStaffName ?? "スタッフ"} &middot; サインアウト
          </button>
        </div>
      </header>

      {/* ── Content area ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/issue-stamp" element={<IssueStampPage />} />
          <Route path="/receive-benefit" element={<ReceiveBenefitPage />} />
          <Route path="/use-beans" element={<UseBeansPage />} />
        </Routes>
      </div>

      {/* ── Bottom nav (non-dashboard pages) ── */}
      {showBottomNav && (
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "14px 32px",
            borderTop: "1px solid var(--line)",
            background: "var(--bg-elev)",
          }}
        >
          <NavLink to="/" label="ダッシュボード" />
          <NavLink to="/issue-stamp" label="スタンプ発行" />
          <NavLink to="/receive-benefit" label="特典券受取" />
          <NavLink to="/use-beans" label="beans 利用" />
        </nav>
      )}
    </div>
  );
}

// Strip trailing slash so the basename is "" (root) when Vite's BASE_URL is
// "/", or "/staff" when the app is built into the /staff sub-path of a shared
// CF Pages host (see scripts/build-pages.sh).
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "");

export function App() {
  return (
    <ErrorBoundary>
      <StaffAuthProvider>
        <BrowserRouter basename={BASENAME}>
          <AppRoutes />
        </BrowserRouter>
      </StaffAuthProvider>
    </ErrorBoundary>
  );
}

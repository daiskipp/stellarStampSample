import { useState } from "react";
import { useStaffAuth } from "../contexts/StaffAuthContext";
import { VENUES } from "../lib/chain";
import { hqRootCredentialIdFromEnv } from "../lib/passkey";
import { CupGlyph } from "@dicekey/ui-components";

type Mode = "signin" | "enroll";

export function StaffLoginPage() {
  const { signIn, enrollDevice, hasEnrolledDevice, enrolledStaffName } =
    useStaffAuth();
  const [mode, setMode] = useState<Mode>(
    hasEnrolledDevice ? "signin" : "enroll",
  );
  const [selectedVenue, setSelectedVenue] = useState("");
  const [staffName, setStaffName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollOk, setEnrollOk] = useState<string | null>(null);
  // VITE_HQ_ROOT_CREDENTIAL_ID is written by scripts/sa-setup.mjs. Without it
  // enrollStaffDevice would throw at signAndSubmit time anyway; we surface the
  // missing-env state up front and disable the enroll button.
  const hqRootCred = hqRootCredentialIdFromEnv();
  const hqRootCredMissing = !hqRootCred;

  const handleSignIn = async () => {
    if (!selectedVenue || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(selectedVenue);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleEnroll = async () => {
    if (!staffName.trim() || busy || hqRootCredMissing) return;
    setBusy(true);
    setError(null);
    setEnrollOk(null);
    try {
      const cred = await enrollDevice(staffName.trim());
      setEnrollOk(cred);
      setMode("signin");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 16px",
    fontSize: 14,
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--bg)",
    color: "var(--ink)",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
    marginBottom: 16,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: "40px 24px",
      }}
    >
      {/* Logo */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <CupGlyph size={48} color="var(--ink)" />
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--f-display)",
              fontStyle: "italic",
              fontSize: 32,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            dicekey
          </span>
          <span
            style={{
              fontFamily: "var(--f-body)",
              fontWeight: 600,
              fontSize: 14,
              color: "var(--ink-2)",
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
            }}
          >
            Coffee
          </span>
        </div>
        <p
          style={{
            marginTop: 8,
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          スタッフポータル · 本部 Smart Account
        </p>
      </div>

      {/* Card */}
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--bg-elev)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          padding: "28px 24px",
          boxShadow: "var(--shadow-2)",
        }}
      >
        {/* Tab switch */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {(["signin", "enroll"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              style={{
                flex: 1,
                padding: "8px 0",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "inherit",
                borderRadius: 8,
                cursor: "pointer",
                border: "1px solid var(--line)",
                background: mode === m ? "var(--ink)" : "transparent",
                color: mode === m ? "var(--bg-elev)" : "var(--ink-2)",
              }}
            >
              {m === "signin" ? "サインイン" : "この端末を登録"}
            </button>
          ))}
        </div>

        {mode === "signin" && (
          <>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase" as const,
                color: "var(--ink-3)",
                fontWeight: 500,
                marginBottom: 16,
              }}
            >
              店舗を選択
            </div>

            <select
              value={selectedVenue}
              onChange={(e) => setSelectedVenue(e.target.value)}
              style={{
                ...inputStyle,
                appearance: "none" as const,
                WebkitAppearance: "none" as const,
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23999' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px center",
                paddingRight: 36,
              }}
            >
              <option value="">店舗を選んでください...</option>
              {VENUES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>

            {!hasEnrolledDevice && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--warn, var(--ink-3))",
                  lineHeight: 1.5,
                  marginBottom: 16,
                }}
              >
                この端末はまだスタッフ登録されていません。「この端末を登録」から本部管理者が登録してください。
              </p>
            )}

            {enrollOk && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--good, var(--ink-2))",
                  lineHeight: 1.5,
                  marginBottom: 16,
                  wordBreak: "break-all",
                }}
              >
                端末登録完了。スタッフ: {enrolledStaffName}。サインインしてください。
              </p>
            )}

            <button
              onClick={handleSignIn}
              disabled={!selectedVenue || busy || !hasEnrolledDevice}
              style={{
                width: "100%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "14px 18px",
                borderRadius: 100,
                background: "var(--ink)",
                color: "var(--bg-elev)",
                border: "1px solid var(--ink)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "0.02em",
                opacity:
                  selectedVenue && !busy && hasEnrolledDevice ? 1 : 0.5,
              }}
            >
              {busy ? "接続中..." : "スタッフ passkey でサインイン"}
            </button>
          </>
        )}

        {mode === "enroll" && (
          <>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase" as const,
                color: "var(--ink-3)",
                fontWeight: 500,
                marginBottom: 16,
              }}
            >
              端末登録（要 本部管理者 passkey）
            </div>

            <p
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                lineHeight: 1.55,
                marginBottom: 16,
              }}
            >
              本部管理者が、この端末用の新しいスタッフ passkey を本部 Smart
              Account の 3 つのスタッフルールに追加します。本部ルート
              passkey の credential id は VITE_HQ_ROOT_CREDENTIAL_ID
              （scripts/sa-setup.mjs で書き込まれます）から読み込みます。
            </p>

            {hqRootCredMissing && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--bad, #c0392b)",
                  lineHeight: 1.55,
                  marginBottom: 16,
                }}
              >
                VITE_HQ_ROOT_CREDENTIAL_ID が未設定です。
                scripts/sa-setup.mjs を実行して .env を更新してください。
              </p>
            )}

            <input
              type="text"
              placeholder="スタッフ名（例: 渋谷店 田中）"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              style={inputStyle}
            />

            <button
              onClick={handleEnroll}
              disabled={!staffName.trim() || busy || hqRootCredMissing}
              style={{
                width: "100%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "14px 18px",
                borderRadius: 100,
                background: "var(--accent)",
                color: "var(--on-accent)",
                border: "none",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "0.02em",
                opacity:
                  staffName.trim() && !busy && !hqRootCredMissing ? 1 : 0.5,
              }}
            >
              {busy ? "登録中..." : "この端末をスタッフ登録"}
            </button>
          </>
        )}

        {error && (
          <p
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "var(--bad, #c0392b)",
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}
          >
            {error}
          </p>
        )}
      </div>

      <p
        style={{
          marginTop: 40,
          fontSize: 11,
          fontFamily: "var(--f-mono)",
          color: "var(--ink-4)",
          letterSpacing: "0.06em",
        }}
      >
        STELLAR / SOROBAN
      </p>
    </div>
  );
}

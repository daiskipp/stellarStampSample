import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { CupGlyph, Bean } from "@dicekey/ui-components";

export function LoginPage() {
  const { login, connect } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "create" | "connect">(null);
  const [error, setError] = useState<string | null>(null);

  const loading = busy !== null;

  const handleCreate = async () => {
    if (!name.trim() || loading) return;
    setBusy("create");
    setError(null);
    try {
      await login(name.trim());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Smart Account の作成に失敗しました",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = async () => {
    if (loading) return;
    setBusy("connect");
    setError(null);
    try {
      await connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "サインインに失敗しました");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg)", padding: "40px 24px",
      position: "relative", overflow: "hidden",
    }}>
      {/* Watermark beans */}
      <div style={{ position: "absolute", top: -40, right: -30, opacity: 0.04, transform: "rotate(20deg)" }}>
        <Bean size={200} color="var(--ink)" />
      </div>
      <div style={{ position: "absolute", bottom: -20, left: -20, opacity: 0.03, transform: "rotate(-30deg)" }}>
        <CupGlyph size={180} color="var(--ink)" />
      </div>

      {/* Logo */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <CupGlyph size={48} color="var(--ink)" />
        <div style={{
          marginTop: 16, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8,
        }}>
          <span style={{
            fontFamily: "var(--f-display)", fontStyle: "italic",
            fontSize: 32, color: "var(--ink)", letterSpacing: "-0.01em",
          }}>dicekey</span>
          <span style={{
            fontFamily: "var(--f-body)", fontWeight: 600,
            fontSize: 14, color: "var(--ink-2)", letterSpacing: "0.06em",
            textTransform: "uppercase" as const,
          }}>Coffee</span>
        </div>
        <p style={{
          marginTop: 8, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5,
        }}>
          コーヒーと共に、あなたの記録を。
        </p>
      </div>

      {/* Login card */}
      <div style={{
        width: "100%", maxWidth: 360,
        background: "var(--bg-elev)", border: "1px solid var(--line)",
        borderRadius: 18, padding: "28px 24px",
        boxShadow: "var(--shadow-2)",
        position: "relative", zIndex: 1,
      }}>
        <div style={{
          fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase" as const, color: "var(--ink-3)", fontWeight: 500,
          marginBottom: 16,
        }}>サインイン</div>

        <input
          type="text"
          placeholder="お名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          disabled={loading}
          style={{
            width: "100%", padding: "12px 16px", fontSize: 14,
            border: "1px solid var(--line)", borderRadius: 8,
            background: "var(--bg)", color: "var(--ink)",
            fontFamily: "inherit", boxSizing: "border-box",
            outline: "none",
          }}
        />

        <button
          onClick={handleCreate}
          disabled={loading || !name.trim()}
          style={{
            width: "100%", marginTop: 14,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "14px 18px", borderRadius: 100,
            background: "var(--ink)", color: "var(--bg-elev)",
            border: "1px solid var(--ink)",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit", letterSpacing: "0.02em",
            opacity: loading || !name.trim() ? 0.5 : 1,
          }}
        >
          {busy === "create" ? "作成中..." : "パスキーで新規作成"}
        </button>

        <div style={{ height: 1, background: "var(--line)", margin: "18px 0" }} />

        <button
          onClick={handleConnect}
          disabled={loading}
          style={{
            width: "100%",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "12px 18px", borderRadius: 100,
            background: "transparent", border: "1px solid var(--line-2)",
            color: "var(--ink-2)", fontSize: 13, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.02em",
            opacity: loading ? 0.5 : 1,
          }}
        >
          {busy === "connect"
            ? "サインイン中..."
            : "パスキーでサインイン（既存に接続）"}
        </button>

        {error && (
          <div style={{
            marginTop: 14, padding: "10px 14px",
            background: "var(--warn)", color: "var(--on-accent)",
            borderRadius: 10, fontSize: 13, fontWeight: 500,
            opacity: 0.9,
          }}>
            {error}
          </div>
        )}
      </div>

      <p style={{
        marginTop: 40, fontSize: 11,
        fontFamily: "var(--f-mono)", color: "var(--ink-4)",
        letterSpacing: "0.06em",
      }}>
        STELLAR / SOROBAN
      </p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useStaffAuth } from "../contexts/StaffAuthContext";
import {
  getBeansTotalSupply,
  getCustomerSnapshot,
  VENUES,
} from "../lib/chain";
import {
  Bean,
  IconStamp,
  IconGift,
  IconCalendar,
  IconSpark,
} from "@dicekey/ui-components";

const DEMO_CUSTOMER_SA = (
  import.meta.env as unknown as Record<string, string | undefined>
).VITE_DEMO_CUSTOMER_SA;

const serifNum: React.CSSProperties = {
  fontFamily: "var(--f-display)",
  fontStyle: "italic",
};

const eyebrow: React.CSSProperties = {
  fontFamily: "var(--f-body)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 1.2,
  color: "var(--ink-3)",
  marginBottom: 8,
};

const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--f-body)",
  fontSize: 16,
  fontWeight: 700,
  color: "var(--ink)",
};

const divider: React.CSSProperties = {
  height: 1,
  background: "var(--line)",
  margin: "18px 0",
};

function BigTile({
  to,
  icon,
  title,
  desc,
  accent,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  accent?: boolean;
}) {
  return (
    <Link
      to={to}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "20px 18px",
        minHeight: 130,
        borderRadius: 16,
        background: accent ? "var(--accent-pale)" : "var(--bg-elev)",
        border: `1px solid ${accent ? "var(--accent-soft)" : "var(--line)"}`,
        textDecoration: "none",
        color: "var(--ink)",
        cursor: "pointer",
      }}
    >
      <div>{icon}</div>
      <div>
        <div
          style={{
            fontFamily: "var(--f-body)",
            fontSize: 15,
            fontWeight: 700,
            marginBottom: 3,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--f-body)",
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          {desc}
        </div>
      </div>
    </Link>
  );
}

function StatRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "6px 0",
      }}
    >
      <span
        style={{
          fontFamily: "var(--f-body)",
          fontSize: 13,
          color: "var(--ink-2)",
        }}
      >
        {label}
      </span>
      <span style={{ ...serifNum, fontSize: 20, color: "var(--ink)" }}>
        {value}
      </span>
    </div>
  );
}

export function DashboardPage() {
  const { venueName } = useStaffAuth();
  const [beansSupply, setBeansSupply] = useState<number | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  const [customerSA, setCustomerSA] = useState(DEMO_CUSTOMER_SA ?? "");
  const [snap, setSnap] = useState<{
    stampCount: number;
    beansBalance: number;
    venueBreakdown: Record<string, number>;
  } | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getBeansTotalSupply();
        if (!cancelled) setBeansSupply(s);
      } catch (e) {
        if (!cancelled)
          setChainError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lookup = async () => {
    if (!customerSA.trim() || looking) return;
    setLooking(true);
    setLookupErr(null);
    setSnap(null);
    try {
      const s = await getCustomerSnapshot(customerSA.trim());
      setSnap(s);
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLooking(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100%" }}>
      {/* Left column — real chain figures */}
      <aside
        style={{
          width: 300,
          flexShrink: 0,
          borderRight: "1px solid var(--line)",
          padding: 24,
          background: "var(--bg-elev)",
        }}
      >
        <div style={eyebrow}>beans 総発行量（オンチェーン）</div>
        <div
          style={{
            ...serifNum,
            fontSize: 52,
            color: "var(--ink)",
            lineHeight: 1,
          }}
        >
          {beansSupply == null ? (chainError ? "—" : "…") : beansSupply}
        </div>
        <div
          style={{
            fontFamily: "var(--f-body)",
            fontSize: 13,
            color: "var(--ink-2)",
            marginTop: 4,
          }}
        >
          beans-token.total_supply
        </div>

        <div style={divider} />

        <div style={eyebrow}>店舗</div>
        {VENUES.map((v) => (
          <StatRow
            key={v.id}
            label={v.name}
            value={v.name === venueName ? "● 営業中" : "—"}
          />
        ))}

        {chainError && (
          <>
            <div style={divider} />
            <p
              style={{
                fontSize: 11.5,
                color: "var(--bad, #c0392b)",
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              チェーン読み取りエラー: {chainError}
            </p>
          </>
        )}
      </aside>

      {/* Center column — actions */}
      <main style={{ flex: 1, padding: "24px 28px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 20,
          }}
        >
          <span style={sectionTitle}>主な操作</span>
          <span
            style={{
              fontFamily: "var(--f-body)",
              fontSize: 12,
              color: "var(--ink-4)",
            }}
          >
            本部 Smart Account 経由・実トランザクション
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <BigTile
            to="/issue-stamp"
            icon={<IconStamp size={28} />}
            title="スタンプ発行"
            desc="顧客 SA にオンチェーン発行"
            accent
          />
          <BigTile
            to="/receive-benefit"
            icon={<IconGift size={28} />}
            title="特典券 受取"
            desc="顧客の特典券を照会"
          />
          <BigTile
            to="/use-beans"
            icon={<Bean size={28} color="var(--accent-2)" />}
            title="beans 利用"
            desc="本部 SA で beans を消費"
          />
          <BigTile
            to="/"
            icon={<IconCalendar size={28} />}
            title="顧客照会"
            desc="スタンプ・beans を確認"
          />
        </div>

        <div
          style={{
            padding: "16px 20px",
            borderRadius: 14,
            background: "var(--accent-pale)",
            border: "1px solid var(--accent-soft)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 12,
            }}
          >
            <IconSpark size={24} />
            <div
              style={{
                fontFamily: "var(--f-body)",
                fontSize: 14,
                fontWeight: 700,
                color: "var(--ink)",
              }}
            >
              顧客照会（オンチェーン）
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="顧客 SA (C...)"
              value={customerSA}
              onChange={(e) => setCustomerSA(e.target.value)}
              style={{
                flex: 1,
                padding: "10px 14px",
                fontSize: 13,
                fontFamily: "var(--f-mono)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--bg-elev)",
                color: "var(--ink)",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <button
              onClick={lookup}
              disabled={looking || !customerSA.trim()}
              style={{
                padding: "0 16px",
                fontSize: 13,
                fontWeight: 600,
                background: "var(--ink)",
                color: "var(--bg-elev)",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                opacity: looking || !customerSA.trim() ? 0.5 : 1,
              }}
            >
              {looking ? "照会中..." : "照会"}
            </button>
          </div>
          {snap && (
            <div
              style={{
                display: "flex",
                gap: 24,
                marginTop: 14,
                fontFamily: "var(--f-body)",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <span>
                スタンプ{" "}
                <strong style={{ ...serifNum, fontSize: 18 }}>
                  {snap.stampCount}
                </strong>
              </span>
              <span>
                beans{" "}
                <strong style={{ ...serifNum, fontSize: 18 }}>
                  {snap.beansBalance}
                </strong>
              </span>
            </div>
          )}
          {lookupErr && (
            <p
              style={{
                marginTop: 12,
                fontSize: 11.5,
                color: "var(--bad, #c0392b)",
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {lookupErr}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

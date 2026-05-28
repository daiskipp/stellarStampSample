import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useCustomerData } from "../lib/useCustomerData";
import {
  CupGlyph,
  CupOutline,
  Bean,
  Sakura,
  IconBell,
  IconSettings,
  IconGift,
  IconScan,
  IconChevron,
} from "@dicekey/ui-components";

/* ── shared inline-style presets ── */

const sEyebrow: React.CSSProperties = {
  fontFamily: "var(--f-mono)",
  fontSize: 10.5,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  fontWeight: 500,
  margin: 0,
};

const sSection: React.CSSProperties = {
  fontFamily: "var(--f-body)",
  fontWeight: 700,
  fontSize: 14,
  letterSpacing: "0.04em",
  margin: 0,
};

const sDisplay: React.CSSProperties = {
  fontFamily: "var(--f-display)",
  fontWeight: 400,
  fontStyle: "italic",
  lineHeight: 1,
  letterSpacing: "-0.02em",
};

const sMute: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--ink-3)",
  margin: 0,
};

const sMono: React.CSSProperties = {
  fontFamily: "var(--f-mono)",
  fontSize: 11,
  letterSpacing: "0.02em",
};

/* ── component ── */

export function HomePage() {
  const { displayName } = useAuth();
  const { data, loading, error } = useCustomerData();

  const stampCount = data?.stampCount ?? 0;
  const beansBalance = data?.beansBalance ?? 0;
  const benefitCount = data?.benefitCount ?? 0;
  const badges = data?.badges ?? [];
  const benefits = data?.benefits ?? [];

  const nextMilestone = 50;
  const remaining = nextMilestone - stampCount;
  const progress = Math.min(stampCount / nextMilestone, 1);

  const hour = new Date().getHours();
  const greeting =
    hour < 11 ? "おはようございます" : hour < 17 ? "こんにちは" : "こんばんは";

  const now = new Date();
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  const dateLabel = `${now.getFullYear()} — ${now.getMonth() + 1}月${now.getDate()}日 ${weekday}`;

  // Activity is derived from on-chain holdings (no event index): newest badge
  // + soonest-expiring benefit. Empty until the SA actually holds something.
  const soonestBenefit = [...benefits].sort(
    (a, b) => a.daysLeft - b.daysLeft,
  )[0];
  const latestBadge = [...badges].sort(
    (a, b) => b.awardedAt - a.awardedAt,
  )[0];

  return (
    <div style={{ padding: "0 20px 40px" }}>
      {/* ── Header / Appbar ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 0 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CupGlyph size={22} color="var(--accent)" />
          <span
            style={{
              fontFamily: "var(--f-display)",
              fontStyle: "italic",
              fontSize: 20,
              color: "var(--ink)",
            }}
          >
            dicekey
          </span>
          <span
            style={{
              fontFamily: "var(--f-body)",
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--ink-2)",
              marginTop: 2,
            }}
          >
            Coffee
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <IconBell size={20} />
          <IconSettings size={20} />
        </div>
      </header>

      {/* ── Greeting ── */}
      <section style={{ marginTop: 12, marginBottom: 20 }}>
        <p style={{ ...sEyebrow }}>{dateLabel}</p>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            marginTop: 6,
            marginBottom: 0,
            fontFamily: "var(--f-body)",
            color: "var(--ink)",
            lineHeight: 1.35,
          }}
        >
          {greeting}、{displayName} さん。
        </h1>
      </section>

      {/* ── Hero stat card ── */}
      <section
        style={{
          position: "relative",
          background: "var(--bg-elev)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          padding: "22px 20px",
          marginBottom: 16,
          overflow: "hidden",
        }}
      >
        {/* watermark */}
        <div
          style={{
            position: "absolute",
            right: -20,
            top: -10,
            opacity: 0.05,
            transform: "rotate(-15deg)",
            pointerEvents: "none",
          }}
        >
          <CupGlyph size={160} color="var(--ink)" />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            position: "relative",
          }}
        >
          {/* left side */}
          <div>
            <p style={{ ...sEyebrow, marginBottom: 4 }}>通算来店</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ ...sDisplay, fontSize: 86, color: "var(--ink)" }}>
                {stampCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--f-body)",
                  fontSize: 20,
                  color: "var(--ink-2)",
                }}
              >
                杯
              </span>
            </div>
          </div>

          {/* right side */}
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <p style={{ ...sMute, marginBottom: 2 }}>フィフティクラブまで</p>
            <p
              style={{
                ...sDisplay,
                fontSize: 28,
                color: "var(--accent)",
                margin: 0,
              }}
            >
              あと {remaining}
            </p>
          </div>
        </div>

        {/* progress bar */}
        <div
          style={{
            height: 6,
            background: "var(--bg-2)",
            borderRadius: 3,
            overflow: "hidden",
            marginTop: 16,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: "var(--accent)",
              borderRadius: 3,
              transition: "width 0.3s",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <span style={{ ...sMono, color: "var(--ink-3)" }}>
            {stampCount} / {nextMilestone}
          </span>
          <span style={{ ...sMono, color: "var(--ink-3)" }}>
            次の節目: {nextMilestone} 杯
          </span>
        </div>
      </section>

      {/* ── Show member QR (for in-store scan) ── */}
      <Link
        to="/qr"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          marginBottom: 16,
          background: "var(--accent)",
          color: "var(--on-accent)",
          borderRadius: 14,
          textDecoration: "none",
          fontFamily: "inherit",
          fontWeight: 600,
          fontSize: 14,
          letterSpacing: "0.02em",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconScan size={20} />
          店員にQRを見せる
        </span>
        <IconChevron size={16} />
      </Link>

      {/* ── Secondary stats ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 28,
        }}
      >
        {/* Beans card */}
        <div
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: "16px 14px",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
          >
            <Bean size={14} color="var(--accent)" />
            <span style={{ ...sEyebrow, fontSize: 9.5 }}>beans</span>
          </div>
          <p style={{ ...sDisplay, fontSize: 38, color: "var(--ink)", margin: 0 }}>
            {beansBalance}
          </p>
          <p style={{ ...sMute, marginTop: 6 }}>来店ごとに貯まる</p>
        </div>

        {/* Benefits card */}
        <div
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: "16px 14px",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
          >
            <IconGift size={14} />
            <span style={{ ...sEyebrow, fontSize: 9.5 }}>特典券</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ ...sDisplay, fontSize: 38, color: "var(--ink)" }}>
              {benefitCount}
            </span>
            <span
              style={{
                fontFamily: "var(--f-body)",
                fontSize: 14,
                color: "var(--ink-2)",
              }}
            >
              枚
            </span>
          </div>
          <p
            style={{
              ...sMute,
              marginTop: 6,
              color: soonestBenefit ? "var(--accent)" : "var(--ink-3)",
            }}
          >
            {soonestBenefit
              ? `最短 あと ${soonestBenefit.daysLeft} 日`
              : "まだありません"}
          </p>
        </div>
      </div>

      {/* ── Recent activity ── */}
      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <h2 style={{ ...sSection }}>最近のできごと</h2>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "var(--accent)",
              fontFamily: "var(--f-body)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            すべて見る
            <IconChevron size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {loading && (
            <p style={{ ...sMute, padding: "8px 0" }}>
              チェーンから読み込み中…
            </p>
          )}
          {!loading && error && (
            <p style={{ ...sMute, color: "var(--warn)", padding: "8px 0" }}>
              読み取りエラー: {error}
            </p>
          )}
          {!loading && !error && (
            <>
              {stampCount > 0 && (
                <ActivityRow
                  icon={<CupOutline size={16} color="var(--on-accent)" />}
                  iconBg="var(--accent)"
                  title="来店スタンプ"
                  subtitle={`通算 ${stampCount} 杯`}
                  time=""
                />
              )}
              {latestBadge && (
                <ActivityRow
                  icon={<Sakura size={16} color="var(--accent)" />}
                  iconBg="var(--accent-pale)"
                  title={`バッジ獲得「${latestBadge.label}」`}
                  subtitle=""
                  time=""
                />
              )}
              {soonestBenefit && (
                <ActivityRow
                  icon={<IconGift size={16} />}
                  iconBg="var(--accent-pale)"
                  title={soonestBenefit.label}
                  subtitle={`あと ${soonestBenefit.daysLeft} 日`}
                  time=""
                />
              )}
              {stampCount === 0 &&
                !latestBadge &&
                !soonestBenefit && (
                  <p style={{ ...sMute, padding: "8px 0" }}>
                    まだ記録がありません。お店で来店スタンプを受け取りましょう。
                  </p>
                )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ── Activity row sub-component ── */

function ActivityRow({
  icon,
  iconBg,
  title,
  subtitle,
  time,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  time: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--ink)",
            fontFamily: "var(--f-body)",
          }}
        >
          {title}
        </p>
        {subtitle && (
          <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-3)" }}>
            {subtitle}
          </p>
        )}
      </div>
      <span
        style={{
          ...sMono,
          color: "var(--ink-3)",
          flexShrink: 0,
        }}
      >
        {time}
      </span>
    </div>
  );
}

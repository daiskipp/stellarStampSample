import { CupGlyph, IconBack, IconShare, IconSpark, Sakura } from "@dicekey/ui-components";
import { useCustomerData } from "../lib/useCustomerData";

function BadgeMedal({ icon, label, locked = false }: { icon?: React.ReactNode; label: string; locked?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 78 }}>
      <div style={{
        width: 66, height: 66, borderRadius: "50%",
        background: locked ? "transparent" : "var(--accent-pale)",
        border: locked ? "1.5px dashed var(--line-2)" : "1px solid var(--accent-soft)",
        display: "grid", placeItems: "center",
        boxShadow: locked ? "none" : "inset 0 0 0 4px var(--bg-elev), inset 0 0 0 5px var(--accent-soft)",
      }}>
        {locked ? <span style={{ color: "var(--ink-4)", fontSize: 14 }}>?</span> : icon}
      </div>
      <div style={{
        fontSize: 10.5, textAlign: "center", lineHeight: 1.25,
        color: locked ? "var(--ink-4)" : "var(--ink-2)", whiteSpace: "pre-line", fontWeight: 500,
      }}>{label}</div>
    </div>
  );
}

export function StampsPage() {
  const { data, loading, error } = useCustomerData();
  const badges = data?.badges ?? [];
  const stampCount = data?.stampCount ?? 0;
  const goal = 100;
  const remaining = goal - stampCount;
  const progressPct = (stampCount / goal) * 100;
  const totalSlots = 50;
  const milestones = [10, 50];

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      {/* App bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px", position: "sticky", top: 0,
        background: "var(--bg)", zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconBack size={20} />
          <span style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700 }}>
            来店スタンプ
          </span>
        </div>
        <IconShare size={20} />
      </div>

      <div style={{ padding: "0 16px 32px" }}>
        {(loading || error) && (
          <div style={{
            fontSize: 12, color: error ? "var(--warn)" : "var(--ink-3)",
            fontFamily: "var(--f-mono)", padding: "8px 0 12px",
          }}>
            {error ? `読み取りエラー: ${error}` : "チェーンから読み込み中…"}
          </div>
        )}
        {/* Header stat area */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          marginBottom: 10,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontFamily: "var(--f-display)", fontSize: 72, fontWeight: 700,
              fontStyle: "italic", lineHeight: 1, color: "var(--ink)",
            }}>
              {stampCount}
            </span>
            <span style={{
              fontFamily: "var(--f-body)", fontSize: 16, color: "var(--ink-2)", fontWeight: 500,
            }}>
              杯
            </span>
          </div>
          <div style={{ textAlign: "right", paddingBottom: 8 }}>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 2 }}>
              通算 {goal} 杯まで
            </div>
            <div style={{ fontSize: 15, color: "var(--accent)", fontWeight: 700 }}>
              あと {remaining} 杯
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          height: 10, borderRadius: 100, background: "var(--line)",
          overflow: "hidden", marginBottom: 6,
        }}>
          <div style={{
            height: "100%", width: `${progressPct}%`, borderRadius: 100,
            background: "var(--accent)",
            transition: "width 0.4s ease",
          }} />
        </div>

        {/* Bar labels */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)",
          marginBottom: 22,
        }}>
          <span>10</span>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>● 50</span>
          <span>100</span>
        </div>

        {/* Stamp grid card */}
        <div style={{
          background: "var(--bg-elev)", borderRadius: 16,
          padding: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          marginBottom: 22,
        }}>
          {/* Eyebrow */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
              来店ハンコ
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)" }}>
              2026 / 1 — 100
            </span>
          </div>

          {/* Grid */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6,
            marginBottom: 14,
          }}>
            {Array.from({ length: totalSlots }, (_, i) => {
              const cellNum = i + 1;
              const isFilled = cellNum <= stampCount;
              const isMilestone = milestones.includes(cellNum);
              const rotation = ((i * 137) % 9 - 4) * 0.7;

              if (isFilled) {
                return (
                  <div key={cellNum} style={{
                    aspectRatio: 1, borderRadius: 10, display: "grid", placeItems: "center",
                    background: "var(--bg)", border: "1px solid var(--line)",
                  }}>
                    <div style={{ transform: `rotate(${rotation}deg)` }}>
                      <CupGlyph size={26} color={isMilestone ? "var(--accent)" : "currentColor"} />
                    </div>
                  </div>
                );
              }

              // Empty cell
              if (isMilestone) {
                return (
                  <div key={cellNum} style={{
                    aspectRatio: 1, borderRadius: 10, display: "grid", placeItems: "center",
                    background: "var(--accent-pale)", borderStyle: "dashed",
                    borderWidth: 1, borderColor: "var(--accent)",
                  }}>
                    <span style={{
                      fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 700,
                      color: "var(--accent)",
                    }}>
                      {cellNum}
                    </span>
                  </div>
                );
              }

              return (
                <div key={cellNum} style={{
                  aspectRatio: 1, borderRadius: 10, display: "grid", placeItems: "center",
                  background: "transparent", borderStyle: "dashed",
                  borderWidth: 1, borderColor: "var(--line-2)",
                }} />
              );
            })}
          </div>

          {/* Next milestone chip */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 100,
            background: "var(--accent-pale)", border: "1px solid var(--accent-soft)",
            color: "var(--accent)", fontSize: 11, fontWeight: 600,
          }}>
            <IconSpark size={13} />
            <span>次の節目: 50 杯</span>
            <span style={{ color: "var(--ink-3)", fontWeight: 400, marginLeft: 2 }}>
              「フィフティクラブ」称号
            </span>
          </div>
        </div>

        {/* Badges section */}
        <div style={{ marginTop: 22 }}>
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 14,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
              獲得バッジ
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {badges.length} / 8
            </span>
          </div>

          {/* Horizontal scroll */}
          <div style={{
            display: "flex", gap: 10, overflowX: "auto",
            paddingBottom: 8, WebkitOverflowScrolling: "touch",
          }}>
            {badges.length === 0 && !loading && (
              <div style={{
                fontSize: 12, color: "var(--ink-3)", padding: "20px 4px",
              }}>
                まだバッジがありません。
              </div>
            )}
            {badges.map((b) => (
              <BadgeMedal
                key={b.kind}
                icon={<Sakura size={28} color="var(--accent)" />}
                label={b.label}
              />
            ))}
            <BadgeMedal locked label={"フィフティ\nクラブ"} />
            <BadgeMedal locked label="夜のひと息" />
            <BadgeMedal locked label="常連" />
          </div>
        </div>
      </div>
    </div>
  );
}

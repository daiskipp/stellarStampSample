import { useAuth } from "../contexts/AuthContext";
import { activeConfig } from "../lib/passkey";
import { IconBack, IconChevron, IconLogout } from "@dicekey/ui-components";

export function SettingsPage() {
  const { displayName, contractId, credentialId, logout } = useAuth();

  const shortKey = contractId
    ? contractId.slice(0, 6) + "..." + contractId.slice(-4)
    : "—";
  const shortCred = credentialId
    ? credentialId.slice(0, 8) + "…" + credentialId.slice(-6)
    : "—";
  const network = activeConfig().networkPassphrase;

  return (
    <div>
      {/* App bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 0 12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconBack size={22} />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.005em" }}>設定</span>
        </div>
      </div>

      {/* Account section */}
      <section style={{ marginTop: 12 }}>
        <div style={{
          fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase" as const, color: "var(--ink-3)", fontWeight: 500,
          marginBottom: 10,
        }}>アカウント</div>

        <div style={{
          background: "var(--bg-elev)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>名前</div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{displayName}</div>
            </div>
            <IconChevron size={16} style={{ color: "var(--ink-3)" }} />
          </div>

          <div style={{ height: 1, background: "var(--line)" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Smart Account</div>
              <div
                title={contractId ?? undefined}
                style={{
                  fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)",
                  marginTop: 2, letterSpacing: "0.02em",
                }}
              >{shortKey}</div>
            </div>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 100, background: "var(--bg-2)",
              border: "1px solid var(--line)", fontSize: 11, fontWeight: 600,
              color: "var(--ink-2)", letterSpacing: "0.02em", cursor: "pointer",
            }}>C-address</span>
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "12px 0" }} />

          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>パスキー認証情報</div>
            <div
              title={credentialId ?? undefined}
              style={{
                fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)",
                marginTop: 2, letterSpacing: "0.02em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >{shortCred}</div>
          </div>
        </div>
      </section>

      {/* Sign-in methods */}
      <section style={{ marginTop: 24 }}>
        <div style={{
          fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase" as const, color: "var(--ink-3)", fontWeight: 500,
          marginBottom: 10,
        }}>サインイン方法</div>

        <div style={{
          background: "var(--bg-elev)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>パスキー</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                このデバイス ・ 最終使用: 今日
              </div>
            </div>
            <span style={{
              padding: "4px 10px", borderRadius: 100, background: "var(--accent-pale)",
              border: "1px solid var(--accent-soft)", fontSize: 11, fontWeight: 600,
              color: "var(--accent)", letterSpacing: "0.02em",
            }}>有効</span>
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "12px 0" }} />

          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            color: "var(--ink-3)", cursor: "pointer",
          }}>
            <span style={{ fontSize: 18, fontWeight: 300 }}>+</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>新しいサインイン方法を追加</span>
          </div>
        </div>
      </section>

      {/* Notification settings */}
      <section style={{ marginTop: 24 }}>
        <div style={{
          fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase" as const, color: "var(--ink-3)", fontWeight: 500,
          marginBottom: 10,
        }}>通知</div>

        <div style={{
          background: "var(--bg-elev)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 16,
        }}>
          {[
            { label: "スタンプ獲得通知", on: true },
            { label: "達成通知", on: true },
            { label: "特典券受領通知", on: false },
          ].map((item, i) => (
            <div key={i}>
              {i > 0 && <div style={{ height: 1, background: "var(--line)", margin: "10px 0" }} />}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</span>
                <div style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: item.on ? "var(--accent)" : "var(--bg-3)",
                  position: "relative", cursor: "pointer",
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%",
                    background: "var(--bg-elev)",
                    position: "absolute", top: 2,
                    left: item.on ? 20 : 2,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                  }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Network info */}
      <section style={{ marginTop: 24 }}>
        <div style={{
          fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase" as const, color: "var(--ink-3)", fontWeight: 500,
          marginBottom: 10,
        }}>ネットワーク</div>

        <div style={{
          background: "var(--bg-elev)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 16,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span
            title={network}
            style={{
              fontSize: 12, fontWeight: 500, fontFamily: "var(--f-mono)",
              color: "var(--ink-2)", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 10,
            }}
          >{network}</span>
          <span style={{
            padding: "4px 10px", borderRadius: 100,
            background: "var(--bg-2)", border: "1px solid var(--line)",
            fontSize: 11, fontWeight: 600, color: "var(--ink-3)",
            fontFamily: "var(--f-mono)", flexShrink: 0,
          }}>v0.1.0</span>
        </div>
      </section>

      {/* Logout */}
      <button
        onClick={logout}
        style={{
          width: "100%", marginTop: 28,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "14px 18px", borderRadius: 100,
          background: "transparent", border: "1px solid var(--warn)",
          color: "var(--warn)", fontSize: 14, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.02em",
        }}
      >
        <IconLogout size={18} />
        サインアウト
      </button>

      <div style={{ height: 20 }} />
    </div>
  );
}

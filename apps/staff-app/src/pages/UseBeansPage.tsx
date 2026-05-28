import { useState } from "react";
import { useStaffAuth } from "../contexts/StaffAuthContext";
import { getCustomerSnapshot, useBeans } from "../lib/chain";
import { Bean, IconCheck, CupGlyph } from "@dicekey/ui-components";

const DEMO_CUSTOMER_SA = (
  import.meta.env as unknown as Record<string, string | undefined>
).VITE_DEMO_CUSTOMER_SA;

interface MenuItem {
  name: string;
  beans: number;
}

const MENU: MenuItem[] = [
  { name: "ドリップコーヒー (S)", beans: 30 },
  { name: "ドリップコーヒー (M)", beans: 40 },
  { name: "ラテ (S)", beans: 40 },
  { name: "ラテ (M)", beans: 50 },
  { name: "カプチーノ", beans: 45 },
  { name: "モカ", beans: 55 },
];

export function UseBeansPage() {
  const { hqContractId, staffCredentialId, staffRuleIds } = useStaffAuth();
  const [customerSA, setCustomerSA] = useState(DEMO_CUSTOMER_SA ?? "");
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [status, setStatus] = useState<
    "select" | "working" | "done" | "error"
  >("select");
  const [error, setError] = useState<string | null>(null);

  const loadBalance = async () => {
    if (!customerSA.trim()) return;
    setError(null);
    try {
      const snap = await getCustomerSnapshot(customerSA.trim());
      setBalance(snap.beansBalance);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const redeem = async (item: MenuItem) => {
    if (!hqContractId || !staffCredentialId || !customerSA.trim()) {
      setError("店舗・スタッフ資格情報・顧客 SA が必要です。");
      setStatus("error");
      return;
    }
    // beans-token rule = index 1 of the staff rule ids
    // [visit-stamps, beans-token, reward-policy].
    const beansRuleId = staffRuleIds[1];
    if (beansRuleId == null) {
      setError("beans-token のスタッフルール id が見つかりません。");
      setStatus("error");
      return;
    }
    setSelected(item);
    setStatus("working");
    setError(null);
    const r = await useBeans({
      hqSmartAccount: hqContractId,
      customerSA: customerSA.trim(),
      amount: item.beans,
      staffCredentialId,
      beansRuleId,
    });
    if (!r.ok) {
      setError(r.error ?? "beans 利用に失敗しました。");
      setStatus("error");
      return;
    }
    await loadBalance();
    setStatus("done");
  };

  const reset = () => {
    setStatus("select");
    setSelected(null);
    setError(null);
  };

  return (
    <div style={{ padding: "0 4px", maxWidth: 480, margin: "0 auto" }}>
      {(status === "select" || status === "error") && (
        <div style={{ paddingTop: 32 }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase" as const,
                color: "var(--ink-3)",
                fontWeight: 500,
                marginBottom: 12,
              }}
            >
              BEANS REDEEM
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--ink)",
                margin: "0 0 14px",
                fontFamily: "var(--f-body)",
              }}
            >
              beans 利用
            </h2>
            <p
              style={{
                fontSize: 13,
                color: "var(--ink-2)",
                lineHeight: 1.55,
                maxWidth: 360,
                margin: "0 auto 18px",
              }}
            >
              顧客の SA を入力し、利用メニューを選択すると本部 SA が
              beans-token.burn_from でオンチェーン消費します（顧客が事前に本部へ
              allowance を付与している必要があります）。
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="顧客 SA (C...)"
              value={customerSA}
              onChange={(e) => setCustomerSA(e.target.value)}
              style={{
                flex: 1,
                padding: "11px 14px",
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
              onClick={loadBalance}
              style={{
                padding: "0 16px",
                fontSize: 13,
                fontWeight: 600,
                background: "var(--bg-2)",
                color: "var(--ink-2)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              残高照会
            </button>
          </div>
          {balance != null && (
            <p
              style={{
                fontSize: 12.5,
                color: "var(--ink-2)",
                marginBottom: 16,
              }}
            >
              現在の beans 残高: <strong>{balance}</strong>
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {MENU.map((item) => (
              <button
                key={item.name}
                onClick={() => redeem(item)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 16px",
                  background: "var(--bg-elev)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontSize: 14,
                  fontFamily: "inherit",
                  color: "var(--ink)",
                  textAlign: "left" as const,
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Bean size={16} color="var(--accent)" />
                  {item.name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--f-display)",
                    fontStyle: "italic",
                    fontSize: 16,
                    color: "var(--ink)",
                    fontWeight: 600,
                  }}
                >
                  {item.beans}
                </span>
              </button>
            ))}
          </div>

          {status === "error" && error && (
            <p
              style={{
                marginTop: 18,
                fontSize: 12.5,
                color: "var(--bad, #c0392b)",
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {error}
            </p>
          )}
        </div>
      )}

      {status === "working" && (
        <div style={{ textAlign: "center", paddingTop: 64 }}>
          <Bean size={36} color="var(--accent)" />
          <p
            style={{ marginTop: 18, fontSize: 14, color: "var(--ink-2)" }}
          >
            本部 SA で beans 消費トランザクションを送信中...
          </p>
        </div>
      )}

      {status === "done" && selected && (
        <div style={{ textAlign: "center", paddingTop: 48 }}>
          <IconCheck size={48} color="var(--accent)" />
          <h3
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--ink)",
              margin: "16px 0 8px",
              fontFamily: "var(--f-body)",
            }}
          >
            利用完了
          </h3>
          <p
            style={{
              fontSize: 14,
              color: "var(--ink-2)",
              marginBottom: 6,
            }}
          >
            {selected.name} — {selected.beans} beans 消費
          </p>
          {balance != null && (
            <p
              style={{
                fontSize: 13,
                color: "var(--ink-2)",
                marginBottom: 20,
              }}
            >
              新しい残高: <strong>{balance}</strong>
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 600,
              background: "transparent",
              color: "var(--ink-2)",
              border: "1px solid var(--line)",
              borderRadius: 100,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            続ける
          </button>
          <CupGlyph
            size={28}
            color="var(--accent)"
            style={{ opacity: 0.3, display: "block", margin: "20px auto 0" }}
          />
        </div>
      )}
    </div>
  );
}

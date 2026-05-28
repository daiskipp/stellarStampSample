import { useState } from "react";
import { useStaffAuth } from "../contexts/StaffAuthContext";
import {
  getBenefits,
  receiveBenefit,
  type BenefitToken,
} from "../lib/chain";
import { IconGift, IconCheck, CupGlyph } from "@dicekey/ui-components";

const DEMO_CUSTOMER_SA = (
  import.meta.env as unknown as Record<string, string | undefined>
).VITE_DEMO_CUSTOMER_SA;

// Receive Benefit — REAL on-chain redemption.
//
// contracts/dicekey-benefits/src/lib.rs now exposes an admin-gated
//   pub fn burn_from(env, admin, owner, token_id) { require_admin(admin); ... }
// so the HQ Smart Account (admin) can redeem a customer's voucher with the
// staff passkey signing (single benefits auth_context, resolved against the
// benefits staff CallContract rule). The customer does NOT need to sign.
export function ReceiveBenefitPage() {
  const { hqContractId, staffCredentialId, staffBenefitsRuleId } =
    useStaffAuth();
  const [customerSA, setCustomerSA] = useState(DEMO_CUSTOMER_SA ?? "");
  const [tokens, setTokens] = useState<BenefitToken[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<number | null>(null);
  const [redeemedId, setRedeemedId] = useState<number | null>(null);

  const lookup = async () => {
    if (!customerSA.trim() || loading) return;
    setLoading(true);
    setError(null);
    setTokens(null);
    setRedeemedId(null);
    try {
      const list = await getBenefits(customerSA.trim());
      setTokens(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const redeem = async (t: BenefitToken) => {
    if (redeemingId != null) return;
    if (!hqContractId || !staffCredentialId || !customerSA.trim()) {
      setError("店舗・スタッフ資格情報・顧客 SA が必要です。");
      return;
    }
    if (!staffBenefitsRuleId) {
      setError(
        "benefits のスタッフルール id が見つかりません（端末セットアップを再実行してください）。",
      );
      return;
    }
    setRedeemingId(t.id);
    setError(null);
    const r = await receiveBenefit({
      hqSmartAccount: hqContractId,
      customerSA: customerSA.trim(),
      tokenId: t.id,
      staffCredentialId,
      benefitsRuleId: staffBenefitsRuleId,
    });
    setRedeemingId(null);
    if (!r.ok) {
      setError(r.error ?? "特典券の引き換えに失敗しました。");
      return;
    }
    setRedeemedId(t.id);
    // Re-query the real on-chain voucher list so the count reflects the burn.
    try {
      const list = await getBenefits(customerSA.trim());
      setTokens(list);
    } catch {
      // keep the prior list; the redemption itself succeeded
    }
  };

  return (
    <div style={{ padding: "0 4px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ textAlign: "center", paddingTop: 32 }}>
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
          BENEFIT RECEIVE
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
          特典券 受取
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--ink-2)",
            lineHeight: 1.55,
            maxWidth: 380,
            margin: "0 auto 20px",
          }}
        >
          顧客の SA を入力すると保有する特典券 NFT
          をオンチェーン照会します。引き換えは本部 SA が
          benefits.burn_from でオンチェーン消費します（顧客の署名は不要）。
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
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
          onClick={lookup}
          disabled={loading || !customerSA.trim()}
          style={{
            padding: "0 18px",
            fontSize: 13,
            fontWeight: 600,
            background: "var(--accent)",
            color: "var(--on-accent)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
            opacity: loading || !customerSA.trim() ? 0.5 : 1,
          }}
        >
          {loading ? "照会中..." : "特典券を照会"}
        </button>
      </div>

      {error && (
        <p
          style={{
            fontSize: 12.5,
            color: "var(--bad, #c0392b)",
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {error}
        </p>
      )}

      {tokens && tokens.length === 0 && (
        <p
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            textAlign: "center",
            padding: "24px 0",
          }}
        >
          この顧客は特典券を保有していません。
        </p>
      )}

      {tokens && tokens.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tokens.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                background: "var(--bg-elev)",
                border: "1px solid var(--line)",
                borderRadius: 12,
              }}
            >
              <IconGift size={20} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--ink)",
                  }}
                >
                  {t.label}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    fontFamily: "var(--f-mono)",
                    color: "var(--ink-4)",
                  }}
                >
                  #{t.id} · {t.kind}
                </div>
              </div>
              <button
                onClick={() => redeem(t)}
                disabled={redeemingId != null}
                style={{
                  padding: "8px 14px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  border: "none",
                  borderRadius: 8,
                  cursor: redeemingId != null ? "default" : "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                  opacity: redeemingId != null ? 0.5 : 1,
                }}
              >
                {redeemingId === t.id ? "引換中..." : "引き換え"}
              </button>
            </div>
          ))}
        </div>
      )}

      {redeemedId != null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "center",
            marginTop: 18,
            fontSize: 13,
            color: "var(--accent)",
            fontWeight: 600,
          }}
        >
          <IconCheck size={18} color="var(--accent)" />
          特典券 #{redeemedId} をオンチェーンで引き換えました
        </div>
      )}

      <CupGlyph
        size={28}
        color="var(--accent)"
        style={{ opacity: 0.25, display: "block", margin: "32px auto 0" }}
      />
    </div>
  );
}

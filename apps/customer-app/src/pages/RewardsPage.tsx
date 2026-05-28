import { useState, useEffect } from "react";
import {
  Bean,
  IconGift,
  IconShare,
  IconChevron,
  IconSpark,
  IconFire,
  IconCalendar,
  IconBack,
} from "@dicekey/ui-components";
import { useCustomerData } from "../lib/useCustomerData";
import type { ChainBenefit } from "../lib/chain";
import { approveBeans, getHqBeansAllowance } from "../lib/chain";
import { useAuth } from "../contexts/AuthContext";

/* ── Ticket Card ─────────────────────────────────── */

function TicketCard({
  benefit,
  onGift,
}: {
  benefit: ChainBenefit;
  onGift: (b: ChainBenefit) => void;
}) {
  const isWarn = benefit.daysLeft < 120;

  return (
    <div
      style={{
        display: "flex",
        background: "var(--bg-elev)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        overflow: "hidden",
        marginBottom: 10,
      }}
    >
      {/* Left stub */}
      <div
        style={{
          width: 72,
          background: "var(--accent-pale)",
          borderRight: "1.5px dashed var(--accent-soft)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          gap: 4,
          padding: "14px 0",
        }}
      >
        {/* Top perforation */}
        <div
          style={{
            position: "absolute",
            top: -7,
            right: -7,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--bg)",
          }}
        />
        {/* Bottom perforation */}
        <div
          style={{
            position: "absolute",
            bottom: -7,
            right: -7,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--bg)",
          }}
        />
        <IconGift size={20} />
        <span
          style={{
            fontSize: 8,
            fontFamily: "monospace",
            letterSpacing: 1,
            color: "var(--ink-3)",
            fontWeight: 600,
          }}
        >
          COUPON
        </span>
      </div>

      {/* Right body */}
      <div style={{ flex: 1, padding: "12px 14px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
          {benefit.label}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--txt-mute)",
            marginBottom: 8,
          }}
        >
          {benefit.description}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: isWarn ? "var(--warn)" : "var(--ink-3)",
            }}
          >
            {isWarn && <IconFire size={12} />}
            <span>
              あと {benefit.daysLeft} 日 ・{" "}
              {new Date(benefit.expiresAt).toLocaleDateString("ja-JP", {
                month: "short",
                day: "numeric",
              })}
              まで
            </span>
          </div>
          <button
            onClick={() => onGift(benefit)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <IconChevron size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Gift Dialog ─────────────────────────────────── */

function GiftDialog({
  benefit,
  onClose,
}: {
  benefit: ChainBenefit;
  onClose: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!recipient.trim()) return;
    // In production: call dicekey-benefits.transfer(from, to, tokenId)
    setSent(true);
    setTimeout(onClose, 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 10, 5, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "var(--bg-elev)",
          borderRadius: 18,
          padding: 24,
          width: "90%",
          maxWidth: 360,
        }}
      >
        {sent ? (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  color: "var(--on-accent)",
                  fontWeight: 700,
                }}
              >
                ✓
              </span>
            </div>
            <p style={{ fontWeight: 600, fontSize: 16, margin: "0 0 6px" }}>
              送信しました！
            </p>
            <p style={{ fontSize: 13, color: "var(--txt-mute)" }}>
              {benefit.label} を {recipient} に送りました
            </p>
          </div>
        ) : (
          <>
            <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>
              贈る: {benefit.label}
            </h3>
            <input
              type="text"
              placeholder="送り先のアドレスまたは名前"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 14,
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--bg-elev)",
                marginBottom: 16,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "12px",
                  fontSize: 14,
                  fontWeight: 600,
                  background: "transparent",
                  border: "1px solid var(--line-2)",
                  borderRadius: 100,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>
              <button
                onClick={handleSend}
                disabled={!recipient.trim()}
                style={{
                  flex: 1,
                  padding: "12px",
                  fontSize: 14,
                  fontWeight: 600,
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  border: "1px solid var(--accent)",
                  borderRadius: 100,
                  cursor: "pointer",
                  opacity: recipient.trim() ? 1 : 0.5,
                }}
              >
                送る
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Store-use approval ───────────────────────────── */

// Lets the customer grant the dicekey HQ Smart Account a beans allowance so
// the store can redeem (beans-token.burn_from) at the counter. This is the
// real customer-authorised approve() — the missing piece staff-app's Use Beans
// depends on. Minimal UI, design tokens preserved.
function StoreUseApproval({ beansBalance }: { beansBalance: number }) {
  const { contractId, credentialId } = useAuth();
  const [allowance, setAllowance] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contractId) return;
    let cancelled = false;
    getHqBeansAllowance(contractId)
      .then((a) => {
        if (!cancelled) setAllowance(a);
      })
      .catch(() => {
        if (!cancelled) setAllowance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  const approve = async () => {
    if (!contractId || !credentialId || beansBalance <= 0) return;
    setStatus("working");
    setError(null);
    const r = await approveBeans({
      customerSA: contractId,
      customerCredentialId: credentialId,
      amount: beansBalance,
    });
    if (!r.ok) {
      setError(r.error ?? "承認に失敗しました。");
      setStatus("error");
      return;
    }
    setAllowance(r.allowance ?? beansBalance);
    setStatus("done");
  };

  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 16,
        marginTop: 8,
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
        店舗で beans を使う
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--txt-mute)",
          lineHeight: 1.55,
          marginBottom: 12,
        }}
      >
        本部 Smart Account に beans の利用枠を承認すると、店舗スタッフが
        カウンターで beans を消費（burn_from）できるようになります。
        {allowance != null && (
          <>
            <br />
            現在の承認枠: <strong>{allowance}</strong> beans
          </>
        )}
      </div>
      {status === "done" ? (
        <div style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
          ✓ {allowance ?? beansBalance} beans を店舗利用に承認しました
        </div>
      ) : (
        <button
          onClick={approve}
          disabled={status === "working" || beansBalance <= 0}
          style={{
            width: "100%",
            padding: "12px",
            fontSize: 14,
            fontWeight: 600,
            background: "var(--accent)",
            color: "var(--on-accent)",
            border: "1px solid var(--accent)",
            borderRadius: 100,
            cursor:
              status === "working" || beansBalance <= 0
                ? "default"
                : "pointer",
            opacity: status === "working" || beansBalance <= 0 ? 0.5 : 1,
          }}
        >
          {status === "working"
            ? "承認トランザクション送信中…"
            : beansBalance <= 0
              ? "承認できる beans がありません"
              : `${beansBalance} beans を店舗で使えるように承認`}
        </button>
      )}
      {status === "error" && error && (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--warn, #c0392b)",
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}

/* ── Rewards Page ─────────────────────────────────── */

export function RewardsPage() {
  const { data, loading, error } = useCustomerData();
  const beansBalance = data?.beansBalance ?? 0;
  const benefits = data?.benefits ?? [];
  const [giftTarget, setGiftTarget] = useState<ChainBenefit | null>(null);

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* ── App bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          padding: "4px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              display: "flex",
              color: "var(--ink)",
            }}
          >
            <IconBack size={22} />
          </button>
          <span style={{ fontSize: 18, fontWeight: 700 }}>リワード</span>
        </div>
        <button
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            color: "var(--ink)",
          }}
        >
          <IconCalendar size={22} />
        </button>
      </div>

      {/* ── Beans hero card ── */}
      <section
        style={{
          background: "var(--ink)",
          color: "var(--bg-elev)",
          borderRadius: 18,
          padding: 20,
          overflow: "hidden",
          position: "relative",
          marginBottom: 8,
        }}
      >
        {/* Watermark */}
        <div
          style={{
            position: "absolute",
            right: -10,
            bottom: -10,
            opacity: 0.07,
            color: "var(--bg-elev)",
            lineHeight: 0,
          }}
        >
          <Bean size={120} />
        </div>

        {/* Eyebrow */}
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            fontWeight: 600,
            letterSpacing: 0.5,
            marginBottom: 4,
          }}
        >
          dicekey beans 残高
        </div>

        {/* Big number row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontStyle: "italic",
              fontSize: 76,
              lineHeight: 0.9,
              color: "var(--bg-elev)",
            }}
          >
            {beansBalance}
          </span>
          <span style={{ marginBottom: 8 }}>
            <Bean size={20} color="var(--accent-soft)" />
          </span>
        </div>

        {/* Muted expiry */}
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            marginBottom: 16,
          }}
        >
          {loading
            ? "チェーンから読み込み中…"
            : error
              ? `読み取りエラー: ${error}`
              : "来店ごとに beans が貯まります"}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, position: "relative" }}>
          <button
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "12px 18px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: "transparent",
              border: "1px solid rgba(251,246,236,0.25)",
              color: "var(--bg-elev)",
            }}
          >
            <IconShare size={14} />
            贈る
          </button>
          <button
            style={{
              flex: 1.4,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "12px 18px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "1px solid var(--accent)",
            }}
          >
            使う
          </button>
        </div>
      </section>

      {/* ── Earn rate hint ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          color: "var(--ink-2)",
          marginBottom: 24,
          paddingLeft: 2,
        }}
      >
        <IconSpark size={13} />
        <span>100 杯目で +500 beans ボーナス</span>
      </div>

      {/* ── Store-use approval (real customer-authorised beans approve) ── */}
      <StoreUseApproval beansBalance={beansBalance} />

      {/* ── Tickets section ── */}
      <section style={{ marginTop: 24 }}>
        {/* Section header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            特典券 {benefits.length} 枚
          </span>
          <button
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 13,
              color: "var(--ink-3)",
            }}
          >
            履歴
            <IconChevron size={14} />
          </button>
        </div>

        {/* Ticket cards */}
        {!loading && !error && benefits.length === 0 && (
          <div style={{
            fontSize: 13, color: "var(--ink-3)", padding: "12px 0",
          }}>
            まだ特典券がありません。スタンプを貯めると獲得できます。
          </div>
        )}
        {benefits.map((b) => (
          <TicketCard key={b.id} benefit={b} onGift={setGiftTarget} />
        ))}

        {/* Next ticket placeholder */}
        <div
          style={{
            background: "transparent",
            border: "1.5px dashed var(--line-2)",
            borderRadius: 14,
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 4,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--accent-pale)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconGift size={18} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
              次の特典券
            </div>
            <div style={{ fontSize: 11, color: "var(--txt-mute)" }}>
              フィフティクラブ達成で開放 ・ あと 8 杯
            </div>
          </div>
        </div>
      </section>

      {/* ── Gift dialog ── */}
      {giftTarget && (
        <GiftDialog
          benefit={giftTarget}
          onClose={() => setGiftTarget(null)}
        />
      )}
    </div>
  );
}

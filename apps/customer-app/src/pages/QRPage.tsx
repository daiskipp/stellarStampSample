import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  createStampRequestQR,
  QR_DEFAULT_TTL_SEC,
  type StampRequestQRv1,
} from "@dicekey/sdk";
import { useAuth } from "../contexts/AuthContext";
import { IconBack } from "@dicekey/ui-components";

type QRState = { text: string; payload: StampRequestQRv1 };

export function QRPage() {
  const navigate = useNavigate();
  const { contractId, displayName } = useAuth();
  const [qr, setQr] = useState<QRState | null>(null);
  const [remaining, setRemaining] = useState(QR_DEFAULT_TTL_SEC);

  // (Re)generate the QR whenever the C-address becomes known or the previous
  // QR expires. Keep the regenerator inside the effect so React 19's strict
  // double-invoke produces a stable value.
  useEffect(() => {
    if (!contractId) return;

    const regenerate = () => {
      const next = createStampRequestQR({ sa: contractId });
      setQr({ text: next.text, payload: next.payload });
    };
    regenerate();

    const tick = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setQr((prev) => {
        if (!prev) return prev;
        const left = prev.payload.exp - now;
        if (left <= 0) {
          const next = createStampRequestQR({ sa: contractId });
          setRemaining(next.payload.exp - next.payload.iat);
          return { text: next.text, payload: next.payload };
        }
        setRemaining(left);
        return prev;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [contractId]);

  const handleRegenerate = () => {
    if (!contractId) return;
    const next = createStampRequestQR({ sa: contractId });
    setQr({ text: next.text, payload: next.payload });
    setRemaining(next.payload.exp - next.payload.iat);
  };

  const shortKey = contractId
    ? contractId.slice(0, 6) + "..." + contractId.slice(-4)
    : "—";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 0 12px",
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label="戻る"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--ink)",
            font: "inherit",
          }}
        >
          <IconBack size={22} />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.005em" }}>
            会員 QR
          </span>
        </button>
      </div>

      <div style={{ textAlign: "center", paddingTop: 8 }}>
        <p
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            margin: 0,
          }}
        >
          STAMP REQUEST
        </p>
        <h2
          style={{
            fontFamily: "var(--f-body)",
            fontWeight: 700,
            fontSize: 18,
            margin: "10px 0 4px",
          }}
        >
          {displayName} さん
        </h2>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--ink-2)",
            margin: 0,
          }}
        >
          店員にこの画面を見せてください
        </p>
      </div>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            padding: 18,
            background: "#fff",
            borderRadius: 18,
            border: "1px solid var(--line)",
          }}
        >
          {qr ? (
            <QRCodeSVG
              value={qr.text}
              size={256}
              level="M"
              marginSize={2}
              aria-label="customer Smart Account QR"
            />
          ) : (
            <div
              style={{
                width: 256,
                height: 256,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-3)",
                fontSize: 12,
              }}
            >
              QR を生成中…
            </div>
          )}
        </div>
      </div>

      <p
        style={{
          textAlign: "center",
          marginTop: 16,
          fontFamily: "var(--f-mono)",
          fontSize: 11,
          color: "var(--ink-3)",
          wordBreak: "break-all",
        }}
        title={contractId ?? undefined}
      >
        {shortKey}
      </p>

      <div
        style={{
          marginTop: 12,
          textAlign: "center",
          color: remaining <= 10 ? "var(--warn)" : "var(--ink-2)",
          fontSize: 13,
          fontFamily: "var(--f-mono)",
          letterSpacing: "0.04em",
        }}
      >
        有効: 残り {remaining} 秒
      </div>

      <button
        onClick={handleRegenerate}
        style={{
          display: "block",
          margin: "20px auto 0",
          padding: "10px 20px",
          background: "transparent",
          border: "1px solid var(--line)",
          borderRadius: 100,
          color: "var(--ink-2)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        QR を再生成
      </button>

      <p
        style={{
          margin: "24px auto 0",
          maxWidth: 320,
          fontSize: 11.5,
          color: "var(--ink-3)",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        この QR は {QR_DEFAULT_TTL_SEC} 秒間有効です。
        盗み見対策のため、店員に提示する直前に開いてください。
      </p>
    </div>
  );
}

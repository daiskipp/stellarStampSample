import { useRef, useState } from "react";
import { useStaffAuth } from "../contexts/StaffAuthContext";
import { issueStamp } from "../lib/chain";
import { CupGlyph, IconCheck, IconScan } from "@dicekey/ui-components";
import { QRScanner } from "../components/QRScanner";
import {
  parseStampRequestQR,
  verifyStampRequestQR,
  type VerifyResult,
} from "@dicekey/sdk";

const VERIFY_REASON_LABEL: Record<
  Exclude<VerifyResult, { ok: true }>["reason"],
  string
> = {
  expired: "QR の有効期限が切れています。お客様に再表示をお願いしてください。",
  "future-iat": "端末の時刻が顧客側とずれています。",
  replay: "この QR は既に使用済みです。",
  "bad-sa": "顧客アドレスの形式が不正です。",
};

const PARSE_REASON_LABEL: Record<string, string> = {
  "not-json": "未対応の QR です（テキスト形式）。",
  schema: "QR の中身が不正です。",
  "unsupported-version": "QR のバージョンが未対応です。",
  "unsupported-action": "この QR はスタンプ発行用ではありません。",
};

const DEMO_CUSTOMER_SA = (
  import.meta.env as unknown as Record<string, string | undefined>
).VITE_DEMO_CUSTOMER_SA;

export function IssueStampPage() {
  const { venue, venueName, hqContractId, staffCredentialId, staffRuleIds } =
    useStaffAuth();
  const [customerSA, setCustomerSA] = useState("");
  const [status, setStatus] = useState<"idle" | "issuing" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    stampCount: number;
    beansBalance: number;
    hash?: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const seenNoncesRef = useRef<Set<string>>(new Set());

  // The customer SA can be typed, pasted, or read from a QR scanner that
  // emits the C-address as plain text into the focused input. Trim a possible
  // JSON wrapper (e.g. {"sa":"C..."} from a richer QR payload).
  function normalizeCustomer(raw: string): string {
    const s = raw.trim();
    if (s.startsWith("{")) {
      try {
        const o = JSON.parse(s) as Record<string, unknown>;
        const v = o.sa ?? o.customerSA ?? o.address ?? o.to;
        if (typeof v === "string") return v.trim();
      } catch {
        /* fall through */
      }
    }
    return s;
  }

  const handleIssue = async () => {
    const to = normalizeCustomer(customerSA) || DEMO_CUSTOMER_SA || "";
    if (!to || !hqContractId || !staffCredentialId || !venue) {
      setError("店舗・スタッフ資格情報・顧客 SA が必要です。");
      setStatus("error");
      return;
    }
    if (staffRuleIds.length !== 3) {
      setError(
        `スタッフルール id が 3 つ必要です（現在: [${staffRuleIds.join(",")}]）。端末登録をやり直してください。`,
      );
      setStatus("error");
      return;
    }
    setStatus("issuing");
    setError(null);
    const r = await issueStamp({
      hqSmartAccount: hqContractId,
      customerSA: to,
      venue,
      staffCredentialId,
      ruleIds: staffRuleIds,
    });
    if (!r.ok) {
      setError(r.error ?? "発行に失敗しました。");
      setStatus("error");
      return;
    }
    setResult({
      stampCount: r.stampCount ?? 0,
      beansBalance: r.beansBalance ?? 0,
      hash: r.hash,
    });
    setStatus("done");
  };

  const reset = () => {
    setStatus("idle");
    setError(null);
    setResult(null);
  };

  const handleScanResult = (text: string) => {
    const parsed = parseStampRequestQR(text);
    if (!parsed.ok) {
      setScanning(false);
      setScanNotice(
        PARSE_REASON_LABEL[parsed.reason] ?? "QR の読み取りに失敗しました。",
      );
      return;
    }
    const verified = verifyStampRequestQR(parsed.payload, {
      seenNonces: seenNoncesRef.current,
    });
    if (!verified.ok) {
      setScanning(false);
      setScanNotice(VERIFY_REASON_LABEL[verified.reason]);
      return;
    }
    setScanning(false);
    setScanNotice(null);
    setCustomerSA(verified.sa);
  };

  return (
    <div style={{ padding: "0 4px", maxWidth: 480, margin: "0 auto" }}>
      {scanning && (
        <QRScanner
          onResult={handleScanResult}
          onCancel={() => setScanning(false)}
        />
      )}
      {(status === "idle" || status === "error") && (
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
            STAMP ISSUE · {venueName}
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
            スタンプ発行
          </h2>

          <p
            style={{
              fontSize: 14,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              maxWidth: 320,
              margin: "0 auto 24px",
            }}
          >
            顧客の Smart Account アドレスを入力（または QR
            スキャン）し、本部 Smart Account
            経由でオンチェーン発行します。
          </p>

          <input
            type="text"
            placeholder="顧客 SA (C...) ／ QR スキャン"
            value={customerSA}
            onChange={(e) => setCustomerSA(e.target.value)}
            autoFocus
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: 13,
              fontFamily: "var(--f-mono)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-elev)",
              color: "var(--ink)",
              boxSizing: "border-box",
              outline: "none",
              marginBottom: 8,
            }}
          />
          <button
            onClick={() => {
              setScanNotice(null);
              setScanning(true);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 600,
              background: "transparent",
              color: "var(--ink-2)",
              border: "1px solid var(--line)",
              borderRadius: 100,
              cursor: "pointer",
              fontFamily: "inherit",
              marginBottom: 12,
            }}
          >
            <IconScan size={16} />
            QR をスキャン
          </button>
          {scanNotice && (
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                color: "var(--warn, #c0392b)",
                textAlign: "left",
              }}
            >
              {scanNotice}
            </p>
          )}
          {DEMO_CUSTOMER_SA && (
            <button
              onClick={() => setCustomerSA(DEMO_CUSTOMER_SA)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--ink-3)",
                fontSize: 11.5,
                fontFamily: "var(--f-mono)",
                cursor: "pointer",
                marginBottom: 20,
              }}
            >
              既定の顧客 SA を入力
            </button>
          )}

          <button
            onClick={handleIssue}
            style={{
              display: "block",
              width: "100%",
              padding: "16px 32px",
              fontSize: 16,
              fontWeight: 600,
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "none",
              borderRadius: 100,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.02em",
              marginTop: 4,
            }}
          >
            スタンプを発行（オンチェーン）
          </button>

          {status === "error" && error && (
            <p
              style={{
                marginTop: 18,
                fontSize: 12.5,
                color: "var(--bad, #c0392b)",
                lineHeight: 1.5,
                wordBreak: "break-word",
                textAlign: "left",
              }}
            >
              {error}
            </p>
          )}
        </div>
      )}

      {status === "issuing" && (
        <div style={{ textAlign: "center", paddingTop: 64 }}>
          <CupGlyph size={40} color="var(--accent)" />
          <p
            style={{
              marginTop: 18,
              fontSize: 14,
              color: "var(--ink-2)",
            }}
          >
            本部 Smart Account
            でスタンプ発行トランザクションを署名・送信中...
          </p>
        </div>
      )}

      {status === "done" && result && (
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
            発行完了
          </h3>
          <p
            style={{
              fontSize: 14,
              color: "var(--ink-2)",
              marginBottom: 6,
            }}
          >
            通算スタンプ: <strong>{result.stampCount}</strong> ・ beans 残高:{" "}
            <strong>{result.beansBalance}</strong>
          </p>
          {result.hash && (
            <p
              style={{
                fontSize: 11,
                fontFamily: "var(--f-mono)",
                color: "var(--ink-4)",
                wordBreak: "break-all",
                margin: "0 auto 20px",
                maxWidth: 360,
              }}
            >
              tx {result.hash}
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
            続けて発行
          </button>
        </div>
      )}
    </div>
  );
}

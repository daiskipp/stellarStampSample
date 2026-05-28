import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";

interface QRScannerProps {
  onResult: (text: string) => void;
  onCancel: () => void;
}

// Mounts a fullscreen camera preview that runs ZXing on each frame. The first
// successful decode is reported to the parent (which is in charge of deciding
// whether to dismiss this component). The video stream is torn down on unmount
// or when the scanner is explicitly stopped, so the camera light goes off.
export function QRScanner({ onResult, onCancel }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const firedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserQRCodeReader();
    let cancelled = false;

    (async () => {
      try {
        if (!videoRef.current) return;
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, err) => {
            if (firedRef.current) return;
            if (result) {
              firedRef.current = true;
              const text = result.getText();
              controls.stop();
              onResult(text);
            } else if (err && err.name !== "NotFoundException") {
              // NotFoundException fires every frame the QR is absent — ignore.
              setError(err.message || String(err));
            }
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [onResult]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.92)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#fff",
        }}
      >
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.7,
          }}
        >
          QR を読み取り
        </span>
        <button
          onClick={onCancel}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.4)",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: 100,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          閉じる
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 360,
            aspectRatio: "1 / 1",
            borderRadius: 16,
            overflow: "hidden",
            background: "#000",
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 18,
              border: "2px solid rgba(255,255,255,0.7)",
              borderRadius: 12,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>

      <div
        style={{
          padding: "12px 24px 28px",
          color: "rgba(255,255,255,0.85)",
          textAlign: "center",
          fontSize: 12.5,
          lineHeight: 1.5,
        }}
      >
        {error ? (
          <span style={{ color: "#ff9a9a" }}>{error}</span>
        ) : (
          <>顧客アプリの会員 QR を枠内に収めてください。</>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
export default function BarcodeCamera({
  enabled,
  onRead,
  onClose,
  paused = false,
}) {
  const video = useRef(null),
    callback = useRef(onRead),
    pause = useRef(paused),
    [error, setError] = useState("");
  useEffect(() => {
    callback.current = onRead;
    pause.current = paused;
  }, [onRead, paused]);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false,
      controls,
      reader,
      lastCode = "",
      lastSeen = 0,
      armed = true;
    const stop = () => {
      controls?.stop();
      const stream = video.current?.srcObject;
      stream?.getTracks?.().forEach((t) => t.stop());
    };
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error(
            "La fotocamera richiede HTTPS e un dispositivo compatibile. Puoi usare il lettore barcode o l’inserimento manuale.",
          );
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        setError("");
        reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 180,
          delayBetweenScanSuccess: 250,
        });
        controls = await reader.decodeFromVideoDevice(
          undefined,
          video.current,
          (result) => {
            if (cancelled) return;
            const now = Date.now();
            if (!result) {
              if (now - lastSeen > 900) armed = true;
              return;
            }
            const code = result.getText();
            if (code !== lastCode) armed = true;
            lastSeen = now;
            lastCode = code;
            if (!armed || pause.current) return;
            armed = false;
            void callback.current(code);
          },
        );
        if (cancelled) stop();
      } catch (e) {
        if (!cancelled)
          setError(
            e.name === "NotAllowedError"
              ? "Accesso alla fotocamera negato. Abilitalo nelle impostazioni del browser oppure usa il campo barcode."
              : e.message,
          );
      }
    }
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]);
  if (!enabled) return null;
  return (
    <section className="op-camera" aria-label="Lettore barcode con fotocamera">
      <div className="op-toolbar">
        <strong>Inquadra il barcode del prodotto</strong>
        <button type="button" onClick={onClose}>
          Chiudi fotocamera
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="Anteprima fotocamera"
          />
          <p>
            Allontana il barcode dall’inquadratura prima di leggere un altro
            pezzo uguale. Ogni lettura accettata compare nel riepilogo.
          </p>
        </>
      )}
    </section>
  );
}

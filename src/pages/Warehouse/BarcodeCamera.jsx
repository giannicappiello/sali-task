import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFrameDecoder, cameraErrorMessage } from "./barcodeFrame.js";

function CameraSession({ onRead, onClose, paused, contextLabel, deviceId, devices, onDevices, onDevice, onRestart }) {
  const dialog = useRef(null), video = useRef(null), decode = useRef(null), cooldownTimer = useRef(null);
  const state = useRef({onRead, onClose, paused, busy:false, auto:false, cancelled:false, nextAllowedAt:0});
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [cooling, setCooling] = useState(false);
  const [automatic, setAutomatic] = useState(false), [message, setMessage] = useState("Avvio fotocamera…"), [error, setError] = useState("");
  const titleId = useId();
  useEffect(() => { Object.assign(state.current, {onRead, onClose, paused}); }, [onRead, onClose, paused]);

  async function capture(manual = true) {
    const current = state.current;
    if (current.cancelled || current.busy || current.paused || Date.now() < current.nextAllowedAt || !decode.current) return;
    current.busy = true; setBusy(true);
    try {
      const code = decode.current(video.current);
      if (!code) {
        if (manual) { setError("Barcode o QR non riconosciuto. Avvicina l'etichetta, migliora la luce e riprova."); setMessage(""); }
        return;
      }
      current.nextAllowedAt = Date.now() + 900;
      setCooling(true); clearTimeout(cooldownTimer.current);
      cooldownTimer.current = setTimeout(() => { if (!current.cancelled) setCooling(false); }, 900);
      current.auto = false; setAutomatic(false); setError(""); setMessage("Verifica del prodotto in corso…");
      const result = await current.onRead(code);
      if (current.cancelled) return;
      if (result?.error) { setError(result.error + ((!result.status || result.status >= 500) ? " Chiudi la fotocamera e usa Verifica / riprova prima di ripetere la lettura." : "")); setMessage(""); }
      else if (result?.scan) {
        const scan = result.scan;
        const text = `${scan.code}: ${scan.quantity === 1 ? "aggiunto" : "aggiunti"} ${scan.quantity} ${scan.quantity === 1 ? "pezzo" : "pezzi"}.`;
        if (scan.wrong) { setError(`PRODOTTO NON PREVISTO NELL'ORDINE. ${text} Annulla la lettura dal riepilogo se inserita per errore.`); setMessage(""); }
        else setMessage(text + " Premi Leggi per il prossimo prodotto.");
      } else if (!result?.requiresCartonPieces) { setError("Lettura non confermata: controlla l'esito prima di riprovare."); setMessage(""); }
    } catch (failure) {
      if (!current.cancelled) { current.auto = false; setAutomatic(false); setError(cameraErrorMessage(failure)); setMessage(""); }
    } finally {
      if (!current.cancelled) { setBusy(false); }
      current.busy = false;
    }
  }

  useEffect(() => {
    const current = state.current, target = video.current, popup = dialog.current, opener = document.activeElement;
    let stream, timer, cancelled = false;
    current.cancelled = false;
    const stopStream = () => { stream?.getTracks().forEach(track => track.stop()); if (target) target.srcObject = null; };
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("La fotocamera richiede HTTPS e un browser compatibile. Puoi usare il campo manuale.");
        const {BrowserMultiFormatReader} = await import("@zxing/browser");
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({audio:false,video:{
          ...(deviceId ? {deviceId:{exact:deviceId}} : {facingMode:{ideal:"environment"}}),
          width:{ideal:1280,max:1920},height:{ideal:720,max:1080},
        }});
        if (cancelled) {stopStream();return;}
        target.srcObject = stream;
        await target.play();
        if (cancelled) {stopStream();return;}
        const track = stream.getVideoTracks()[0];
        track.onended = () => { if (!cancelled) { current.auto = false; decode.current = null; setAutomatic(false); setReady(false); setError("La fotocamera si è interrotta. Premi Riprova fotocamera."); } };
        const capabilities = track.getCapabilities?.() || {};
        if (capabilities.focusMode?.includes("continuous")) void track.applyConstraints({advanced:[{focusMode:"continuous"}]}).catch(() => {});
        decode.current = createFrameDecoder(new BrowserMultiFormatReader());
        setReady(true); setError(""); setMessage("Inquadra il barcode o il QR e premi Leggi barcode / QR.");
        void navigator.mediaDevices.enumerateDevices?.().then(items => { if (!cancelled) onDevices(items.filter(item => item.kind === "videoinput")); }).catch(() => {});
        const loop = async () => {
          if (cancelled) return;
          if (current.auto && !current.paused && !current.busy) await capture(false);
          if (!cancelled) timer = setTimeout(loop, 400);
        };
        timer = setTimeout(loop, 400);
      } catch(failure) {
        stopStream();
        if (!cancelled) { setReady(false); setError(cameraErrorMessage(failure)); setMessage(""); }
      }
    };
    if (popup.showModal) popup.showModal(); else popup.setAttribute("open", "");
    void start();
    return () => {cancelled=true;current.cancelled=true;current.auto=false;decode.current=null;clearTimeout(timer);clearTimeout(cooldownTimer.current);stopStream();popup.close?.(); if (opener?.isConnected) opener.focus?.({preventScroll:true});};
    // Each session owns one camera stream; restarting mounts a fresh session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(<dialog ref={dialog} className="op-camera-dialog" aria-labelledby={titleId}
    onCancel={event => {event.preventDefault(); if (!state.current.busy) onClose();}}>
    <div className="op-camera-shell">
      <header className="op-camera-header"><div><h2 id={titleId}>Lettore barcode e QR</h2><p>{contextLabel}</p></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Chiudi fotocamera">Chiudi</button></header>
      <video ref={video} autoPlay muted playsInline aria-label="Anteprima fotocamera" />
      {devices.length > 1 && <label>Fotocamera<select value={deviceId} disabled={busy} onChange={event => onDevice(event.target.value)}>
        <option value="">Posteriore automatica</option>{devices.map((device,index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Fotocamera ${index+1}`}</option>)}</select></label>}
      <p className="op-camera-help">Inquadra l'etichetta completa. Sono accettati barcode, QR con codice IT e QR con URL del prodotto.</p>
      {error && <p className="op-camera-error" role="alert">{error}</p>}
      {message && <p className="op-camera-message" role="status">{message}</p>}
      {paused && <p role="status">Attendi la conferma della lettura in corso prima di acquisire un altro prodotto.</p>}
      <div className="op-camera-actions"><button type="button" className="op-camera-read" disabled={!ready || busy || cooling || paused} onClick={() => void capture(true)}>{busy ? "Lettura in corso…" : "Leggi barcode / QR"}</button>
        <button type="button" disabled={busy} onClick={onRestart}>Riprova fotocamera</button></div>
      <label className="op-camera-auto"><input type="checkbox" checked={automatic} disabled={!ready || busy || paused} onChange={event => {state.current.auto=event.target.checked;setAutomatic(event.target.checked);}}/>Leggi automaticamente il prossimo codice (una acquisizione)</label>
    </div>
  </dialog>, document.body);
}

export default function BarcodeCamera({enabled,onRead,onClose,paused=false,contextLabel=""}) {
  const [attempt,setAttempt] = useState(0),[deviceId,setDeviceId] = useState(""),[devices,setDevices] = useState([]);
  if (!enabled) return null;
  return <CameraSession key={`${attempt}:${deviceId}`} onRead={onRead} onClose={onClose} paused={paused} contextLabel={contextLabel}
    deviceId={deviceId} devices={devices} onDevices={setDevices} onDevice={setDeviceId} onRestart={() => setAttempt(n=>n+1)}/>;
}

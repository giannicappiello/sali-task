import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFrameDecoder, cameraErrorMessage } from "./barcodeFrame.js";
import { cameraVideoConstraints, cameraCapabilities, numericCameraRange, configureCameraFocus, preferredRearCamera } from "./cameraSettings.js";

function CameraSession({ onRead, onClose, paused, contextLabel, deviceId, devices, onDevices, onDevice, onRestart }) {
  const dialog = useRef(null), video = useRef(null), decode = useRef(null), cooldownTimer = useRef(null), activeTrack = useRef(null);
  const state = useRef({onRead, onClose, paused, busy:false, auto:false, cancelled:false, nextAllowedAt:0});
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [cooling, setCooling] = useState(false);
  const [automatic, setAutomatic] = useState(false), [message, setMessage] = useState("Avvio fotocamera…"), [error, setError] = useState("");
  const [controls,setControls] = useState({}), [settings,setSettings] = useState({}), [adjusting,setAdjusting] = useState(false);
  const titleId = useId();
  useEffect(() => { Object.assign(state.current, {onRead, onClose, paused}); }, [onRead, onClose, paused]);

  async function adjustCamera(constraints) {
    if (!activeTrack.current || state.current.busy || state.current.adjusting) return;
    const track = activeTrack.current;
    state.current.adjusting = true; setAdjusting(true);
    try {
      await track.applyConstraints({advanced:[constraints]});
      if (!state.current.cancelled) { setSettings({...track.getSettings?.(),label:track.label}); setError(""); }
    } catch { if (!state.current.cancelled) setError("Questo controllo non è disponibile sulla lente selezionata. Prova un'altra fotocamera o Scatta / carica foto."); }
    finally { state.current.adjusting=false; if (!state.current.cancelled) setAdjusting(false); }
  }

  async function refocus() {
    if (!activeTrack.current || state.current.adjusting || state.current.busy) return;
    const track = activeTrack.current;
    state.current.adjusting=true; setAdjusting(true);
    const applied = await configureCameraFocus(track);
    if (!state.current.cancelled) {
      setAdjusting(false); setSettings({...track.getSettings?.(),label:track.label});
      setMessage(applied ? "Autofocus richiesto. Tieni il telefono fermo e attendi che le barre siano nitide prima di leggere." : "Questa lente non espone l'autofocus al browser. Cambia fotocamera oppure usa Scatta / carica foto.");
    }
    state.current.adjusting=false;
  }

  async function capture(manual = true, file = null) {
    const current = state.current;
    if (current.cancelled || current.busy || current.adjusting || current.paused || Date.now() < current.nextAllowedAt || (!decode.current && !file)) return;
    current.busy = true; setBusy(true);
    try {
      let code;
      if (file) {
        const url = URL.createObjectURL(file);
        try {
          const image = new Image(); image.src = url; await image.decode();
          if (current.cancelled) return;
          const {BrowserMultiFormatReader} = await import("@zxing/browser");
          if (current.cancelled) return;
          code = createFrameDecoder(new BrowserMultiFormatReader())(image);
        } finally { URL.revokeObjectURL(url); }
      } else {
        // A short acquisition window lets Samsung's autofocus settle rather
        // than committing to a single blurry frame at the moment of the tap.
        const deadline = Date.now() + (manual ? 1800 : 0);
        do {
          if (current.cancelled) return;
          code = decode.current(video.current);
          if (code || Date.now() >= deadline) break;
          await new Promise(resolve => setTimeout(resolve, 180));
        } while (!current.cancelled);
      }
      if (!code) {
        if (manual) { setError("Barcode o QR non riconosciuto. Allontana un poco il prodotto: a distanza troppo ravvicinata il fuoco può non riuscire. Tieni ferma l'etichetta completa, regola luce/zoom o usa Scatta / carica foto."); setMessage(""); }
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
        stream = await navigator.mediaDevices.getUserMedia({audio:false,video:cameraVideoConstraints(deviceId)});
        if (cancelled) {stopStream();return;}
        let items = [];
        try { items = await navigator.mediaDevices.enumerateDevices(); } catch { /* Camera remains usable without a device list. */ }
        if (cancelled) {stopStream();return;}
        onDevices(items.filter(item => item.kind === "videoinput"));
        const initialTrack = stream.getVideoTracks()[0];
        const preferred = !deviceId && preferredRearCamera(items,initialTrack.getSettings?.().deviceId,initialTrack.label);
        if (preferred) {
          stopStream();
          try { stream = await navigator.mediaDevices.getUserMedia({audio:false,video:cameraVideoConstraints(preferred.deviceId)}); }
          catch { if (cancelled) return; stream = await navigator.mediaDevices.getUserMedia({audio:false,video:cameraVideoConstraints("")}); }
        }
        if (cancelled) {stopStream();return;}
        target.srcObject = stream;
        await target.play();
        if (cancelled) {stopStream();return;}
        const track = stream.getVideoTracks()[0];
        track.onended = () => { if (!cancelled) { current.auto = false; decode.current = null; setAutomatic(false); setReady(false); setError("La fotocamera si è interrotta. Premi Riprova fotocamera."); } };
        activeTrack.current = track;
        const capabilities = cameraCapabilities(track);
        const focused = await configureCameraFocus(track);
        if (cancelled) {stopStream();return;}
        setControls(capabilities); setSettings({...track.getSettings?.(),label:track.label});
        decode.current = createFrameDecoder(new BrowserMultiFormatReader());
        setReady(true); setError(""); setMessage(focused ? "Autofocus attivo. Tieni il prodotto a circa 15–30 cm e premi Leggi barcode / QR quando le barre sono nitide." : "Questa lente non espone l’autofocus. Cambia fotocamera o usa Scatta / carica foto se il codice è sfocato.");
        const loop = async () => {
          if (cancelled) return;
          if (current.auto && !current.paused && !current.busy && !current.adjusting) await capture(false);
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
    return () => {cancelled=true;current.cancelled=true;current.auto=false;decode.current=null;activeTrack.current=null;clearTimeout(timer);clearTimeout(cooldownTimer.current);stopStream();popup.close?.(); if (opener?.isConnected) opener.focus?.({preventScroll:true});};
    // Each session owns one camera stream; restarting mounts a fresh session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(<dialog ref={dialog} className="op-camera-dialog" aria-labelledby={titleId}
    onCancel={event => {event.preventDefault(); if (!state.current.busy) onClose();}}>
    <div className="op-camera-shell">
      <header className="op-camera-header"><div><h2 id={titleId}>Lettore barcode e QR</h2><p>{contextLabel}</p></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Chiudi fotocamera">Chiudi</button></header>
      <video ref={video} autoPlay muted playsInline aria-label="Anteprima fotocamera" />
      {devices.length > 1 && <label>Fotocamera<select value={deviceId} disabled={busy || adjusting} onChange={event => onDevice(event.target.value)}>
        <option value="">Posteriore automatica</option>{devices.map((device,index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Fotocamera ${index+1}`}</option>)}</select></label>}
      <p className="op-camera-help">Tieni l'etichetta intera a circa 15–30 cm. Se si sfoca avvicinandola, allontanala e usa lo zoom disponibile. Sono accettati barcode e QR con codice IT o URL.</p>
      {ready && <p className="op-camera-help">{settings.label || "Fotocamera selezionata"}{settings.width ? ` · ${settings.width} × ${settings.height}` : ""}</p>}
      {ready && <div className="op-camera-controls">
        <button type="button" disabled={busy || adjusting} onClick={() => void refocus()}>Metti a fuoco</button>
        {controls.torch && <button type="button" disabled={busy || adjusting} onClick={() => void adjustCamera({torch:!settings.torch})}>{settings.torch ? "Spegni luce" : "Accendi luce"}</button>}
        {numericCameraRange(controls.zoom) && <label>Zoom<select aria-label="Zoom fotocamera" value={settings.zoom ?? controls.zoom.min} disabled={busy || adjusting} onChange={event => void adjustCamera({zoom:Number(event.target.value)})}>
          {[...new Set([controls.zoom.min,settings.zoom,1,1.5,2,3,4].filter(n=>n>=controls.zoom.min && n<=controls.zoom.max))].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n}×</option>)}
        </select></label>}
        {controls.focusMode?.includes("manual") && numericCameraRange(controls.focusDistance) && <label>Fuoco manuale (se l'autofocus non riesce)<input type="range" aria-label="Distanza messa a fuoco" {...numericCameraRange(controls.focusDistance)} value={settings.focusDistance ?? controls.focusDistance.min} disabled={busy || adjusting} onChange={event => void adjustCamera({focusMode:"manual",focusDistance:Number(event.target.value)})}/></label>}
      </div>}
      {error && <p className="op-camera-error" role="alert">{error}</p>}
      {message && <p className="op-camera-message" role="status">{message}</p>}
      {paused && <p role="status">Attendi la conferma della lettura in corso prima di acquisire un altro prodotto.</p>}
      <div className="op-camera-actions"><button type="button" className="op-camera-read" disabled={!ready || busy || adjusting || cooling || paused} onClick={() => void capture(true)}>{busy ? "Lettura in corso…" : "Leggi barcode / QR"}</button>
        <button type="button" disabled={busy} onClick={onRestart}>Riprova fotocamera</button></div>
      <label className="op-camera-photo">Scatta / carica foto<input type="file" accept="image/*" capture="environment" disabled={busy || adjusting || cooling || paused} onClick={() => {state.current.auto=false;setAutomatic(false);}} onChange={event => {const file=event.target.files?.[0];event.target.value="";if(file) void capture(true,file);}}/></label>
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

import PreparationProductPrompt from "./PreparationProductPrompt.jsx";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cameraErrorMessage } from "./barcodeFrame.js";
import { createCameraDecoder } from "./cameraDecoder.js";
import {
  createScanCandidate,
  createNextScanGate,
} from "./barcodeWorkerCore.js";
import {
  openBarcodeCamera,
  configureCameraFocus,
  focusPointInPreview,
} from "./cameraSettings.js";

function CameraSession({ onRead, onResolve, onClose, paused, onRestart, contextLabel,
  mode="piece",onModeChange,pallets=[],activePallet,onPalletChange,packages=[],activePackage,onPackageChange,onNewPallet,onNewPackage,cartonPrompt,cartonPieces,onCartonPieces,unitWeight,onUnitWeight,onSaveCarton,onCancelCarton }) {
  const dialog = useRef(null),
    video = useRef(null),
    decoder = useRef(null),
    track = useRef(null);
  const state = useRef({
    onRead,
    onResolve,
    paused,
    busy: false,
    cancelled: false,
    nextAllowedAt: 0,
    captured: null,
  });
  const focusGeneration = useRef(0),
    focusTimers = useRef([]),
    candidate = useRef(createScanCandidate()),
    releaseGate = useRef(createNextScanGate());
  const [ready, setReady] = useState(false),
    [starting, setStarting] = useState(true),
    [busy, setBusy] = useState(false),
    [cooling, setCooling] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [focusPoint, setFocusPoint] = useState(null);
  const [captured, setCaptured] = useState(null),[product,setProduct]=useState(null),[resolving,setResolving]=useState(false),[manual,setManual]=useState("");
  const resolveVersion=useRef(0);
  const titleId = useId();
  async function holdCode(code) {
    const version=++resolveVersion.current;
    state.current.captured=code;state.current.product=null;
    state.current.resolving=!!code;setCaptured(code);setProduct(null);setResolving(!!code);
    if(!code)return;
    setError("");setMessage("");
    try{
      const result=await state.current.onResolve(code);
      if(state.current.cancelled || version!==resolveVersion.current)return;
      if(!result?.code)throw Error("Prodotto non trovato. Verifica il barcode o inserisci il codice IT.");
      state.current.product=result;setProduct(result);
    }catch(failure){if(!state.current.cancelled && version===resolveVersion.current)setError(failure.message || "Impossibile identificare il prodotto.");}
    finally{if(!state.current.cancelled && version===resolveVersion.current){state.current.resolving=false;setResolving(false);}}
  }
  function resetCode() {
    releaseGate.current.reset();candidate.current.clear();void holdCode(null);setError("");setMessage("");
  }
  useEffect(()=>{Object.assign(state.current,{onRead,onResolve,paused});},[onRead,onResolve,paused]);

  async function focusAt(point) {
    const selectedTrack = track.current;
    if (!selectedTrack || state.current.busy || state.current.cancelled || cartonPrompt) return;
    resetCode();
    const generation = ++focusGeneration.current;
    // No capture can start halfway through an explicit touch-focus request.
    state.current.focusUntil = Date.now() + 500;
    await configureCameraFocus(selectedTrack, point);
    if (state.current.cancelled || generation !== focusGeneration.current)
      return;
    focusTimers.current.push(
      setTimeout(() => {
        if (
          !state.current.cancelled &&
          generation === focusGeneration.current
        ) {
          void configureCameraFocus(selectedTrack);
          setFocusPoint(null);
        }
      }, 700),
    );
  }

  function touchFocus(event) {
    const target = video.current,
      rect = target.getBoundingClientRect();
    const point = focusPointInPreview(
      event.clientX,
      event.clientY,
      rect,
      target.videoWidth,
      target.videoHeight,
    );
    if (!point) return;
    setFocusPoint({
      left: event.clientX - rect.left,
      top: event.clientY - rect.top,
    });
    void focusAt(point);
  }

  function finishResult(result,code){
    if (result?.error)
        setError(
          result.error +
            (!result.status || result.status >= 500
              ? " Chiudi e usa Verifica / riprova."
              : ""),
        );
      else if (result?.scan) {
        const scan = result.scan;
        releaseGate.current.confirm(code);
        holdCode(null);
        if (scan.wrong)
          setError(
            `Prodotto non previsto: ${scan.code}. Annulla la lettura dal riepilogo.`,
          );
        else {
          setMessage(
            `${scan.code}: +${scan.quantity} ${scan.quantity === 1 ? "pezzo" : "pezzi"}`,
          );
        }
      } else if (!result?.requiresCartonPieces && !result?.requiresProductWeight)
        setError("Lettura non confermata: controlla il riepilogo.");
  }
  async function saveCarton(){
    if(state.current.busy || paused)return;
    state.current.busy=true;setBusy(true);
    try{const result=await onSaveCarton();if(!state.current.cancelled)finishResult(result,state.current.captured);}
    finally{state.current.busy=false;if(!state.current.cancelled)setBusy(false);}
  }

  async function capture() {
    const current = state.current;
    if (!ready && !current.captured) {
      if (!starting) onRestart();
      return;
    }
    if (
      current.cancelled ||
      current.busy ||
      current.paused || current.resolving || (current.captured && !current.product) ||
      Date.now() < current.nextAllowedAt ||
      (!decoder.current && !current.captured)
    )
      return;
    current.busy = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let code = current.captured || candidate.current.take();
      const confirming = !!current.captured;
      const deadline = Date.now() + 3000;
      do {
        if (current.cancelled) return;
        if (
          !code &&
          Date.now() >= (current.focusUntil || 0) &&
          !current.decoding
        ) {
          current.decoding = true;
          try {
            code = await decoder.current(video.current);
          } finally {
            current.decoding = false;
          }
        }
        if (!code) code = candidate.current.take();
        if (current.cancelled) return;
        if (code || Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 120));
      } while (!current.cancelled);
      if (!code) {
        setError("Codice non letto. Tocca il codice nell’immagine e riprova.");
        return;
      }
      if (!confirming) {
        holdCode(code);
        return;
      }
      candidate.current.clear();
      current.nextAllowedAt = Date.now() + 900;
      setCooling(true);
      focusTimers.current.push(
        setTimeout(() => {
          if (!current.cancelled) setCooling(false);
        }, 900),
      );
      const result = await current.onRead(code);
      if (current.cancelled) return;
      finishResult(result,code);
    } catch (failure) {
      if (!current.cancelled) setError(cameraErrorMessage(failure));
    } finally {
      current.busy = false;
      if (!current.cancelled) setBusy(false);
    }
  }

  useEffect(() => {
    const current = state.current,
      target = video.current,
      popup = dialog.current,
      opener = document.activeElement;
    let stream,
      cancelled = false,
      previewTimer,
      read;
    const readerAbort = new AbortController(),
      scanCandidate = candidate.current,
      nextScanGate = releaseGate.current;
    current.cancelled = false;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const stop = () => {
      stream?.getTracks().forEach((item) => item.stop());
      target.srcObject = null;
    };
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw Error(
            "Fotocamera non disponibile. Usa HTTPS e consenti l’accesso alla fotocamera.",
          );
        if (cancelled) return;
        stream = await openBarcodeCamera(
          navigator.mediaDevices,
          () => cancelled,
        );
        if (cancelled || !stream) {
          stop();
          return;
        }
        target.srcObject = stream;
        await target.play();
        if (cancelled) {
          stop();
          return;
        }
        const selectedTrack = stream.getVideoTracks()[0];
        track.current = selectedTrack;
        selectedTrack.onended = () => {
          if (!cancelled) {
            decoder.current = null;
            setReady(false);
            setError("Fotocamera interrotta. Premi Acquisisci per riprovare.");
          }
        };
        await configureCameraFocus(selectedTrack);
        if (cancelled) {
          stop();
          return;
        }
        read = await createCameraDecoder({ signal: readerAbort.signal });
        if (cancelled) {
          read.dispose();
          stop();
          return;
        }
        decoder.current = read;
        setReady(true);
        setError("");
        async function preview() {
          if (cancelled) return;
          if (
            !current.captured && !current.manualEditing && !current.resolving &&
            !current.busy &&
            !current.paused &&
            !current.decoding &&
            Date.now() >= (current.focusUntil || 0)
          ) {
            current.decoding = true;
            try {
              const code = await read(target);
              if (!cancelled && !current.busy && !current.captured) {
                const accepted = nextScanGate.observe(code);
                scanCandidate.update(accepted);
                if (accepted) holdCode(accepted);
              }
            } catch (failure) {
              if (!cancelled) {
                setError(cameraErrorMessage(failure));
                setReady(false);
                read.dispose();
                return;
              }
            } finally {
              current.decoding = false;
            }
          }
          if (!cancelled) previewTimer = setTimeout(preview, 180);
        }
        void preview();
      } catch (failure) {
        stop();
        if (!cancelled) setError(cameraErrorMessage(failure));
      } finally {
        if (!cancelled) setStarting(false);
      }
    }
    popup.showModal ? popup.showModal() : popup.setAttribute("open", "");
    void start();
    return () => {
      cancelled = true;
      current.cancelled = true;
      clearTimeout(previewTimer);
      readerAbort.abort();
      read?.dispose();
      scanCandidate.clear();
      decoder.current = null;
      track.current = null;
      focusTimers.current.forEach(clearTimeout);
      focusTimers.current = [];
      stop();
      popup.close?.();
      document.documentElement.style.overflow = previousOverflow;
      opener?.isConnected && opener.focus?.({ preventScroll: true });
    };
    // Each mounted session owns its camera and asynchronous work.
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="op-camera-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!state.current.busy) onClose();
      }}
    >
      <div className="op-camera-shell">
        <header className="op-camera-header">
          <div>
            <h2 id={titleId}>Fotocamera</h2>
            {contextLabel && (
              <p className="op-camera-context">{contextLabel}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Chiudi fotocamera"
            disabled={busy}
            onClick={onClose}
          >
            Chiudi
          </button>
        </header>
        <div className="op-camera-stage">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            role="button"
            tabIndex={0}
            aria-label="Tocca il codice per mettere a fuoco"
            onPointerUp={touchFocus}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void focusAt({ x: 0.5, y: 0.5 });
              }
            }}
          />
          {focusPoint && (
            <span
              className="op-camera-focus-point"
              style={focusPoint}
              aria-hidden="true"
            />
          )}
        </div>
        <footer className="op-camera-footer">
          <div className="op-camera-tools">
            <div className="op-camera-selectors">
              <label>Pezzi / cartoni<select aria-label="Modalità scansione" value={mode} disabled={busy || paused || !!cartonPrompt} onChange={event=>onModeChange(event.target.value)}><option value="piece">Pezzi</option><option value="carton">Cartoni</option></select></label>
              <label><span>Bancale <button type="button" aria-label="Nuovo bancale dalla fotocamera" disabled={busy || paused || !!cartonPrompt} onClick={()=>void onNewPallet()}>+</button></span><select aria-label="Bancale attivo" value={activePallet} disabled={busy || paused || !!cartonPrompt} onChange={event=>onPalletChange(event.target.value)}>{pallets.map(item=><option key={item.id} value={item.id}>{item.number}</option>)}</select></label>
              <label><span>Collo <button type="button" aria-label="Nuovo collo dalla fotocamera" disabled={busy || paused || !activePallet || !!cartonPrompt} onClick={()=>onNewPackage()}>+</button></span><select aria-label="Collo attivo" value={activePackage} disabled={busy || paused || !!cartonPrompt} onChange={event=>onPackageChange(event.target.value)}>{packages.map(item=><option key={item.id} value={item.id}>{item.number}</option>)}</select></label>
            </div>
            <form className="op-camera-manual" onSubmit={event=>{event.preventDefault();if(!manual.trim() || busy || paused || cartonPrompt)return;state.current.manualEditing=false;void holdCode(manual.trim());setManual("");}}>
              <input aria-label="Barcode o codice articolo IT" placeholder="Barcode o codice IT" autoComplete="off" maxLength={100} value={manual} disabled={busy || paused || !!cartonPrompt} onChange={event=>{state.current.manualEditing=!!event.target.value;resetCode();setManual(event.target.value);}}/>
              <button type="submit" disabled={!manual.trim() || busy || paused || !!cartonPrompt}>Cerca</button>
            </form>
            {captured && <div className="op-camera-confirmation">
              <div className="op-camera-product" role="status">{resolving ? "Ricerca prodotto…" : product ? <><strong>{product.code} · {product.description}</strong><small>{mode==="piece" ? "1 pezzo" : product.piecesPerCarton ? `${product.piecesPerCarton} pezzi per cartone` : "Pezzi per cartone da compilare nel capitolato"}</small>{product.wrong && <small className="op-bad">Prodotto non previsto nell’ordine</small>}</> : "Prodotto non identificato"}</div>
              <button type="button" disabled={busy || paused || !!cartonPrompt} onClick={resetCode}>Rileggi</button>
            </div>}
            {cartonPrompt && <PreparationProductPrompt prompt={cartonPrompt} pieces={cartonPieces} onPieces={onCartonPieces} weight={unitWeight} onWeight={onUnitWeight} busy={busy || paused} onCancel={onCancelCarton} onSave={saveCarton}/>}
          {error && (
            <p className="op-camera-error" role="alert">
              {error}
            </p>
          )}
          {message && !error && (
            <p className="op-camera-message" role="status">
              {message}
            </p>
          )}
          </div>
          <button
            type="button"
            className="op-camera-read"
            disabled={(!captured && starting) || busy || cooling || paused || resolving || (captured && !product) || !activePackage || !activePallet || !!cartonPrompt}
            onClick={() => void capture()}
            aria-busy={busy || starting}
          >
            {captured ? "Conferma e scansiona successivo" : "Acquisisci"}
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}

export default function BarcodeCamera({
  enabled,
  onRead,
  onClose,
  paused = false,
  contextLabel = "",
  ...controls
}) {
  const [attempt, setAttempt] = useState(0);
  if (!enabled) return null;
  return (
    <CameraSession
      key={attempt}
      {...controls}
      onRead={onRead}
      onClose={onClose}
      paused={paused}
      contextLabel={contextLabel}
      onRestart={() => setAttempt((n) => n + 1)}
    />
  );
}

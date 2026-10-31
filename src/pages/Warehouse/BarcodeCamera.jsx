import {useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {cameraErrorMessage} from "./barcodeFrame.js";
import {createCameraDecoder} from "./cameraDecoder.js";
import {createScanCandidate} from "./barcodeWorkerCore.js";
import {openBarcodeCamera,configureCameraFocus,focusPointInPreview} from "./cameraSettings.js";

function CameraSession({onRead,onClose,paused,onRestart}) {
  const dialog=useRef(null),video=useRef(null),decoder=useRef(null),track=useRef(null);
  const state=useRef({onRead,paused,busy:false,cancelled:false,nextAllowedAt:0});
  const focusGeneration=useRef(0),focusTimers=useRef([]),candidate=useRef(createScanCandidate());
  const [ready,setReady]=useState(false),[starting,setStarting]=useState(true),[busy,setBusy]=useState(false),[cooling,setCooling]=useState(false);
  const [message,setMessage]=useState(""),[error,setError]=useState(""),[focusPoint,setFocusPoint]=useState(null);
  const titleId=useId();
  useEffect(()=>{Object.assign(state.current,{onRead,paused});},[onRead,paused]);

  async function focusAt(point) {
    const selectedTrack=track.current;
    if (!selectedTrack || state.current.busy || state.current.cancelled) return;
    candidate.current.clear();
    const generation=++focusGeneration.current;
    // No capture can start halfway through an explicit touch-focus request.
    state.current.focusUntil=Date.now()+500;
    await configureCameraFocus(selectedTrack,point);
    if (state.current.cancelled || generation!==focusGeneration.current) return;
    focusTimers.current.push(setTimeout(()=>{
      if (!state.current.cancelled && generation===focusGeneration.current) {
        void configureCameraFocus(selectedTrack);
        setFocusPoint(null);
      }
    },700));
  }

  function touchFocus(event) {
    const target=video.current,rect=target.getBoundingClientRect();
    const point=focusPointInPreview(event.clientX,event.clientY,rect,target.videoWidth,target.videoHeight);
    if (!point) return;
    setFocusPoint({left:event.clientX-rect.left,top:event.clientY-rect.top});
    void focusAt(point);
  }

  async function capture() {
    const current=state.current;
    if (!ready) {if(!starting) onRestart();return;}
    if (current.cancelled || current.busy || current.paused || Date.now()<current.nextAllowedAt || !decoder.current) return;
    current.busy=true;setBusy(true);setError("");setMessage("");
    try {
      let code=candidate.current.take();
      const deadline=Date.now()+3000;
      do {
        if(current.cancelled)return;
        if(!code && Date.now()>=(current.focusUntil || 0) && !current.decoding){
          current.decoding=true;
          try{code=await decoder.current(video.current);}finally{current.decoding=false;}
        }
        if(!code)code=candidate.current.take();
        if(current.cancelled)return;
        if(code || Date.now()>=deadline)break;
        await new Promise(resolve=>setTimeout(resolve,120));
      } while(!current.cancelled);
      if(!code){setError("Codice non letto. Tocca il codice nell’immagine e riprova.");return;}
      candidate.current.clear();current.nextAllowedAt=Date.now()+900;setCooling(true);
      focusTimers.current.push(setTimeout(()=>{if(!current.cancelled)setCooling(false);},900));
      const result=await current.onRead(code);
      if(current.cancelled)return;
      if(result?.error)setError(result.error + ((!result.status || result.status>=500) ? " Chiudi e usa Verifica / riprova." : ""));
      else if(result?.scan){
        const scan=result.scan;
        if(scan.wrong)setError(`Prodotto non previsto: ${scan.code}. Annulla la lettura dal riepilogo.`);
        else setMessage(`${scan.code}: +${scan.quantity} ${scan.quantity===1 ? "pezzo" : "pezzi"}`);
      } else if(!result?.requiresCartonPieces)setError("Lettura non confermata: controlla il riepilogo.");
    } catch(failure){if(!current.cancelled)setError(cameraErrorMessage(failure));}
    finally{current.busy=false;if(!current.cancelled)setBusy(false);}
  }

  useEffect(()=>{
    const current=state.current,target=video.current,popup=dialog.current,opener=document.activeElement;
    let stream,cancelled=false,previewTimer,read;
    const readerAbort=new AbortController(),scanCandidate=candidate.current;
    current.cancelled=false;
    const previousOverflow=document.documentElement.style.overflow;
    document.documentElement.style.overflow="hidden";
    const stop=()=>{stream?.getTracks().forEach(item=>item.stop());target.srcObject=null;};
    async function start(){
      try{
        if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)throw Error("Fotocamera non disponibile. Usa HTTPS e consenti l’accesso alla fotocamera.");
        if(cancelled)return;
        stream=await openBarcodeCamera(navigator.mediaDevices,()=>cancelled);
        if(cancelled || !stream){stop();return;}
        target.srcObject=stream;await target.play();
        if(cancelled){stop();return;}
        const selectedTrack=stream.getVideoTracks()[0];track.current=selectedTrack;
        selectedTrack.onended=()=>{if(!cancelled){decoder.current=null;setReady(false);setError("Fotocamera interrotta. Premi Acquisisci per riprovare.");}};
        await configureCameraFocus(selectedTrack);
        if(cancelled){stop();return;}
        read=await createCameraDecoder({signal:readerAbort.signal});
        if(cancelled){read.dispose();stop();return;}
        decoder.current=read;setReady(true);setError("");
        async function preview(){
          if(cancelled)return;
          if(!current.busy && !current.paused && !current.decoding && Date.now()>=(current.focusUntil || 0)){
            current.decoding=true;
            try{const code=await read(target);if(!cancelled)scanCandidate.update(code);}
            catch(failure){if(!cancelled){setError(cameraErrorMessage(failure));setReady(false);read.dispose();return;}}
            finally{current.decoding=false;}
          }
          if(!cancelled)previewTimer=setTimeout(preview,180);
        }
        void preview();
      }catch(failure){stop();if(!cancelled)setError(cameraErrorMessage(failure));}
      finally{if(!cancelled)setStarting(false);}
    }
    popup.showModal ? popup.showModal() : popup.setAttribute("open","");
    void start();
    return()=>{
      cancelled=true;current.cancelled=true;clearTimeout(previewTimer);readerAbort.abort();read?.dispose();scanCandidate.clear();decoder.current=null;track.current=null;
      focusTimers.current.forEach(clearTimeout);focusTimers.current=[];stop();popup.close?.();document.documentElement.style.overflow=previousOverflow;opener?.isConnected && opener.focus?.({preventScroll:true});
    };
    // Each mounted session owns its camera and asynchronous work.
  },[]);

  return createPortal(<dialog ref={dialog} className="op-camera-dialog" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!state.current.busy)onClose();}}>
    <div className="op-camera-shell">
      <header className="op-camera-header"><h2 id={titleId}>Fotocamera</h2><button type="button" aria-label="Chiudi fotocamera" disabled={busy} onClick={onClose}>Chiudi</button></header>
      <div className="op-camera-stage">
        <video ref={video} autoPlay muted playsInline role="button" tabIndex={0} aria-label="Tocca il codice per mettere a fuoco" onPointerUp={touchFocus} onKeyDown={event=>{if(event.key==="Enter" || event.key===" "){event.preventDefault();void focusAt({x:0.5,y:0.5});}}}/>
        {focusPoint && <span className="op-camera-focus-point" style={focusPoint} aria-hidden="true"/>}
      </div>
      <footer className="op-camera-footer">
        {error && <p className="op-camera-error" role="alert">{error}</p>}
        {message && !error && <p className="op-camera-message" role="status">{message}</p>}
        <button type="button" className="op-camera-read" disabled={starting || busy || cooling || paused} onClick={()=>void capture()} aria-busy={busy || starting}>Acquisisci</button>
      </footer>
    </div>
  </dialog>,document.body);
}

export default function BarcodeCamera({enabled,onRead,onClose,paused=false}) {
  const [attempt,setAttempt]=useState(0);
  if(!enabled)return null;
  return <CameraSession key={attempt} onRead={onRead} onClose={onClose} paused={paused} onRestart={()=>setAttempt(n=>n+1)}/>;
}

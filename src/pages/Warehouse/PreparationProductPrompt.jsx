import {useEffect,useRef} from "react";
export default function PreparationProductPrompt({prompt,pieces,onPieces,weight,onWeight,busy,onSave,onCancel,error="",modal=false}) {
  const dialog=useRef(null);
  useEffect(()=>{if(!modal)return;const element=dialog.current;element?.showModal();return ()=>element?.close();},[modal]);
  const form = <form className="op-camera-carton-prompt" onSubmit={event=>{event.preventDefault();void onSave();}}>
    <strong>Dati capitolato · {prompt.code}</strong>
    {prompt.needsPieces && <label>Pezzi per cartone<input aria-label="Pezzi per cartone" type="number" min="1" max="1000000" step="1" required value={pieces} onChange={event=>onPieces(event.target.value)} disabled={busy}/></label>}
    {prompt.needsWeight && <label>Peso Totale in grammi<input aria-label="Peso Totale in grammi" type="number" min="0.001" max="1000000" step="0.001" required value={weight} onChange={event=>onWeight(event.target.value)} disabled={busy}/><small>Peso di un prodotto completo, incluso il suo contenitore. Il valore viene salvato nel capitolato.</small></label>}
    {error && <p role="alert" className="op-error">{error}</p>}
    <div><button type="submit" disabled={busy || (prompt.needsPieces && !pieces) || (prompt.needsWeight && !weight)}>Salva e {prompt.operation==='verify'?'ripeti riscontro':prompt.operation==='preview_packing_list'?'visualizza packing list':'conferma lettura'}</button><button type="button" disabled={busy} onClick={onCancel}>Annulla</button></div>
  </form>;
  return modal ? <dialog className="op-spec-prompt-dialog" ref={dialog} aria-label={`Completa dati capitolato ${prompt.code}`} onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>{form}</dialog> : form;
}

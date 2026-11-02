import {useEffect,useRef,useState} from 'react';

export default function PreparationPackageRemoval({pack,quantity,busy,error,onRemove,onClose}) {
  const dialog=useRef(null),[reason,setReason]=useState('');
  useEffect(()=>{const element=dialog.current;element.showModal();return ()=>element.close();},[]);
  return <dialog ref={dialog} className="op-package-editor-dialog" aria-label={`Elimina collo ${pack.number}`} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <form className="op-panel" onSubmit={event=>{event.preventDefault();if(!busy && reason.trim().length>=3)void onRemove(reason);}}>
      <h2>Elimina collo {pack.number}</h2>
      <p>Verranno rimossi il collo e tutti i suoi {quantity} pezzi. Sarà necessario un nuovo riscontro. L’eliminazione resterà nello storico.</p>
      {error && <p role="alert" className="op-error">{error}</p>}
      <label>Motivo<textarea required minLength={3} maxLength={1000} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <div className="op-toolbar"><button type="button" disabled={busy} onClick={onClose}>Annulla</button><button type="submit" disabled={busy || reason.trim().length<3}>Elimina collo e contenuto</button></div>
    </form>
  </dialog>;
}

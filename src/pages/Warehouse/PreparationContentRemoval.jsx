import {useEffect,useRef,useState} from 'react';

export default function PreparationContentRemoval({title,description,busy,error,onRemove,onClose}) {
  const dialog=useRef(null),[reason,setReason]=useState('');
  useEffect(()=>{const element=dialog.current;element.showModal();return ()=>element.close();},[]);
  return <dialog ref={dialog} className="op-package-editor-dialog" aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <form className="op-panel" onSubmit={event=>{event.preventDefault();if(!busy && reason.trim().length>=3)void onRemove(reason.trim());}}>
      <h2>{title}</h2><p>{description} Sarà necessario ripetere il riscontro. L’eliminazione resterà nello storico.</p>
      {error && <p role="alert" className="op-error">{error}</p>}
      <label>Motivo<textarea required minLength={3} maxLength={1000} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <div className="op-toolbar"><button type="button" disabled={busy} onClick={onClose}>Annulla</button><button type="submit" disabled={busy || reason.trim().length<3}>{title}</button></div>
    </form>
  </dialog>;
}

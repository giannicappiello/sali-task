import {useEffect,useRef,useState} from 'react';

export default function PreparationReprintDialog({pallets,busy,error,notice,onPrint,onClose}) {
  const dialog=useRef(null);
  const [kind,setKind]=useState('bcf_print'),[copies,setCopies]=useState('3');
  useEffect(()=>{const element=dialog.current;element.showModal();return()=>element.close();},[]);
  return <dialog ref={dialog} className="op-package-editor-dialog op-reprint-dialog" aria-labelledby="op-reprint-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <form className="op-panel" onSubmit={event=>{event.preventDefault();void onPrint(kind,Number(copies));}}>
      <h2 id="op-reprint-title">Ristampa documenti</h2>
      <label>Documento
        <select value={kind} disabled={busy} onChange={event=>{setKind(event.target.value);setCopies(event.target.value==='bcf_print'?'3':'1');}}>
          <option value="bcf_print">DDT</option>
          {pallets.map(pallet=><option key={pallet.id} value={'packing_pallet_'+pallet.id}>Packing list bancale {pallet.number}</option>)}
        </select>
      </label>
      <label>Numero copie<input autoFocus type="number" inputMode="numeric" min="1" max="50" step="1" required value={copies} disabled={busy} onChange={event=>setCopies(event.target.value)}/></label>
      {error && <p className="op-error" role="alert">{error}</p>}
      {notice && <p className="op-notice" role="status">{notice}</p>}
      <div className="op-toolbar"><button type="button" disabled={busy} onClick={onClose}>Chiudi</button><button className="op-primary" type="submit" disabled={busy}>Stampa</button></div>
    </form>
  </dialog>;
}

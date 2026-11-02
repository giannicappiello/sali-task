import {useEffect,useRef,useState} from 'react';

export default function PreparationPackageEditor({pack,scans,busy,error,onAction,onSelect,onClose}) {
  const [reason,setReason]=useState(''),[quantities,setQuantities]=useState({});
  const dialog=useRef(null);
  useEffect(()=>{const element=dialog.current;element.showModal();return ()=>element.close();},[]);
  return <dialog ref={dialog} className="op-package-editor-dialog" aria-label={`Modifica collo ${pack.number}`} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><section className="op-panel"><h2>Modifica collo {pack.number}</h2>
    {error && <p role="alert" className="op-error">{error}</p>}
    <label>Motivo della modifica<textarea value={reason} minLength={3} maxLength={1000} onChange={e=>setReason(e.target.value)} disabled={busy}/></label>
    {pack.closed ? <><p>La riapertura annulla il riscontro precedente. Dopo le modifiche occorre riscontrare nuovamente l’ordine.</p><button disabled={busy || reason.trim().length<3} onClick={()=>void onAction('reopen_package',{packageId:pack.id,reason})}>Riapri collo</button></> : <>
      <button disabled={busy} onClick={()=>onSelect(pack)}>Aggiungi prodotti a questo collo</button>
      <div className="op-table-wrap"><table><thead><tr><th>Prodotto</th><th>Pezzi</th><th>Scansione server</th><th>Rimuovi pezzi</th></tr></thead><tbody>{scans.map(scan=><tr key={scan.id}>
        <td>{scan.code}</td><td>{scan.quantity}</td><td>{new Date(scan.at).toLocaleString('it-IT')}</td><td><input type="number" aria-label={`Pezzi da rimuovere ${scan.code}`} min={1} max={scan.quantity} step={1} value={quantities[scan.id] ?? scan.quantity} onChange={e=>setQuantities(old=>({...old,[scan.id]:e.target.value}))}/><button disabled={busy || reason.trim().length<3} onClick={()=>void onAction('remove_quantity',{scanId:scan.id,quantity:Number(quantities[scan.id] ?? scan.quantity),reason})}>Rimuovi</button></td>
      </tr>)}</tbody></table></div>{!scans.length && <p>Collo vuoto.</p>}
    </>}<button disabled={busy} onClick={onClose}>Chiudi modifica</button>
  </section></dialog>;
}

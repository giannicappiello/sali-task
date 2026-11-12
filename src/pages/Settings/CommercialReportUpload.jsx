import {useEffect,useState} from 'react';

export default function CommercialReportUpload({batch,request,onUploaded}) {
 const [state,setState]=useState(null),[files,setFiles]=useState({}),[replace,setReplace]=useState({}),[verified,setVerified]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function refresh() {setState(await request(null,batch.id));}
 useEffect(()=>{let active=true;request(null,batch.id).then(data=>{if(active)setState(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[batch.id,request]);
 async function upload(target) {
  setBusy(true);setError('');setMessage('');
  try {
   const file=files[target.key];if(!file||file.size>2000000)throw Error('Seleziona il PDF corretto, massimo 2 MB.');
   const bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Lettura PDF non riuscita.'));reader.readAsDataURL(file);});
   const current=state.missing.find(row=>row.artifactKey===target.key);
   const result=await request({action:'upload',batchId:batch.id,artifactKey:target.key,period:batch.period,network:target.network,source:target.source,base64,sha256:hash,verified:verified[target.key]===true,expectedUploadHash:current.uploadHash,replaceIncomplete:replace[target.key]===true});
   setMessage(result.status==='queued'?'Lotto completo e accodato. Verificare lo stato degli invii.':`PDF di ${target.name} caricato e verificato.`);
   await refresh();await onUploaded();
  }catch(e){setError(e.message+' Prima di riprovare, aggiorna lo stato del lotto.');}
  finally{setBusy(false);}
 }
 if(batch.status!=='requested')return null;
 return <section className="panel" style={{padding:20,marginBottom:20}}>
  <h2>Carica PDF nel lotto {batch.period}</h2>
  <p>Carica il PDF finale già verificato. I destinatari restano quelli del piano approvato. L’ultimo PDF completa il lotto e avvia l’invio quando dovuto.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <button type="button" disabled={busy} onClick={()=>refresh().catch(e=>setError(e.message))}>Aggiorna stato caricamenti</button>
  {state&&<p>{state.files.length} PDF finalizzati su {batch.manifest.length}.</p>}
  {state?.missing.map(row=>{const target=batch.manifest.find(t=>t.key===row.artifactKey);return <fieldset key={target.key} disabled={busy} style={{margin:'16px 0'}}>
   <legend>{target.name}</legend>
   {row.total&&<p>Caricamento incompleto: {row.receivedParts.length} parti su {row.total}.</p>}
   <label>PDF {target.name}<input type="file" accept="application/pdf,.pdf" onChange={e=>setFiles(current=>({...current,[target.key]:e.target.files[0]}))}/></label>
   <label><input type="checkbox" checked={verified[target.key]===true} onChange={e=>setVerified(current=>({...current,[target.key]:e.target.checked}))}/> Confermo che il PDF di {target.name} è quello finale verificato.</label>
   {!!row.total&&<label><input type="checkbox" checked={replace[target.key]===true} onChange={e=>setReplace(current=>({...current,[target.key]:e.target.checked}))}/> Sostituisci il caricamento incompleto di {target.name}, conservandone lo storico.</label>}
   <button type="button" disabled={!files[target.key]||!verified[target.key]} onClick={()=>upload(target)}>Carica {target.name}</button>
  </fieldset>;})}
 </section>;
}

import {useState} from 'react';
import {preparationApi} from './preparationApi.js';

const labels={created:'Preparazione creata',scan:'Scansione prodotti',verify:'Riscontro e chiusura colli',reopen_package:'Collo riaperto',remove_quantity:'Rimozione prodotti',undo:'Lettura annullata',add_package:'Collo aggiunto',add_pallet:'Bancale aggiunto',assign:'Collo assegnato al bancale',remove_package:'Collo rimosso',remove_pallet:'Bancale rimosso',claim_export:'Emissione BCF richiesta',finish:'Bolla confermata',uncertain:'Esito bolla da verificare',cancel:'Preparazione annullata',reopen:'Preparazione ripresa',refresh:'Ordine aggiornato',documents_and_emails_queued:'Documenti archiviati e email accodate',email_claimed:'Email acquisita',email_sending:'Invio email avviato',email_complete:'Email accettata dal servizio',email_retry:'Esito tentativo email',email_failed:'Email non inviata',email_lease_expired:'Tentativo email interrotto',email_manual_resolution:'Esito email verificato',print_queued:'Stampa accodata',print_printing:'Stampa avviata',print_submitted:'Documento inviato alla stampante',print_uncertain:'Esito stampa da verificare',print_failed:'Stampa non riuscita',print_lease_expired:'Stampa interrotta',print_manual_reprint:'Ristampa richiesta'};
function EventDetails({event}) {
  const payload=event.payload,state=payload.state,before=payload.beforeState;
  const readings=state?.scans?.filter(scan=>!before?.scans?.some(old=>old.id===scan.id && old.quantity===scan.quantity)) || [];
  const removed=before?.scans?.filter(old=>state && !state.scans.some(scan=>scan.id===old.id)) || [];
  const pack=scan=>state?.packages?.find(item=>item.id===scan.packageId) || before?.packages?.find(item=>item.id===scan.packageId);
  return <div>{payload.reason && <p>{payload.reason}</p>}{payload.message && <p>{payload.message}</p>}{payload.error && <p>{payload.error}</p>}
    {state && <p>{state.packages.length} colli · {state.pallets.length} bancali</p>}
    {!!(readings.length+removed.length) && <ul>{readings.map(scan=><li key={scan.id}>{scan.code} · {scan.quantity} pezzi · collo {pack(scan)?.number} · {new Date(scan.at).toLocaleString('it-IT')}{scan.corrected?' · quantità corretta':''}</li>)}{removed.map(scan=><li key={scan.id}>{scan.code} · rimossi {scan.quantity} pezzi dal collo {pack(scan)?.number}</li>)}</ul>}
    {payload.verification?.allocations && <ul>{payload.verification.allocations.map((lot,i)=><li key={i}>{lot.code} · {lot.quantity} pezzi · {lot.lotCode?`lotto ${lot.lotCode}`:'senza gestione lotti'} · magazzino {lot.warehouse}</li>)}</ul>}
    {payload.ddt && <p>{payload.ddt.signature} {payload.ddt.series}/{payload.ddt.number}</p>}
    {payload.documents && <ul>{payload.documents.map(file=><li key={file.kind}>{file.filename}</li>)}</ul>}
    {payload.recipients && <ul>{payload.recipients.map(person=><li key={person.email}>{person.roles.join(', ')} · {person.email}</li>)}</ul>}
    {payload.printer_id && <p>Stampante: {payload.printer_id}</p>}
  </div>;
}

export default function PreparationHistory({id}) {
  const [events,setEvents]=useState([]),[next,setNext]=useState(0),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');
  async function load(reset=false) {
    setBusy(true);setError('');
    try {const result=await preparationApi('audit',{id,after:reset?0:next});setEvents(old=>reset?result.events:[...old,...result.events]);setNext(result.nextAfter);setLoaded(true);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="op-panel"><h2>Registro ordine</h2><button disabled={busy} onClick={()=>void load(true)}>{loaded?'Aggiorna registro':'Mostra registro'}</button>
    {error && <p role="alert">{error}</p>}{loaded && <><label>Filtra gli eventi caricati<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Operatore, prodotto, collo o azione"/></label>
      <div className="op-table-wrap"><table><thead><tr><th>Data e ora server</th><th>Operatore</th><th>Operazione</th><th>Dettagli</th></tr></thead><tbody>{events.filter(event=>JSON.stringify(event).toLowerCase().includes(query.toLowerCase())).map(event=><tr key={event.id}>
        <td>{new Date(event.created_at).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}</td><td>{event.payload.operatorName || event.actor}</td><td>{labels[event.payload.operation || event.event_type] || 'Aggiornamento ordine'}</td><td><details><summary>Apri dettagli</summary><EventDetails event={event}/></details></td>
      </tr>)}</tbody></table></div>{next!==null && <button disabled={busy} onClick={()=>void load()}>Carica eventi successivi</button>}<p>Le correzioni aggiungono eventi e conservano le registrazioni precedenti.</p></>}
  </section>;
}

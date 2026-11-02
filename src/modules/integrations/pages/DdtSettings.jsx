import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { preparationApi } from '../../../pages/Warehouse/preparationApi.js';
import '../../../pages/Warehouse/orderPreparation.css';

const statusNames = {queued:'In coda',leased:'Acquisita',sending:'Invio in corso',retry:'Da riprovare',uncertain:'Esito da verificare',sent:'Accettata dal servizio email',failed:'Errore definitivo'};
export default function DdtSettings() {
  const [data,setData] = useState(null), [form,setForm] = useState({}), [emails,setEmails] = useState([]), [prints,setPrints] = useState([]);
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  const [filter,setFilter] = useState(''), [offset,setOffset] = useState(0), [next,setNext] = useState(null), [resolution,setResolution] = useState(null), [reason,setReason] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [config,queue] = await Promise.all([preparationApi('ddt_settings'),preparationApi('ddt_queue',{status:filter,offset})]);
      setData(config);setForm({emailCustomers:config.settings.email_customers !== false,emailAgents:config.settings.email_agents !== false,backofficeEmails:(config.settings.backoffice_emails || []).join('\n'),emailSubject:config.settings.email_subject,emailBody:config.settings.email_body,
        ddtPdfPath:config.settings.ddt_pdf_path || '',bcfContractVerified:config.settings.bcf_contract_verified,contractEvidence:config.settings.contract_evidence,
        ddtPrinterId:config.settings.ddt_printer_id || '',packingPrinterId:config.settings.packing_printer_id || ''});
      setEmails(queue.emails);setPrints(queue.prints);setNext(queue.nextOffset);
    } catch (e) {setError(e.message);}
  },[filter,offset]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),0);return ()=>clearTimeout(timer);},[load]);
  const field = (name,value) => setForm(old=>({...old,[name]:value}));
  const printerDepartments = name => [['warehousePrinter','Magazzino'],['productionPrinter','Produzione'],['officePrinter','Ufficio'],['secretariatPrinter','Segreteria']].filter(([key])=>data?.printerConfiguration?.[key]===name).map(([,label])=>label).join(', ');
  async function save(event) {
    event.preventDefault();setBusy(true);setNotice('');setError('');
    try {await preparationApi('ddt_configure',{...form,backofficeEmails:form.backofficeEmails.split(/[\n;,]+/).map(v=>v.trim()).filter(Boolean),settingsVersion:data.settings.updated_at});await load();setNotice('Configurazione DDT salvata.');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function resolve() {
    setBusy(true);setError('');
    try {await preparationApi(resolution.print?'ddt_reprint':'ddt_recover_email',resolution.print?{printId:resolution.id,eventId:resolution.request,reason,confirmed:true}:{emailId:resolution.id,outcome:resolution.outcome,reason,confirmed:true});setResolution(null);setReason('');await load();setNotice('Esito registrato nello storico ordine.');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function verifyMexal() {
    setBusy(true);setError('');setNotice('');
    try {await preparationApi('ddt_verify',{settingsVersion:data.settings.updated_at});await load();setNotice('Collegamento BCF verificato: PDF originale Mexal disponibile.');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <main className="order-preparation op-page integrations-page ddt-settings-page"><h1>Configurazioni DDT</h1><p>Configura chi riceve BCF e packing list. Gli indirizzi di clienti e agenti provengono dalle anagrafiche dell’ordine; il riepilogo mostra i destinatari effettivi prima dell’emissione.</p>
    {error && <p role="alert" className="op-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {data && <form className="op-settings" onSubmit={save}><fieldset disabled={busy || !data.canConfigure}><legend>Destinatari e messaggio</legend>
      <label className="ddt-recipient-choice"><input type="checkbox" checked={form.emailCustomers} onChange={e=>field('emailCustomers',e.target.checked)}/>Invia al cliente</label>
      <label className="ddt-recipient-choice"><input type="checkbox" checked={form.emailAgents} onChange={e=>field('emailAgents',e.target.checked)}/>Invia all’agente</label>
      <small>La scelta viene registrata nel riepilogo di ogni nuova spedizione. Gli invii già preparati conservano i destinatari confermati.</small>
      <label>Indirizzi backoffice, uno per riga<textarea value={form.backofficeEmails} onChange={e=>field('backofficeEmails',e.target.value)}/></label>
      <small>Prima di emettere una spedizione è necessario configurare almeno un indirizzo backoffice.</small>
      <label>Oggetto<input required maxLength={300} value={form.emailSubject} onChange={e=>field('emailSubject',e.target.value)}/></label>
      <label>Messaggio<textarea required maxLength={10000} value={form.emailBody} onChange={e=>field('emailBody',e.target.value)}/></label>
      <small>Puoi usare {'{documento}'} nel messaggio e nell’oggetto, e {'{ordine}'} nel messaggio.</small>
      <h2>Stampanti</h2><p>Usa le stampanti del servizio Workspace/MES già installato. La stampa operativa usa queste scelte senza richiedere una nuova selezione.</p>
      {data.printerError && <p role="alert" className="op-error">{data.printerError}</p>}
      {data.printerConfiguration?.warehousePrinter && <p>Magazzino nel MES: <strong>{data.printerConfiguration.warehousePrinter}</strong></p>}
      {[['ddtPrinterId','Stampante DDT - 3 copie'],['packingPrinterId','Stampante packing list per bancale']].map(([name,label])=><label key={name}>{label}<select value={form[name]} onChange={e=>field(name,e.target.value)}><option value="">Seleziona stampante</option>{data.printers.map(printer=><option key={printer.id} value={printer.id}>{printerDepartments(printer.name)?printerDepartments(printer.name)+' · ':''}{printer.name}{Date.now()-Date.parse(printer.last_seen)>600000?' · Offline':''}</option>)}</select></label>)}
      {!data.printers.length && <p>Il servizio Workspace/MES non ha restituito stampanti disponibili. Verifica il servizio esistente in Impostazioni → Stampanti, poi premi “Aggiorna”.</p>}
      <h2>Collegamento documenti Mexal</h2><p>{form.bcfContractVerified?'Collegamento BCF verificato. Il PDF originale viene recuperato direttamente da Mexal.':'Collegamento PDF da verificare.'}</p>
      <button type="button" disabled={busy} onClick={()=>void verifyMexal()}>{busy?'Verifica in corso...':'Verifica collegamento Mexal'}</button>
      <details><summary>Dettagli della verifica</summary>
        <p>{form.contractEvidence || 'Nessuna verifica completata.'}</p>
      </details><button type="submit">Salva configurazione DDT</button></fieldset></form>}
    <section className="op-panel"><h2>Controllo invii</h2><div className="op-toolbar"><label>Stato<select value={filter} onChange={e=>{setOffset(0);setFilter(e.target.value);}}><option value="">Tutti</option>{Object.entries(statusNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button disabled={busy} onClick={()=>void load()}>Aggiorna</button></div>
      <div className="op-table-wrap"><table><thead><tr><th>Ordine</th><th>Destinatario</th><th>Stato</th><th>Tentativi</th><th>Ultimo errore</th><th>Azioni</th></tr></thead><tbody>{emails.map(mail=><tr key={mail.id}>
        <td><Link to={'/logistica/allestisci-ordini?id='+mail.preparation_id}>Apri ordine</Link></td><td>{mail.recipient}<small> · {mail.roles.join(', ')}</small></td><td>{statusNames[mail.status]}{mail.sent_at && <small> · {new Date(mail.sent_at).toLocaleString('it-IT')}</small>}</td><td>{mail.attempts}</td><td>{mail.last_error || '—'}</td>
        <td>{data?.canConfigure && ['uncertain','failed'].includes(mail.status) && <><button disabled={busy} onClick={()=>{setReason('');setResolution({id:mail.id,outcome:'sent'});}}>Registra invio verificato</button><button disabled={busy} onClick={()=>{setReason('');setResolution({id:mail.id,outcome:'retry'});}}>Prepara nuovo tentativo</button></>}</td>
      </tr>)}</tbody></table></div>{!emails.length && <p>Nessun invio per questo filtro.</p>}
      <div className="op-toolbar"><button disabled={!offset || busy} onClick={()=>setOffset(Math.max(0,offset-50))}>Precedenti</button><button disabled={next === null || busy} onClick={()=>setOffset(next)}>Successivi</button></div>
    </section>
    <section className="op-panel"><h2>Ultime stampe</h2><p>“Inviata alla stampante” indica l’accettazione da parte del programma di stampa; verificare l’uscita cartacea.</p><div className="op-table-wrap"><table><thead><tr><th>Ordine</th><th>Documento</th><th>Stampante</th><th>Stato</th><th>Errore</th></tr></thead><tbody>{prints.map(job=><tr key={job.id}><td><Link to={'/logistica/allestisci-ordini?id='+job.preparation_id}>Apri ordine</Link></td><td>{job.document_kind === 'bcf_print'?'DDT - 3 copie':'Packing list bancale'}</td><td>{job.printer_id}</td><td>{{queued:'In coda',leased:'Acquisita',printing:'Invio alla stampante',submitted:'Inviata alla stampante',uncertain:'Esito da verificare',failed:'Errore'}[job.status]}</td><td>{job.error || '—'}{data?.canConfigure && ['uncertain','failed'].includes(job.status) && <button disabled={busy} onClick={()=>{setReason('');setResolution({id:job.id,print:true,request:crypto.randomUUID()});}}>Richiedi ristampa</button>}</td></tr>)}</tbody></table></div></section>
    {resolution && <section className="op-confirm-box" role="group" aria-label="Conferma esito"><h2>{resolution.print?'Conferma ristampa':resolution.outcome === 'retry' ? 'Conferma nuovo tentativo' : 'Conferma invio verificato'}</h2><p>{resolution.print?'Controlla l’uscita cartacea prima di richiedere un’altra copia. La ristampa sarà registrata nello storico.':resolution.outcome === 'retry' ? 'Verifica presso il servizio email che il messaggio non sia già stato accettato. Un nuovo tentativo può produrre un duplicato.' : 'Registra questo esito solo dopo aver verificato l’accettazione del messaggio nel servizio email.'}</p><label>Motivo e riferimento verifica<textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy} onClick={()=>setResolution(null)}>Annulla</button><button disabled={busy || reason.trim().length<3} onClick={()=>void resolve()}>Conferma esito</button></section>}
  </main>;
}

import { useEffect, useState } from 'react';
import { hrRpc, romeDay } from './hrService';

const DAYS = ['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
const format = slots => slots.map(([from,to]) => `${from}-${to}`).join(', ');
function parseCalendarIntervals(text) {
  if (!text.trim()) return [];
  let end = '';
  return text.split(',').map(part => {
    const match = /^\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*$/.exec(part);
    if (!match || match[1] >= match[2] || match[1] < end) throw new Error('Usa fasce ordinate, ad esempio 07:30-12:30, 13:30-16:30.');
    end = match[2]; return [match[1],match[2]];
  });
}
export default function CompanyCalendar() {
  const [data,setData] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [editor,setEditor] = useState(null), [success,setSuccess] = useState('');
  async function load() { const value=await hrRpc('workspace_company_calendar_read'); setData(value); }
  useEffect(() => { let active=true; hrRpc('workspace_company_calendar_read').then(value => { if(active)setData(value); }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;}; },[]);
  async function save(e) {
    e.preventDefault();setBusy(true);setError('');setSuccess('');
    try {
      const payload=editor.kind==='version' ? {effectiveFrom:editor.day,note:editor.reason,week:Object.fromEntries(editor.days.map((s,i)=>[String(i+1),parseCalendarIntervals(s)]))} : {day:editor.day,reason:editor.reason,intervals:parseCalendarIntervals(editor.slots)};
      await hrRpc('workspace_company_calendar_save',{p_action:editor.kind,p_data:payload});
      setEditor(null);await load();setSuccess('Calendario salvato. Il MES lo acquisisce alla successiva sincronizzazione.');
    } catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function refresh() { setBusy(true);setError('');try{await load();}catch(e){setError(e.message);}finally{setBusy(false);} }
  const current=data?.versions.filter(v=>v.effectiveFrom<=romeDay()).at(-1);
  return <section className="hr-panel"><div className="hr-heading"><h2>Calendario aziendale</h2><div className="hr-actions"><button disabled={busy} onClick={refresh}>Aggiorna calendario</button><button disabled={!data||busy} onClick={()=>{setError('');setEditor({kind:'version',day:romeDay(),reason:'',days:DAYS.map((_,i)=>format(current?.week[String(i+1)]||[]))});}}>Nuovo orario con decorrenza</button><button disabled={!data||busy} onClick={()=>{setError('');setEditor({kind:'exception',day:romeDay(),reason:'',slots:''});}}>Chiusura / apertura straordinaria</button></div></div>
    <p className="hr-note">{data?.lastMesSync ? `Ultimo collegamento MES: ${new Date(data.lastMesSync).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}` : 'Collegamento MES non ancora attivato.'}</p><p>Orari locali Europe/Rome. Il calendario vale per la pianificazione aziendale; gli accordi individuali e i fermi macchina restano distinti.</p>
    {error&&<p className="hr-error" role="alert">{error}</p>}{success&&<p role="status">{success}</p>}
    {editor&&<form onSubmit={save} className="hr-contract"><h3>{editor.kind==='version'?'Nuova versione dell’orario':'Eccezione giornaliera'}</h3><div className="hr-form-grid"><label>{editor.kind==='version'?'Decorrenza':'Giorno'}<input required type="date" min={romeDay()} value={editor.day} onChange={e=>setEditor({...editor,day:e.target.value})}/></label><label>Motivazione<input required maxLength={300} value={editor.reason} onChange={e=>setEditor({...editor,reason:e.target.value})}/></label>
      {editor.kind==='version'?DAYS.map((day,i)=><label key={day}>{day}<input placeholder="07:30-12:30, 13:30-16:30" value={editor.days[i]} onChange={e=>setEditor({...editor,days:editor.days.map((s,j)=>j===i?e.target.value:s)})}/></label>):<label>Fasce di apertura<input placeholder="Vuoto = giornata chiusa" value={editor.slots} onChange={e=>setEditor({...editor,slots:e.target.value})}/></label>}</div><p className="hr-note">Una fascia vuota indica chiusura. Separa i turni con una virgola. Le eccezioni prevalgono sull’orario settimanale e sulle chiusure. Le versioni precedenti sono conservate; per una stessa decorrenza è ammessa una sola versione.</p><div className="hr-actions"><button type="button" disabled={busy} onClick={()=>setEditor(null)}>Annulla</button><button className="hr-primary" disabled={busy}>{busy?'Salvataggio…':'Salva calendario'}</button></div></form>}
    {!data?<p>{error?'Calendario non caricato. Premi Aggiorna calendario per riprovare.':'Caricamento calendario…'}</p>:<><div className="hr-table-wrap"><table><thead><tr><th>Giorno</th><th>Orario attuale</th></tr></thead><tbody>{DAYS.map((d,i)=><tr key={d}><td>{d}</td><td>{format(current?.week[String(i+1)]||[])||'Chiuso'}</td></tr>)}</tbody></table></div><h3>Eccezioni</h3>{data.exceptions.length?data.exceptions.map(e=><p key={e.id}>{e.day} · {format(e.intervals)||'Chiuso'} · {e.reason}</p>):<p>Nessuna eccezione.</p>}<h3>Chiusure e festività registrate</h3><div style={{maxHeight:320,overflowY:'auto'}}>{data.closures.filter(c=>c.to>=romeDay()).map((c,i)=><p key={i}>{c.from} – {c.to} · {c.reason}</p>)}</div><h3>Versioni dell’orario</h3>{data.versions.slice().reverse().map(v=><details key={v.id}><summary>Decorrenza {v.effectiveFrom} · {v.note}</summary>{DAYS.map((d,i)=><p key={d}>{d}: {format(v.week[String(i+1)]||[])||'Chiuso'}</p>)}</details>)}</>}
  </section>;
}

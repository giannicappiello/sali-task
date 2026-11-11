import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
export default function RecipientSettings({ agent, configuration }) {
 const [policy, setPolicy] = useState(agent.recipient_policy), [enabled,setEnabled]=useState(agent.enabled), [readiness,setReadiness]=useState(agent.readiness), [version,setVersion]=useState(agent.config_version), [busy, setBusy] = useState(false), [checking,setChecking]=useState(false), [error, setError] = useState(''), [review, setReview] = useState('');
 const headers = async () => { const { data } = await supabase.auth.getSession(); if (!data.session) throw Error('Sessione Workspace non disponibile.'); return { 'Content-Type':'application/json', Authorization:'Bearer '+data.session.access_token }; };
 const verify = async () => {
  setChecking(true);setError('');
  try { const response=await fetch('/api/mexal/automation?route=anomalies&action=readiness',{method:'POST',headers:await headers(),body:'{}'});const result=await response.json();if(!response.ok)throw Error(result.error||'Verifica prerequisiti non conclusa.');setReadiness(result.readiness);setVersion(result.configVersion);setEnabled(result.enabled); }
  catch(e){setError(e.message);}finally{setChecking(false);}
 };
 const submit = async event => {
  event.preventDefault(); setBusy(true); setError('');
  try {
   const response = await fetch('/api/mexal/automation?route=anomalies&action=configure', { method: 'POST', headers: await headers(), body: JSON.stringify({ expectedVersion: version, enabled, recipientPolicy: policy }) });
   const result = await response.json(); if (!response.ok) throw Error(result.error || 'Proposta non conclusa.'); setReview(result.reviewUrl);
  } catch (e) { setError(e.message); } finally { setBusy(false); }
 };
 return <details><summary>Configura destinatari report</summary><form onSubmit={submit}>
  <p>Stato prerequisiti: {readiness?.ready===true&&readiness?.emailReady===true?'verificati':'da verificare'}. {readiness?.reason}</p>
  <button type="button" disabled={checking||busy||agent.enabled} onClick={verify}>{checking?'Verifica in corso…':'Verifica prerequisiti attuali'}</button>
  <p>Gli indirizzi e gli amministratori attivi saranno verificati ad ogni invio. In assenza di un responsabile univoco il reparto richiede una scelta esplicita.</p>
  <label><input type="checkbox" checked={enabled} disabled={!enabled&&(readiness?.ready!==true||readiness?.emailReady!==true)} onChange={e=>setEnabled(e.target.checked)} /> Attiva controllo giornaliero alle 07:00 (richiede approvazione manuale)</label>
  <label><input type="checkbox" checked={policy.departmentManager} onChange={e => setPolicy({ ...policy, departmentManager: e.target.checked })} /> Responsabile del reparto coinvolto</label>
  <label><input type="checkbox" checked={policy.workspaceAdmins} onChange={e => setPolicy({ ...policy, workspaceAdmins: e.target.checked })} /> Amministratori Workspace attivi</label>
  {configuration.departments.map(dept => <label key={dept.id}>{dept.nome} · responsabile per i report<select value={policy.departmentOverrides[dept.id] || ''} onChange={e => { const overrides = { ...policy.departmentOverrides }; if (e.target.value) overrides[dept.id] = e.target.value; else delete overrides[dept.id]; setPolicy({ ...policy, departmentOverrides: overrides }); }}><option value="">Rileva automaticamente dalle relazioni responsabile</option>{configuration.users.map(u => <option key={u.id} value={u.id}>{u.nome} {u.cognome} · {u.email}</option>)}</select></label>)}
  <label>Destinatari aggiuntivi<select multiple value={policy.additionalUserIds} onChange={e => setPolicy({ ...policy, additionalUserIds: Array.from(e.target.selectedOptions, x => x.value) })}>{configuration.users.map(u => <option key={u.id} value={u.id}>{u.nome} {u.cognome} · {u.email}</option>)}</select></label>
  <button disabled={busy||checking}>Prepara configurazione da approvare</button>{error && <p role="alert">{error}</p>}{review && <p>Configurazione ancora da approvare. <a href={review}>Apri revisione manuale Workspace</a></p>}
 </form></details>;
}

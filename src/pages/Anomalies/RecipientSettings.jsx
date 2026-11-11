import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { allowsAnomalyDepartmentManager } from '../../../shared/anomalyRecipientDepartments.js';
export default function RecipientSettings({ agent, configuration }) {
 const [recipientToAdd, setRecipientToAdd] = useState('');
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
  {configuration.departments.filter(allowsAnomalyDepartmentManager).map(dept => <label key={dept.id}>{dept.nome} · responsabile per i report<select value={policy.departmentOverrides[dept.id] || ''} onChange={e => { const overrides = { ...policy.departmentOverrides }; if (e.target.value) overrides[dept.id] = e.target.value; else delete overrides[dept.id]; setPolicy({ ...policy, departmentOverrides: overrides }); }}><option value="">Rileva automaticamente dalle relazioni responsabile</option>{configuration.users.map(u => <option key={u.id} value={u.id}>{u.nome} {u.cognome} · {u.email}</option>)}</select></label>)}
  <fieldset disabled={busy || checking}>
   <legend>Destinatari aggiuntivi</legend>
   {policy.additionalUserIds.length === 0 ? <p>Nessun destinatario aggiuntivo.</p> : <>
    <ul>{policy.additionalUserIds.map(id => {
     const user = configuration.users.find(u => u.id === id);
     const name = user ? `${user.nome} ${user.cognome} · ${user.email}` : 'Contatto non disponibile';
     return <li key={id}>{name} <button type="button" aria-label={`Rimuovi ${name}`} onClick={() => setPolicy(current => ({ ...current, additionalUserIds: current.additionalUserIds.filter(value => value !== id) }))}>Rimuovi</button></li>;
    })}</ul>
    <button type="button" onClick={() => setPolicy(current => ({ ...current, additionalUserIds: [] }))}>Rimuovi tutti</button>
   </>}
   <label>Scegli un contatto Workspace<select value={recipientToAdd} onChange={e => setRecipientToAdd(e.target.value)}>
    <option value="">Seleziona un contatto…</option>
    {configuration.users.filter(u => !policy.additionalUserIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.nome} {u.cognome} · {u.email}</option>)}
   </select></label>
   <button type="button" disabled={!recipientToAdd || policy.additionalUserIds.length >= 50} onClick={() => {
    setPolicy(current => ({ ...current, additionalUserIds: [...new Set([...current.additionalUserIds, recipientToAdd])] }));
    setRecipientToAdd('');
   }}>Aggiungi destinatario</button>
  </fieldset>
  <button disabled={busy||checking}>Prepara configurazione da approvare</button>{error && <p role="alert">{error}</p>}{review && <p>Configurazione ancora da approvare. <a href={review}>Apri revisione manuale Workspace</a></p>}
 </form></details>;
}

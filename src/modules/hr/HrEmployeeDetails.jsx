import { useRef, useState } from 'react';
import { agreementDisplay, agreementValues, AGREEMENT_FIELDS } from './hrAgreements';
import { formatDate, romeDay } from './hrTime';
import { hrRpc } from './hrService';

export default function HrEmployeeDetails({ employee, contracts, sites, users = [], onSaved }) {
  const ordered = [...contracts].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || (b.created_at || '').localeCompare(a.created_at || ''));
  const current = ordered[0];
  const initial = { ...agreementValues(current, sites), effective_from: current?.effective_from || '', employee_code: employee.employee_code || '', manager: employee.manager === true, reviewer_ids: employee.reviewer_ids || [] };
  const [drafts, setDrafts] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const keys = useRef({});
  const draft = drafts[employee.user_id];
  const values = draft?.values || initial;
  const base = draft?.base || initial;
  const change = (field, value) => { delete keys.current[employee.user_id]; setError(''); setSaved(''); setDrafts(all => ({ ...all, [employee.user_id]: { base, contract: draft?.contract || current || null, values: { ...values, [field]: value } } })); };
  const dirty = JSON.stringify(values) !== JSON.stringify(base);
  const input = key => {
    const label = AGREEMENT_FIELDS.find(([k]) => k === key)?.[1] || key;
    return <label key={key}>{label}{key === 'overtime_separate' ? <input className="hr-agreement-checkbox" type="checkbox" checked={values[key] === true} onChange={e => change(key, e.target.checked)}/> : <input value={values[key] ?? ''} onChange={e => change(key, e.target.value)}/>}</label>;
  };
  async function save(event) {
    event.preventDefault(); if (busy || !dirty) return; setBusy(true); setError('');
    const employeeId = employee.user_id;
    try {
      const changed = [...AGREEMENT_FIELDS.map(([key]) => key), 'effective_from'].some(key => values[key] !== base[key]);
      if (changed && !values.effective_from) throw new Error('Indica la decorrenza degli accordi.');
      const source = draft?.contract || current;
      keys.current[employeeId] ||= crypto.randomUUID();
      await hrRpc('workspace_hr_save_employee', { p_key: keys.current[employeeId], p_data: {
        user_id: employeeId, employee_code: values.employee_code, manager: values.manager,
        reviewer_ids: values.reviewer_ids, contract_id: source?.id || null,
        ...(changed ? { contract: { ...Object.fromEntries([...AGREEMENT_FIELDS.map(([key]) => key), 'effective_from'].map(key => [key, values[key]])), overtime_mode: source?.agreement_fields?.overtime_mode ?? source?.overtime_mode ?? '' } } : {}),
      } });
      await onSaved(); delete keys.current[employeeId];
      setDrafts(all => { const next = { ...all }; delete next[employeeId]; return next; });
      setSaved(employeeId);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <form className="hr-inline-employee" onSubmit={save}>
    <div className="hr-heading hr-profile-head"><div className="hr-profile-identity"><span className="hr-avatar" aria-hidden="true">{employee.name.split(' ').map(s => s[0]).slice(0, 2).join('')}</span><div><h2>{employee.name}</h2><span className="hr-muted hr-small">{employee.active ? 'Attivo' : 'Non attivo'} · {dirty ? 'Modifiche da salvare' : 'Scheda dipendente'}</span></div></div></div>
    <fieldset className="hr-card-scroll hr-profile-content" disabled={busy}>
      <section className="hr-profile-group"><h3>Anagrafica e organizzazione</h3><div className="hr-profile-grid">
        <label>Matricola<input value={values.employee_code} onChange={e => change('employee_code', e.target.value)}/></label>
        {input('site_id')}
        <p>Reparti operativi<br/><strong>{employee.department || 'Non indicati'}</strong></p><p>Appartenenza aggiuntiva<br/><strong>Human Resources</strong></p>
        <label>Permessi nel modulo HR<select value={values.manager ? 'manager' : 'employee'} onChange={e => change('manager', e.target.value === 'manager')}><option value="employee">Dipendente · Dati personali</option><option value="manager">Gestore HR · Gestione operativa</option></select></label>
        <fieldset className="hr-inline-reviewers"><legend>Responsabili richieste</legend>{users.filter(u => u.id !== employee.user_id).map(u => <label key={u.id}><input type="checkbox" checked={values.reviewer_ids.includes(u.id)} onChange={e => change('reviewer_ids', e.target.checked ? [...values.reviewer_ids, u.id] : values.reviewer_ids.filter(id => id !== u.id))}/>{u.name}</label>)}</fieldset>
      </div></section>
      <section className="hr-profile-group"><h3>Orario pattuito</h3><div className="hr-profile-grid">
        <label>Decorrenza accordi<input type="date" value={values.effective_from} onChange={e => change('effective_from', e.target.value)}/></label>
        {['weekly_hours','weekdays','start_time','end_time','break_minutes'].map(input)}
      </div></section>
      <section className="hr-profile-group"><h3>Accordi economici</h3><div className="hr-profile-grid">{['agreed_pay','pay_period','overtime_separate','overtime_rate','overtime_percent'].map(input)}</div></section>
      <details className="hr-profile-history"><summary>Storico e accordi futuri ({ordered.length})</summary>{ordered.map(c => <article className="hr-contract" key={c.id}><h3>Dal {formatDate(c.effective_from)}{c.effective_from > romeDay() ? ' · Programmato' : ''}</h3>{AGREEMENT_FIELDS.map(([key, label]) => <p key={key}>{label}: <strong>{agreementDisplay(c, key, sites)}</strong></p>)}</article>)}</details>
      <p className="hr-muted hr-small">Le modifiche agli accordi conservano le versioni precedenti. I campi descrittivi o incompleti non generano automaticamente turni o importi.</p>
    </fieldset>
    {error && <p role="alert" className="hr-error">{error}</p>}{saved === employee.user_id && <p role="status" className="hr-success">Scheda salvata.</p>}
    <footer className="hr-actions"><button type="button" disabled={busy || !dirty} onClick={() => { setDrafts(all => { const next = { ...all }; delete next[employee.user_id]; return next; }); delete keys.current[employee.user_id]; setError(''); }}>Annulla modifiche</button><button className="hr-primary" disabled={busy || !dirty}>{busy ? 'Salvataggio…' : 'Salva scheda'}</button></footer>
  </form>;
}

import { createSaveOutcome } from "../../save-outcomes.js";
import { useEffect, useState } from 'react';

const labels = { develop: 'Modifica codice e test', publish: 'Pubblica codice', browser: 'Browser Workspace', database: 'Schema e migrazioni database' };
export default function AIDevelopmentPermissions({ call }) {
  const [data, setData] = useState({ users: [], permissions: [] });
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState({ develop: false, publish: false, browser: false, database: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    call({ action: 'development_permissions_list' }).then(result => { if (alive) setData(result); }).catch(error => { if (alive) setStatus(error.message); });
    return () => { alive = false; };
  }, [call]);
  function choose(id) {
    setSelected(id); setStatus('');
    const permissions = data.permissions.find(item => item.user_id === id) || {};
    setValues(Object.fromEntries(Object.keys(labels).map(key => [key, permissions[key] === true])));
  }
  async function save() {
    const _saveOutcome = createSaveOutcome();
    try {

    setBusy(true); setStatus('');
    try { setData(await call({ action: 'development_permissions_save', userId: selected, permissions: values })); setStatus('Permessi salvati. La revoca viene verificata anche prima delle operazioni in coda.'); }
    catch (error) {
      _saveOutcome.failure(error);
 setStatus(error.message); }
    finally { setBusy(false); }

      _saveOutcome.success();
    } catch (_saveError) { _saveOutcome.failure(_saveError); throw _saveError; }
}
  return <section aria-labelledby="ai-development-permissions"><h3 id="ai-development-permissions">Permessi di sviluppo per utente</h3>
    <p>Gli amministratori hanno tutte le capacità integrate. Gli altri utenti partono senza permessi di sviluppo. Queste autorizzazioni si aggiungono ai permessi operativi del reparto.</p>
    <p>Pubblicazione e migrazioni consentono modifiche globali all’applicazione. Il browser usa un profilo separato per ogni utente e rispetta i permessi dell’account con cui viene effettuato l’accesso.</p>
    <label>Utente <select value={selected} onChange={event => choose(event.target.value)} disabled={busy}><option value="">Seleziona utente</option>{data.users.filter(user => !user.ruoli?.amministratore_workspace).map(user => <option key={user.id} value={user.id}>{user.nome} {user.cognome}</option>)}</select></label>
    {selected && <><div>{Object.entries(labels).map(([key, label]) => <label key={key} style={{ display: 'block' }}><input type="checkbox" checked={values[key]} disabled={busy || (key === 'publish' && !values.develop)} onChange={event => setValues(previous => ({ ...previous, [key]: event.target.checked, ...(key === 'develop' && !event.target.checked ? { publish: false } : {}) }))} /> {label}</label>)}</div><button type="button" onClick={save} disabled={busy}>Salva permessi di sviluppo</button></>}
    {status && <p role="status">{status}</p>}
  </section>;
}

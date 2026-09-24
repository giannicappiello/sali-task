import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const STATES = { proposed: 'Da confermare', queued: 'In attesa del PC', running: 'Elaborazione isolata', review: 'Da verificare', failed: 'Non riuscito', interrupted: 'Interrotto', rejected: 'Rifiutato' };

function DevelopmentResult({ result }) {
  if (!result || !Object.keys(result).length) return null;
  return <details><summary>Modifiche e verifiche</summary>
    {result.summary && <p style={{ whiteSpace: 'pre-wrap' }}>{result.summary}</p>}
    {result.attempts?.length > 1 && <p>Tentativi verificati: {result.attempts.length}. L’assistente ha usato gli errori dei test per correggere la proposta.</p>}
    {result.revision && <p>Revisione da esaminare: <code>{result.revision.branch}</code><br />Commit: <code>{result.revision.commit}</code><br />Non ancora pubblicata.</p>}
    {Array.isArray(result.checks) && <ul>{result.checks.map((check, index) => <li key={index}>
      <strong>{check.succeeded ? 'Verifica superata' : 'Verifica non riuscita'}</strong>{Number.isFinite(check.durationSeconds) && ` · ${check.durationSeconds} s`}
      <details><summary>Dettaglio della verifica {index + 1}</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{check.output || 'Nessun output.'}</pre></details>
    </li>)}</ul>}
    {Array.isArray(result.edits) && <div><strong>File modificati ({result.edits.length})</strong>{result.edits.map(edit => <details key={edit.path}><summary>{edit.path}</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{edit.content}</pre></details>)}</div>}
  </details>;
}

export default function AIDevelopmentSettings() {
  const { session, profile } = useAuth();
  const [data, setData] = useState({ hosts: [], jobs: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(null);
  const call = useCallback(async body => {
    const response = await fetch('/api/ai/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.error || 'Operazione non riuscita.');
    return result;
  }, [session?.access_token]);
  const refresh = useCallback(async () => setData(await call({ action: 'development_list' })), [call]);
  useEffect(() => {
    let alive = true;
    call({ action: 'development_list' }).then(result => { if (alive) setData(result); }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [call]);
  async function act(body) {
    setBusy(true); setError('');
    try {
      const result = await call(body);
      if (result.token) setPairing(result);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (profile?.ruoli?.amministratore_workspace !== true) return null;
  return <section className="ai-cost-report" aria-labelledby="ai-development-title">
    <div className="ai-cost-report-heading"><div><span>ASSISTENZA E SVILUPPO</span><h2 id="ai-development-title">Servizio sul PC e modifiche al codice</h2><p>Le modifiche al codice richieste esplicitamente dagli amministratori vengono inviate direttamente al PC per elaborazione e test isolati. I risultati richiedono verifica prima della pubblicazione.</p></div>
      <button type="button" disabled={busy} onClick={() => act({ action: 'development_list' })}>Aggiorna stato</button></div>
    {error && <p role="alert">{error}</p>}
    <p>Cartella dedicata: <strong>C:\AssistenteAI</strong>. Il PC deve essere acceso e collegato.</p>
    {data.hosts.map(host => <div key={host.id}><strong>{host.name}</strong> · {host.active ? 'Associato' : 'Revocato'} · Ultimo collegamento: {host.last_seen_at ? new Date(host.last_seen_at).toLocaleString('it-IT') : 'Mai collegato'}
      {host.active && <button type="button" disabled={busy} onClick={() => act({ action: 'development_revoke', hostId: host.id })}>Revoca accesso</button>}</div>)}
    <button type="button" disabled={busy} onClick={() => act({ action: 'development_pair' })}>Associa servizio sul PC</button>
    {pairing && <div role="status"><p>Credenziale mostrata una sola volta: inserirla nella configurazione protetta del servizio, senza condividerla nelle chat.</p>
      <input aria-label="Credenziale servizio" type="password" readOnly value={pairing.token} autoComplete="off" />
      <button type="button" onClick={() => navigator.clipboard.writeText(pairing.token).catch(() => setError('Copia non disponibile: selezionare la credenziale.'))}>Copia credenziale</button>
      <button type="button" onClick={() => setPairing(null)}>Chiudi credenziale</button></div>}
    {!data.jobs.length ? <p>Nessuna richiesta di sviluppo. Puoi descrivere il problema nel pannello AI di qualsiasi schermata.</p> : <div className="ai-cost-table-wrap"><table className="ai-cost-table"><thead><tr><th>Data</th><th>Repository</th><th>Richiesta</th><th>Stato e risultato</th><th>Azioni</th></tr></thead><tbody>{data.jobs.map(job => <tr key={job.id}>
      <td>{new Date(job.created_at).toLocaleString('it-IT')}</td><td>{job.repository}</td><td>{job.instruction}<small>{job.id}</small></td>
      <td>{STATES[job.status] || job.status}{job.error && <p role="alert">{job.error}</p>}<DevelopmentResult result={job.result} /></td>
      <td>{job.status === 'proposed' && job.user_id === profile.id && <><button type="button" disabled={busy} onClick={() => act({ action: 'development_decide', jobId: job.id, decision: 'confirm' })}>Conferma elaborazione</button><button type="button" disabled={busy} onClick={() => act({ action: 'development_decide', jobId: job.id, decision: 'reject' })}>Rifiuta</button></>}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}

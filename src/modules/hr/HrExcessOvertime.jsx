import { useCallback, useEffect, useRef, useState } from 'react';
import { hrRpc } from './hrService';
import { exportDate } from './hrAttendanceExport';

function Conversion({ row, name, onClose, onSave }) {
  const dialog = useRef(null), key = useRef(crypto.randomUUID());
  const [minutes, setMinutes] = useState(row.minutes);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={dialog} className="hr-dialog" aria-labelledby="hr-convert-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try {
      await hrRpc('workspace_hr_convert_excess', { p_user: row.user_id, p_day: row.day, p_minutes: Number(minutes), p_token: row.token, p_key: key.current });
      await onSave(); onClose();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>
      <h2 id="hr-convert-title">Converti ore eccedenti in straordinario</h2>
      <p>{name} · {exportDate(row.day)}</p>
      <p>Disponibili {row.minutes} minuti ({(row.minutes / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 })} ore). Conferma tutti i minuti oppure riduci la quantità per una conversione parziale.</p>
      <label>Minuti da approvare<input aria-label="Minuti da approvare" type="number" min={1} max={row.minutes} step={1} required value={minutes} onChange={e => setMinutes(e.target.value)}/></label>
      <p className="hr-note">La conferma registra lo straordinario approvato e aggiorna il riepilogo economico e i prossimi export Excel. Le timbrature restano invariate.</p>
      {error && <p role="alert" className="hr-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Annulla</button><button className="hr-primary" disabled={busy}>{busy ? 'Registrazione…' : 'Approva conversione'}</button></footer>
    </form>
  </dialog>;
}

export default function HrExcessOvertime({ month, employees, data, onConverted }) {
  const [rows, setRows] = useState([]), [selected, setSelected] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError('');
    try { const result = await hrRpc('workspace_hr_excess_candidates', { p_month: `${month}-01` }); if (id === generation.current) setRows(result || []); }
    catch (failure) { if (id === generation.current) { setRows([]); setError(failure.message); } }
    finally { if (id === generation.current) setLoading(false); }
  }, [month]);
  useEffect(() => { const guard = generation; const timer = setTimeout(load, 0); return () => { clearTimeout(timer); guard.current++; }; }, [load, data]);
  const visible = rows.filter(row => employees.some(e => e.user_id === row.user_id));
  const name = id => employees.find(e => e.user_id === id)?.name || 'Dipendente';
  return <section className="hr-panel"><h2>Ore eccedenti da autorizzare</h2>
    <p className="hr-muted">Proposte dalle presenze chiuse, al netto del turno e della pausa prevista. Gli intervalli già approvati o con richieste in attesa sono esclusi. Presenze incomplete e accordi non determinabili richiedono verifica.</p>
    {loading ? <p role="status">Verifica ore eccedenti…</p> : error ? <p role="alert" className="hr-error">{error} <button onClick={load}>Riprova</button></p> : visible.length ? <div className="hr-table-wrap"><table><thead><tr><th>Dipendente</th><th>Data</th><th>Ore rilevate nette</th><th>Ore turno nette</th><th>Ore convertibili</th><th data-column-control="off">Azioni</th></tr></thead><tbody>{visible.map(row => <tr key={`${row.user_id}:${row.day}`}><td>{name(row.user_id)}</td><td>{exportDate(row.day)}</td>{['worked_minutes','planned_minutes','minutes'].map(k => <td key={k}>{(row[k] / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 })}</td>)}<td><button onClick={() => setSelected(row)}>Converti in straordinario</button></td></tr>)}</tbody></table></div> : <p>Nessuna ora eccedente convertibile nel periodo selezionato.</p>}
    {selected && <Conversion row={selected} name={name(selected.user_id)} onClose={() => setSelected(null)} onSave={async () => { await onConverted(); await load(); }}/>}
  </section>;
}

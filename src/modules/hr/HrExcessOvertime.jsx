import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
      <p>Disponibili {row.minutes} minuti ({(row.minutes / 60).toLocaleString('it-IT', { useGrouping: 'always',  maximumFractionDigits: 2 })} ore). Conferma tutti i minuti oppure riduci la quantità per una conversione parziale.</p>
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
  const [expanded, setExpanded] = useState({});
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
  const grouped = new Map();
  for (const row of visible) {
    if (!grouped.has(row.user_id)) grouped.set(row.user_id, { user_id: row.user_id, days: [], worked_minutes: 0, planned_minutes: 0, minutes: 0 });
    const group = grouped.get(row.user_id);
    group.days.push(row);
    for (const key of ['worked_minutes', 'planned_minutes', 'minutes']) group[key] += Number(row[key] || 0);
  }
  const groups = [...grouped.values()].sort((a, b) => name(a.user_id).localeCompare(name(b.user_id), 'it'));
  const hours = minutes => (minutes / 60).toLocaleString('it-IT', { useGrouping: 'always',  maximumFractionDigits: 2 });
  const toggle = id => setExpanded(previous => ({ ...previous, [`${month}:${id}`]: !previous[`${month}:${id}`] }));
  return <section className="hr-panel"><h2>Ore eccedenti da autorizzare</h2>
    <p className="hr-muted">Proposte dalle presenze chiuse, al netto del turno e della pausa prevista. Gli intervalli già approvati o con richieste in attesa sono esclusi. Presenze incomplete e accordi non determinabili richiedono verifica.</p>
    {loading ? <p role="status">Verifica ore eccedenti…</p> : error ? <p role="alert" className="hr-error">{error} <button onClick={load}>Riprova</button></p> : groups.length ? <div className="hr-table-wrap"><table data-column-controls="off" aria-label="Ore eccedenti per dipendente"><thead><tr><th>Dipendente</th><th>Giorni</th><th>Ore rilevate nette</th><th>Ore turno nette</th><th>Ore convertibili</th><th>Dettaglio</th></tr></thead><tbody>{groups.map(group => {
      const isOpen = Boolean(expanded[`${month}:${group.user_id}`]);
      const detailId = `hr-excess-${group.user_id}`;
      return <Fragment key={group.user_id}>
        <tr className="hr-excess-summary" onClick={() => toggle(group.user_id)}>
          <td><strong>{name(group.user_id)}</strong></td><td>{group.days.length}</td>
          {['worked_minutes','planned_minutes','minutes'].map(key => <td key={key}>{hours(group[key])}</td>)}
          <td><button type="button" aria-expanded={isOpen} aria-controls={detailId} aria-label={`${isOpen ? 'Nascondi' : 'Mostra'} giorni di ${name(group.user_id)}`} onClick={event => { event.stopPropagation(); toggle(group.user_id); }}>{isOpen ? '▾ Nascondi giorni' : '▸ Mostra giorni'}</button></td>
        </tr>
        {isOpen && <tr className="hr-excess-detail"><td colSpan={6}><div id={detailId} className="hr-table-wrap"><table data-column-controls="off" aria-label={`Giorni di ${name(group.user_id)}`}><thead><tr><th>Data</th><th>Ore rilevate nette</th><th>Ore turno nette</th><th>Ore convertibili</th><th>Azioni</th></tr></thead><tbody>{[...group.days].sort((a,b) => a.day.localeCompare(b.day)).map(row => <tr key={row.day}><td>{exportDate(row.day)}</td>{['worked_minutes','planned_minutes','minutes'].map(key => <td key={key}>{hours(row[key])}</td>)}<td><button type="button" onClick={() => setSelected(row)}>Converti in straordinario</button></td></tr>)}</tbody></table></div></td></tr>}
      </Fragment>;
    })}</tbody></table></div> : <p>Nessuna ora eccedente convertibile nel periodo selezionato.</p>}
    {selected && <Conversion row={selected} name={name(selected.user_id)} onClose={() => setSelected(null)} onSave={async () => { await onConverted(); await load(); }}/>}
  </section>;
}

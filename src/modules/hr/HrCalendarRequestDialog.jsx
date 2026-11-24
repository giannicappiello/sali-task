import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { hrRpc } from './hrService';
import { formatDate, formatTime, timeInput } from './hrTime';
import { CALENDAR_EVENT_LABELS, calendarRequestPayload, eventDraft } from './hrMonthlyGrid.js';

export default function HrCalendarRequestDialog({ data, employee, cell, onClose, onSaved, canManage }) {
  const dialog = useRef(null), key = useRef(crypto.randomUUID());
  const [existing, setExisting] = useState(null);
  const [draft, setDraft] = useState(() => eventDraft(data, employee.user_id, cell.day));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const node = dialog.current; node.showModal(); return () => { if (node.open) node.close(); }; }, []);
  function choose(row) {
    setExisting(row); setError(''); key.current = crypto.randomUUID();
    setDraft(row ? { kind: row.kind, starts_at: timeInput(row.starts_at), ends_at: timeInput(row.ends_at), note: row.note || '', mode: 'interval', hours: '1' } : eventDraft(data, employee.user_id, cell.day));
  }
  async function save(event) {
    event.preventDefault(); if (busy || !canManage) return;
    setBusy(true); setError('');
    try {
      const payload = calendarRequestPayload(employee.user_id, draft, existing, key.current);
      const result = await hrRpc('workspace_hr_save_calendar_request', { p_data: payload });
      await onSaved(result); onClose();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="hr-dialog hr-cell-dialog" aria-labelledby="hr-cell-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h2 id="hr-cell-title">{employee.name}</h2><p className="hr-muted">{formatDate(`${cell.day}T12:00:00Z`)} · {cell.future ? 'Giorno programmato' : cell.codes.join(' · ') || 'Nessun evento'}</p></div><button type="button" aria-label="Chiudi" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <p className="hr-note">{cell.detail['Entrate / uscite'] || 'Nessuna presenza registrata.'}{cell.detail.Note ? ` · ${cell.detail.Note}` : ''}</p>
    {cell.requests.length > 0 && <section className="hr-cell-events" aria-label="Eventi del giorno"><h3>Eventi registrati</h3>{cell.requests.map(row => <div className="hr-day-detail-row" key={row.id}><strong>{CALENDAR_EVENT_LABELS[row.kind]} · {row.status === 'pending' ? 'In attesa' : 'Approvato'}</strong><span>{formatDate(row.starts_at)} {formatTime(row.starts_at)} → {formatDate(row.ends_at)} {formatTime(row.ends_at)}</span><small>{row.note}</small>{canManage && <button disabled={busy} type="button" onClick={() => choose(row)}>Modifica evento</button>}</div>)}</section>}
    {canManage && <form onSubmit={save}>
      <div className="hr-heading"><h3>{existing ? 'Modifica evento' : 'Nuovo evento'}</h3>{existing && <button type="button" disabled={busy} onClick={() => choose(null)}>Aggiungi altro evento</button>}</div>
      <fieldset disabled={busy} className="hr-form-grid">
        <label>Causale<select value={draft.kind} onChange={event => setDraft(existing ? { ...draft, kind: event.target.value, mode: 'interval' } : eventDraft(data, employee.user_id, cell.day, event.target.value))}>{Object.entries(CALENDAR_EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {draft.kind === 'overtime' && <label>Inserimento<select value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value })}><option value="duration">Numero di ore</option><option value="interval">Intervallo orario</option></select></label>}
        <label>Inizio · ora di Roma<input required type="datetime-local" value={draft.starts_at} onChange={event => setDraft({ ...draft, starts_at: event.target.value })}/></label>
        {draft.kind === 'overtime' && draft.mode === 'duration' ? <label>Ore di straordinario<input required type="number" min="0.0167" max="16" step="any" value={draft.hours} onChange={event => setDraft({ ...draft, hours: event.target.value })}/></label> : <label>Fine · ora di Roma<input required type="datetime-local" value={draft.ends_at} onChange={event => setDraft({ ...draft, ends_at: event.target.value })}/></label>}
        <label className="hr-wide">Motivazione<textarea aria-label="Motivazione" required maxLength={2000} rows={3} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })}/></label>
      </fieldset>
      <p className="hr-muted hr-small">Le variazioni sono registrate nello storico HR. Gli straordinari personali richiedono la valutazione di un altro responsabile.</p>
      {error && <p className="hr-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Annulla</button><button className="hr-primary" disabled={busy}>{busy ? 'Salvataggio…' : existing ? 'Salva modifica' : 'Salva evento'}</button></footer>
    </form>}
  </dialog>;
}

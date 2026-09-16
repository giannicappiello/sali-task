import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, MapPin, RefreshCw, Settings, Timer, UsersRound, CalendarCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import WorkspacePageHeader from '../../components/WorkspacePageHeader';
import { useHrAttendance } from './HrAttendanceProvider';
import { attendanceAnomaly, formatDate, formatTime, hrRpc, locate, monthDays, romeDay, romeInstant, timeInput } from './hrService';
import './hr.css';
import { agreementValues, agreementDisplay, overtimeValue, AGREEMENT_FIELDS } from './hrAgreements';
import { mapsSearchUrl, parseCoordinates } from './hrLocation';

const KIND = { leave: 'Ferie', permission: 'Permesso', overtime: 'Straordinario', correction: 'Correzione uscita' };
const STATUS = { pending: 'In attesa', approved: 'Approvata', rejected: 'Rifiutata', cancelled: 'Annullata' };
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const EMPTY = { employees: [], sites: [], shifts: [], attendance: [], requests: [], closures: [], contracts: [], audit: [] };
const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
function Badge({ children, kind = '' }) { return <span className={`hr-badge ${kind}`}>{children}</span>; }
function Empty({ children }) { return <p className="hr-empty">{children}</p>; }
function Editor({ model, onClose, onSave }) {
  const dialog = useRef(null);
  const [values, setValues] = useState(model.values || {});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close(); }, []);
  async function submit(event) {
    event.preventDefault(); if (saving) return; setSaving(true); setError('');
    try { await onSave(values, key.current); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="hr-dialog" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} aria-labelledby="hr-editor-title">
    <form onSubmit={submit}><header><h2 id="hr-editor-title">{model.title}</h2><button type="button" aria-label="Chiudi" onClick={onClose} disabled={saving}><X size={20}/></button></header>
      {model.description && <p className="hr-muted">{model.description}</p>}
      <div className="hr-form-grid">{model.fields.map((f) => <label key={f.key} className={f.wide ? 'hr-wide' : ''}>{f.label}
        {f.type === 'select' ? <select required={f.required !== false} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}><option value="">Seleziona…</option>{f.options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          : f.type === 'weekdays' ? <span className="hr-weekdays">{WEEKDAYS.map((label, i) => <span key={label}><input aria-label={label} type="checkbox" checked={(values[f.key] || []).includes(i + 1)} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked ? [...(values[f.key] || []), i + 1] : values[f.key].filter((v) => v !== i + 1) })}/>{label}</span>)}</span>
          : f.type === 'textarea' ? <textarea maxLength="2000" rows="3" required={f.required !== false} value={values[f.key] || ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}/>
          : <input type={f.type} min={f.min} max={f.max} step={f.type === 'number' ? 'any' : undefined} required={f.required !== false} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}/>}
      </label>)}</div>
      {model.siteLocation && <section className="hr-note"><h3>Individua la sede su Google Maps</h3><p>Inserisci l’indirizzo e apri la mappa. Da PC fai clic destro sul punto esatto e copia le coordinate; da smartphone tieni premuto sul punto e copia le coordinate del segnaposto.</p>{values.address?.trim() && <a href={mapsSearchUrl(values.address)} target="_blank" rel="noopener noreferrer">Cerca indirizzo su Google Maps ↗</a>}<label>Coordinate copiate da Google Maps<input value={values.map_point || ''} placeholder="Es. 41.9028, 12.4964" onChange={(e) => setValues({ ...values, map_point: e.target.value })}/></label><button type="button" onClick={() => { try { const point = parseCoordinates(values.map_point); setValues({ ...values, ...point }); setError(''); } catch (failure) { setError(failure.message); } }}>Usa questo punto</button>{values.latitude !== undefined && values.latitude !== '' && values.longitude !== undefined && values.longitude !== '' && <p><a href={mapsSearchUrl(values.latitude + ',' + values.longitude)} target="_blank" rel="noopener noreferrer">Verifica il punto selezionato su Google Maps ↗</a></p>}</section>}
      {error && <p role="alert" className="hr-error">{error}</p>}
      <footer><button type="button" onClick={onClose} disabled={saving}>Annulla</button><button className="hr-primary" disabled={saving}>{saving ? 'Salvataggio…' : model.submit || 'Salva'}</button></footer>
    </form>
  </dialog>;
}

export default function HrModule({ configuration = false }) {
  const { isAdminUser, profile } = useAuth();
  const monitor = useHrAttendance();
  const [data, setData] = useState(EMPTY);
  const [month, setMonth] = useState(romeDay().slice(0, 7));
  const [page, setPage] = useState(configuration ? 'employees' : 'personal');
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const generation = useRef(0);
  const punchKey = useRef(crypto.randomUUID());
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await hrRpc('workspace_hr_snapshot', { p_month: `${month}-01`, p_config: configuration });
      if (id === generation.current) { setData({ ...EMPTY, ...result }); setSelected((previous) => result.employees.some((e) => e.user_id === previous) ? previous : result.employees[0]?.user_id || ''); }
    } catch (failure) { if (id === generation.current) { setError(failure.message); setData(EMPTY); } }
    finally { if (id === generation.current) setLoading(false); }
  }, [month, configuration]);
  useEffect(() => {
    const guard = generation;
    const timer = setTimeout(load, 0);
    const refresh = () => { if (!document.hidden) void load(); };
    const poll = configuration ? null : setInterval(refresh, 60000);
    if (!configuration) window.addEventListener('workspace:hr-changed', refresh);
    if (!configuration) window.addEventListener('focus', refresh);
    return () => { guard.current++; clearTimeout(timer); clearInterval(poll); window.removeEventListener('workspace:hr-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [load, configuration]);
  const name = (id) => data.employees.find((e) => e.user_id === id)?.name || 'Dipendente';
  const siteName = (id) => data.sites.find((s) => s.id === id)?.name || 'Sede non configurata';
  const today = romeDay();
  const ownShifts = data.shifts.filter((s) => s.user_id === profile?.id);
  const ownAttendance = data.attendance.filter((a) => a.user_id === profile?.id);
  const open = monitor?.open || ownAttendance.find((a) => !a.checkout_at);
  const todayShift = ownShifts.find((s) => s.work_date === today);
  const canManage = data.manager;
  const tabs = configuration ? [['employees', UsersRound, 'Schede dipendente'], ['sites', MapPin, 'Sedi e timbrature'], ['economics', Timer, 'Riepilogo economico'], ['audit', Clock3, 'Storico modifiche']]
    : [['personal', Clock3, 'Le mie presenze'], ...(canManage ? [['attendance', UsersRound, 'Presenze aziendali']] : []), ['calendar', CalendarDays, 'Calendario e turni'], ['leave', CalendarCheck, 'Ferie e permessi'], ['overtime', Timer, 'Straordinari']];
  function show(model, save) { setEditor({ ...model, save }); }
  async function operate(action, payload) { await hrRpc('workspace_hr_operate', { p_action: action, p_data: payload }); await load(); }
  async function configure(action, payload) { await hrRpc('workspace_hr_configure', { p_action: action, p_data: payload }); await load(); }
  async function punch(action) {
    setBusy(true); setError(''); setSuccess('');
    try {
      const position = action === 'in' ? await locate() : null;
      await hrRpc('workspace_hr_punch', { p_action: action, p_key: punchKey.current, p_position: position, p_attendance_id: open?.id || null });
      punchKey.current = crypto.randomUUID();
      setSuccess(action === 'in' ? 'Check-in registrato.' : 'Checkout registrato. Controllo posizione terminato.');
      await monitor.refresh(); await load();
    } catch (failure) { setError(`${failure.message} Verifica la presenza prima di riprovare.`); if (action === 'out') throw failure; }
    finally { setBusy(false); }
  }
  function request(kind, attendance) {
    show({ title: kind === 'correction' ? 'Segnala uscita mancante' : `Richiedi ${KIND[kind].toLowerCase()}`, submit: 'Invia richiesta',
      description: 'Le date e gli orari si riferiscono al fuso Europe/Rome.',
      values: { starts_at: attendance ? timeInput(attendance.checkin_at) : `${today}T08:00`, ends_at: `${today}T17:00`, note: '' },
      fields: [...(kind !== 'correction' ? [field('starts_at', 'Dal · data e ora', 'datetime-local')] : []), field('ends_at', kind === 'correction' ? 'Uscita effettiva' : 'Al · data e ora', 'datetime-local'), field('note', 'Motivazione', 'textarea', { wide: true })] },
    (values, key) => operate('request', { ...values, starts_at: attendance?.checkin_at || romeInstant(values.starts_at), ends_at: romeInstant(values.ends_at), kind, attendance_id: attendance?.id, request_key: key }));
  }
  function review(row) {
    show({ title: `Valuta ${KIND[row.kind].toLowerCase()} · ${name(row.user_id)}`, description: `${formatDate(row.starts_at)} ${formatTime(row.starts_at)} → ${formatDate(row.ends_at)} ${formatTime(row.ends_at)}. ${row.note}`,
      fields: [field('status', 'Esito', 'select', { options: [['approved', 'Approva'], ['rejected', 'Rifiuta']] }), field('note', 'Motivazione', 'textarea')], values: { status: 'approved', note: '' } },
    (values) => operate('review', { ...values, id: row.id }));
  }
  function correctAttendance(row) {
    show({ title: `Correggi uscita · ${name(row.user_id)}`, description: `Ingresso ${formatDate(row.checkin_at)} ${formatTime(row.checkin_at)}. La correzione e la motivazione saranno registrate nello storico.`, values: { checkout_at: timeInput(new Date()), note: '' }, fields: [field('checkout_at', 'Uscita effettiva · ora di Roma', 'datetime-local'), field('note', 'Motivazione', 'textarea')] },
      (values) => operate('correct_attendance', { ...values, id: row.id, checkout_at: romeInstant(values.checkout_at) }));
  }
  function shift() {
    show({ title: 'Assegna turno', values: { user_id: selected, date_from: today, date_to: today, start_time: '08:00', end_time: '17:00', break_minutes: 60, weekdays: [1, 2, 3, 4, 5], site_id: data.sites[0]?.id || '' },
      fields: [field('user_id', 'Dipendente', 'select', { options: data.employees.filter((e) => e.active).map((e) => [e.user_id, e.name]) }), field('site_id', 'Sede', 'select', { options: data.sites.map((s) => [s.id, s.name]) }), field('date_from', 'Dal', 'date', { min: today }), field('date_to', 'Al', 'date', { min: today }), field('start_time', 'Ingresso', 'time'), field('end_time', 'Uscita', 'time'), field('break_minutes', 'Pausa non lavorata · minuti', 'number', { min: 0 }), field('weekdays', 'Giorni', 'weekdays')] },
    (values) => { if (!values.weekdays.length) throw new Error('Seleziona almeno un giorno.'); return operate('shift', values); });
  }
  function closure() {
    show({ title: 'Aggiungi chiusura / festività', values: { date_from: today, date_to: today }, fields: [field('name', 'Nome'), field('date_from', 'Dal', 'date'), field('date_to', 'Al', 'date')] }, (values) => operate('closure', values));
  }
  function editMember(member) {
    show({ title: `Scheda · ${member.name}`, values: { employee_code: member.employee_code, manager: member.manager ? 'true' : 'false' }, description: 'L’appartenenza Human Resources si assegna da Utenti e accessi. Il gestore HR amministra presenze e richieste, senza accedere a compensi e configurazioni.', fields: [field('employee_code', 'Matricola', 'text', { required: false }), field('manager', 'Permessi nel modulo HR', 'select', { options: [['false', 'Dipendente · Dati personali'], ['true', 'Gestore HR · Gestione operativa']] })] }, (values) => configure('member', { ...values, user_id: member.user_id, manager: values.manager === 'true' }));
  }
  function contract(member) {
    const current = data.contracts.find((c) => c.user_id === member.user_id);
    show({ title: `Accordi · ${member.name}`, description: 'Decorrenza anche pregressa. Gli altri campi sono facoltativi e accettano testo libero. Turni e importi automatici richiedono dati utilizzabili; i testi restano riservati agli admin.',
      values: { ...agreementValues(current, data.sites), effective_from: today },
      fields: [field('effective_from', 'Decorrenza', 'date'), ...AGREEMENT_FIELDS.map(([key, label]) => field(key, label, 'text', { required: false }))] },
      (values) => configure('contract', { ...values, user_id: member.user_id }));
  }

  function site(existing) {
    show({ title: existing ? 'Modifica sede' : 'Nuova sede', siteLocation: true, values: { checkin_radius: 30, checkout_radius: 100, ...existing, auto_checkout: existing?.auto_checkout === false ? 'false' : 'true' }, fields: [field('name', 'Nome sede'), field('address', 'Indirizzo completo', 'text', { required: false, wide: true }), field('latitude', 'Latitudine', 'number', { min: -90, max: 90 }), field('longitude', 'Longitudine', 'number', { min: -180, max: 180 }), field('checkin_radius', 'Raggio check-in · metri', 'number', { min: 10, max: 100 }), field('checkout_radius', 'Raggio checkout · metri', 'number', { min: 50, max: 1000 }), field('auto_checkout', 'Checkout automatico di supporto', 'select', { options: [['true', 'Attivo'], ['false', 'Disattivo']] })] }, (values) => configure('site', { ...values, id: existing?.id, auto_checkout: values.auto_checkout === 'true' }));
  }
  function attendanceTable(rows) {
    return rows.length ? <div className="hr-table-wrap"><table data-column-controls="off"><thead><tr><th>Dipendente / giorno</th><th>Entrata</th><th>Uscita</th><th>Stato</th><th></th></tr></thead><tbody>{rows.map((a) => <tr key={a.id}><td><strong>{name(a.user_id)}</strong><small>{formatDate(a.checkin_at)} · {siteName(a.site_id)}</small></td><td data-label="Entrata">{formatTime(a.checkin_at)}</td><td data-label="Uscita">{formatTime(a.checkout_at)}{a.checkout_at && <small>{a.checkout_kind === 'automatic' ? 'Automatica' : a.checkout_kind === 'correction' ? 'Corretta' : 'Manuale'}</small>}</td><td><Badge kind={attendanceAnomaly(a, data.shifts) ? 'amber' : a.checkout_at ? '' : 'green'}>{a.checkout_at ? 'Completa' : attendanceAnomaly(a, data.shifts) ? 'Uscita da verificare' : 'Presente'}</Badge></td><td>{!a.checkout_at && a.user_id === profile?.id && <button onClick={() => request('correction', a)}>Segnala uscita</button>}{!a.checkout_at && canManage && a.user_id !== profile?.id && <button onClick={() => correctAttendance(a)}>Correggi uscita</button>}</td></tr>)}</tbody></table></div> : <Empty>Nessuna timbratura nel periodo.</Empty>;
  }
  function requestsTable(kind) {
    const rows = data.requests.filter((r) => kind === 'overtime' ? r.kind === kind : r.kind !== 'overtime');
    return <section className="hr-panel"><div className="hr-heading"><h2>{kind === 'overtime' ? 'Straordinari' : 'Ferie, permessi e correzioni'}</h2>{data.member && <div className="hr-actions">{kind === 'overtime' ? <button className="hr-primary" onClick={() => request('overtime')}>Richiedi straordinario</button> : <><button className="hr-primary" onClick={() => request('leave')}>Richiedi ferie</button><button onClick={() => request('permission')}>Richiedi permesso</button></>}</div>}</div>{rows.length ? <div className="hr-table-wrap"><table><thead><tr><th>Dipendente</th><th>Periodo</th><th>Richiesta</th><th>Stato</th><th></th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><strong>{name(r.user_id)}</strong></td><td data-label="Periodo">{formatDate(r.starts_at)} {formatTime(r.starts_at)}<small>→ {formatDate(r.ends_at)} {formatTime(r.ends_at)}</small></td><td>{KIND[r.kind]}<small>{r.note}</small></td><td><Badge kind={r.status === 'approved' ? 'green' : r.status === 'pending' ? 'amber' : ''}>{STATUS[r.status]}</Badge>{r.review_note && <small>{r.review_note}</small>}</td><td>{canManage && r.status === 'pending' && r.user_id !== profile?.id && <button onClick={() => review(r)}>Valuta</button>}</td></tr>)}</tbody></table></div> : <Empty>Nessuna richiesta nel periodo.</Empty>}</section>;
  }
  const selectedEmployee = data.employees.find((e) => e.user_id === selected);
  const selectedContracts = data.contracts.filter((c) => c.user_id === selected);
  const calendarShifts = data.shifts.filter((s) => !canManage || !filter ? true : s.user_id === filter);
  if (configuration && !isAdminUser) return <section className="hr-page"><p role="alert">Configurazioni riservate agli admin.</p></section>;
  return <div className="hr-page">
    <WorkspacePageHeader icon={<UsersRound size={30}/>} eyebrow="Human Resources" title={configuration ? 'Configurazioni HR' : 'Presenze, turni e richieste'} description={configuration ? 'Schede dipendente e accordi contrattuali ed economici · Solo admin.' : 'Gestione del personale nel Workspace.'}/>
    {!configuration && data.member && <button className={`hr-full hr-punch-action ${open ? 'hr-checkout' : 'hr-primary'}`} disabled={busy || loading} onClick={() => open ? show({ title: 'Conferma uscita', description: 'La presenza viene chiusa all’orario corrente del server. Il controllo della posizione termina.', submit: 'Registra uscita', fields: [] }, () => punch('out')) : punch('in')}>{busy ? 'Verifica in corso…' : open ? 'Registra uscita' : 'Registra entrata'}</button>}
    <nav className="hr-nav" aria-label="Sezioni HR">{tabs.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setFilter(''); }}><span><Icon size={23}/></span>{label}</button>)}</nav>
    <div className="hr-toolbar"><label>Periodo<input type="month" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }}/></label><button onClick={load} disabled={loading}><RefreshCw size={16}/>Aggiorna</button>{isAdminUser && <Link to={configuration ? '/hr' : '/settings/hr'}><Settings size={16}/>{configuration ? 'Apri modulo HR' : 'Configurazioni HR'}</Link>}</div>
    {error && <div role="alert" className="hr-error">{error}</div>}{success && <div role="status" className="hr-success">{success}</div>}{monitor?.notice && <div role="status" className="hr-success">{monitor.notice}</div>}
    {loading ? <div className="hr-panel">Caricamento HR…</div> : !error && <>
      {page === 'personal' && <div className="hr-two-col"><section className="hr-panel"><div className="hr-heading"><h2>La mia giornata</h2><Badge kind={open ? 'green' : ''}>{open ? 'Presente' : 'Non presente'}</Badge></div><p className="hr-muted">{formatDate(new Date())}</p>{!data.member ? <Empty>Per timbrare devi essere assegnato al reparto Human Resources da Utenti e accessi.</Empty> : <><div className="hr-clock">{open ? formatTime(open.checkin_at) : '—'}</div><p className="hr-muted">{open ? `Ingresso del ${formatDate(open.checkin_at)}` : 'Nessuna presenza aperta'}</p><div className="hr-shift"><span>Turno assegnato<strong>{todayShift ? `${formatTime(todayShift.starts_at)} – ${formatTime(todayShift.ends_at)}` : month === today.slice(0, 7) ? 'Nessun turno oggi' : 'Seleziona il mese corrente'}</strong></span><span>Pausa prevista<strong>{todayShift ? `${todayShift.break_minutes} min` : '—'}</strong></span></div>{open && <p className="hr-location"><MapPin size={18}/>{siteName(open.site_id)} · Ingresso verificato</p>}<p className="hr-muted hr-small">{monitor?.status}</p><div className="hr-note">Ricorda il checkout manuale. Quello automatico oltre la soglia configurata è un supporto: può non intervenire a schermo spento o quando Workspace è sospeso.</div></>}</section><section className="hr-panel"><h2>Le mie presenze</h2>{attendanceTable(ownAttendance)}</section></div>}
      {page === 'attendance' && canManage && <section className="hr-panel"><div className="hr-heading"><h2>Presenze aziendali</h2><input aria-label="Cerca dipendente" placeholder="Cerca dipendente…" value={filter} onChange={(e) => setFilter(e.target.value)}/></div>{attendanceTable(data.attendance.filter((a) => name(a.user_id).toLowerCase().includes(filter.toLowerCase())))}</section>}
      {page === 'calendar' && <section className="hr-panel"><div className="hr-heading"><h2>Calendario aziendale</h2>{canManage && <div className="hr-actions"><button onClick={closure}>Chiusura / festività</button><button className="hr-primary" onClick={shift} disabled={!data.sites.length || !data.employees.length}>Assegna turno</button></div>}</div>{canManage && <label className="hr-calendar-filter">Dipendente<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Tutti</option>{data.employees.map((e) => <option key={e.user_id} value={e.user_id}>{e.name}</option>)}</select></label>}<div className="hr-calendar">{WEEKDAYS.map((d) => <div className="hr-calendar-label" key={d}>{d}</div>)}{Array.from({ length: (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <div key={`blank${i}`}/>)}{monthDays(month).map((day) => { const shifts = calendarShifts.filter((s) => s.work_date === day); const leave = data.requests.filter((r) => ['leave', 'permission'].includes(r.kind) && r.status === 'approved' && romeDay(r.starts_at) <= day && romeDay(new Date(Date.parse(r.ends_at) - 1)) >= day && (!canManage || !filter || r.user_id === filter)); const closures = data.closures.filter((c) => c.date_from <= day && c.date_to >= day); return <div key={day} className={`hr-calendar-day ${day === today ? 'today' : ''}`}><strong>{day.slice(-2)}</strong>{closures.map((c) => <span className="hr-event closure" key={c.id}>{c.name}</span>)}{shifts.map((s) => <span className="hr-event" key={s.user_id}>{canManage && <b>{name(s.user_id)}<br/></b>}{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span>)}{leave.map((r) => <span className="hr-event leave" key={r.id}>{canManage ? `${name(r.user_id)} · ` : ''}{KIND[r.kind]}</span>)}</div>; })}</div>{!calendarShifts.length && <Empty>Nessun turno: l’admin può configurare gli orari e il gestore HR assegnare turni specifici.</Empty>}</section>}
      {page === 'leave' && requestsTable('leave')}{page === 'overtime' && requestsTable('overtime')}
      {configuration && page === 'employees' && <div className="hr-master-detail"><section className="hr-panel"><h2>Dipendenti HR</h2><Link to="/settings/users">Assegna utenti al reparto</Link>{data.employees.map((e) => <button className={`hr-person ${selected === e.user_id ? 'active' : ''}`} key={e.user_id} onClick={() => setSelected(e.user_id)}><strong>{e.name}</strong><small>{e.department || 'Nessun reparto operativo'} · {e.active ? 'Attivo' : 'Non attivo'}</small></button>)}</section><section className="hr-panel">{selectedEmployee ? <><div className="hr-heading"><h2>{selectedEmployee.name}</h2><button onClick={() => editMember(selectedEmployee)}>Modifica scheda</button></div><p>Matricola: {selectedEmployee.employee_code || '—'}</p><p>Appartenenza aggiuntiva: <strong>Human Resources</strong></p><p>Ruolo HR: <strong>{selectedEmployee.manager ? 'Gestore HR' : 'Dipendente'}</strong></p><div className="hr-heading"><h2>Accordi contrattuali ed economici</h2><button className="hr-primary" onClick={() => contract(selectedEmployee)}>Nuova versione accordi</button></div>{!data.sites.length && <p className="hr-note">Puoi salvare gli accordi anche senza sede. Per le timbrature configura una sede in Sedi e timbrature.</p>}{selectedContracts.length ? selectedContracts.map((c) => <article className="hr-contract" key={c.id}><h3>Decorrenza {formatDate(c.effective_from)}</h3>{AGREEMENT_FIELDS.map(([key, label]) => <p key={key}>{label}: <strong>{agreementDisplay(c, key, data.sites)}</strong></p>)}<p className="hr-muted">I campi descrittivi o incompleti non producono turni o importi automatici.</p></article>) : <Empty>Nessun accordo configurato.</Empty>}</> : <Empty>Assegna gli utenti al reparto Human Resources da Utenti e accessi.</Empty>}</section></div>}
      {configuration && page === 'sites' && <section className="hr-panel"><div className="hr-heading"><h2>Sedi e timbrature</h2><button className="hr-primary" onClick={() => site()}>Nuova sede</button></div>{data.sites.map((s) => <article className="hr-contract" key={s.id}><div className="hr-heading"><h3>{s.name}</h3><button onClick={() => site(s)}>Modifica</button></div><p>{s.address}</p><p><a href={mapsSearchUrl(s.latitude + ',' + s.longitude)} target="_blank" rel="noopener noreferrer">{s.latitude}, {s.longitude} · Apri Google Maps ↗</a></p><p>Check-in entro {s.checkin_radius} m · Checkout automatico oltre {s.checkout_radius} m · {s.auto_checkout ? 'Supporto attivo' : 'Disattivo'}</p></article>)}{!data.sites.length && <Empty>Inserisci le coordinate reali della sede per abilitare il check-in.</Empty>}<div className="hr-note">Il checkout principale è manuale. L’uscita automatica richiede due rilevazioni attendibili distanziate di almeno 30 secondi. Una posizione mancante non chiude la presenza. Le presenze già aperte mantengono la sede verificata al check-in.</div></section>}
      {configuration && page === 'economics' && <section className="hr-panel"><h2>Straordinari approvati · {month}</h2><p className="hr-muted">Valorizzazione delle ore autorizzate, da verificare con le presenze effettive prima del pagamento.</p><div className="hr-table-wrap"><table><thead><tr><th>Dipendente / data</th><th>Ore autorizzate</th><th>Gestione</th><th>Valore indicativo</th></tr></thead><tbody>{data.requests.filter((r) => r.kind === 'overtime' && r.status === 'approved').map((r) => { const c = data.contracts.find((c) => c.user_id === r.user_id && c.effective_from <= romeDay(r.starts_at)); const hours = (Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 3600000; return <tr key={r.id}><td>{name(r.user_id)}<small>{formatDate(r.starts_at)}</small></td><td>{hours.toLocaleString('it-IT', { maximumFractionDigits: 2 })}</td><td>{c ? agreementDisplay(c, 'overtime_mode', data.sites) : 'Accordo mancante'}</td><td>{overtimeValue(c, hours)}</td></tr>; })}</tbody></table></div></section>}
      {configuration && page === 'audit' && <section className="hr-panel"><h2>Ultime 100 modifiche</h2>{data.audit.map((a) => <div className="hr-contract" key={a.id}><strong>{a.action}</strong><p>{formatDate(a.created_at)} {formatTime(a.created_at)} · {data.users?.find((u) => u.id === a.actor_id)?.name || a.actor_id}</p><small>Riferimento: {a.target_id}</small></div>)}{!data.audit.length && <Empty>Nessuna modifica registrata.</Empty>}</section>}
    </>}
    {editor && <Editor model={editor} onClose={() => setEditor(null)} onSave={editor.save}/>}
  </div>;
}

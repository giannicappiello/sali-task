import HrEmployeeDetails from './HrEmployeeDetails';
import CompanyCalendar from './CompanyCalendar';
import { companyCalendarDay } from './companyCalendarDay';
import { shiftDate, mondayOf, formatMinutes, agreementMinutes, minutesBetween, selectedMonthSnapshot } from './hrWeek';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, MapPin, RefreshCw, Search, Settings, Timer, UsersRound, CalendarCheck, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import WorkspacePageHeader from '../../components/WorkspacePageHeader';
import { useHrAttendance } from './HrAttendanceProvider';
import { attendanceAnomaly, formatDate, formatTime, hrRpc, hrNetwork, monthDays, romeDay, romeInstant, timeInput } from './hrService';
import './hr.css';
import { downloadAttendanceWorkbook } from './hrAttendanceExport';
import { agreementValues, agreementDisplay, overtimeValue, AGREEMENT_FIELDS } from './hrAgreements';
import { mapsSearchUrl, parseCoordinates } from './hrLocation';
import { sortHrPeople } from './hrPeople';
import { ABSENCE_KINDS, absenceCoversDay, plannedPresentCount, unjustifiedAbsences } from './hrCalendarPresence';

const KIND = { leave: 'Ferie', permission: 'Permesso', illness: 'Malattia', pregnancy: 'Maternità', unjustified: 'Assente ingiustificato', overtime: 'Straordinario', correction: 'Correzione uscita' };
const STATUS = { pending: 'In attesa', approved: 'Approvata', rejected: 'Rifiutata', cancelled: 'Annullata' };
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const EMPTY = { employees: [], sites: [], shifts: [], attendance: [], requests: [], closures: [], contracts: [], audit: [], calendarAttendance: [], calendarShifts: [], calendarRequests: [] };
const searchable = (value) => (value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).toLocaleLowerCase('it-IT').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
const weekLabel = (start) => `${formatDate(`${start}T12:00:00Z`)} – ${formatDate(`${shiftDate(start, 6)}T12:00:00Z`)}`;
function Badge({ children, kind = '' }) { return <span className={`hr-badge ${kind}`}>{children}</span>; }
function Empty({ children }) { return <p className="hr-empty">{children}</p>; }
function AttendanceDayDialog({ detail, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  if (!detail) return null;
  return <dialog ref={dialog} className="hr-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="hr-attendance-day-title">
    <header><h2 id="hr-attendance-day-title">Dettaglio presenze · {detail.label}</h2><button type="button" aria-label="Chiudi" onClick={onClose}><X size={20}/></button></header>
    <p className="hr-muted">Dati HR autorizzati del giorno selezionato · Europe/Rome</p>
    <section aria-labelledby="hr-attendance-present-title"><h3 id="hr-attendance-present-title">Presenti</h3>{detail.present.length ? detail.present.map(row => <div className="hr-day-detail-row" key={row.id}><strong>{detail.name(row.user_id)}</strong><span>Entrata: {formatTime(row.checkin_at)} · Uscita: {row.checkout_at ? formatTime(row.checkout_at) : 'Presenza ancora aperta'}</span></div>) : <Empty>Nessuna presenza registrata.</Empty>}</section>
    <section aria-labelledby="hr-attendance-absent-title"><h3 id="hr-attendance-absent-title">Assenti</h3>{detail.absent.length ? detail.absent.map(row => <div className="hr-day-detail-row absent" key={row.id}><strong>{detail.name(row.user_id)}</strong><span>{row.kind === 'unjustified' ? `Assenza non giustificata · Motivazione: ${row.note || 'non indicata'}` : `${KIND[row.kind] || 'Assenza'} · Motivazione: ${row.note || 'non indicata'}`}</span>{row.kind === 'permission' && <small>{formatTime(row.starts_at)}–{formatTime(row.ends_at)}</small>}</div>) : <Empty>Nessuna assenza disponibile nei dati HR.</Empty>}</section>
    <footer><button type="button" className="hr-primary" onClick={onClose}>Chiudi</button></footer>
  </dialog>;
}
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
      {model.summary && <p className="hr-note"><strong>Riepilogo prima del salvataggio</strong><br/>{model.summary(values)}</p>}
      <div className="hr-form-grid">{model.fields.map((f) => f.type === 'multiselect' ? <fieldset key={f.key} className="hr-wide"><legend>{f.label}</legend><span className="hr-recipient-list">{f.options.map(([id, name]) => <label key={id}><input type="checkbox" checked={(values[f.key] || []).includes(id)} onChange={(e) => setValues(previous => ({ ...previous, [f.key]: e.target.checked ? [...(previous[f.key] || []), id] : previous[f.key].filter(value => value !== id) }))}/>{name}</label>)}</span></fieldset> : <label key={f.key} className={f.wide ? 'hr-wide' : ''}>{f.label}
        {f.type === 'select' ? <select required={f.required !== false} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}><option value="">Seleziona…</option>{f.options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          : f.type === 'weekdays' ? <span className="hr-weekdays">{WEEKDAYS.map((label, i) => <span key={label}><input aria-label={label} type="checkbox" checked={(values[f.key] || []).includes(i + 1)} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked ? [...(values[f.key] || []), i + 1] : values[f.key].filter((v) => v !== i + 1) })}/>{label}</span>)}</span>
          : f.type === 'textarea' ? <textarea maxLength="2000" rows="3" required={f.required !== false} value={values[f.key] || ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}/>
          : <input type={f.type} min={f.min} max={f.max} step={f.type === 'number' ? 'any' : undefined} required={f.required !== false} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}/>}
      </label>)}</div>
      {model.siteLocation && <section className="hr-note"><h3>Rete aziendale</h3><p>Inserisci gli IP pubblici della sede, uno per riga. Entrata e uscita manuali richiedono questa rete, anche da smartphone. Usa il rilevamento solo quando sei fisicamente in azienda e senza VPN.</p><button type="button" disabled={saving} onClick={async () => { setSaving(true); setError(''); try { const result = await hrNetwork(); setValues(previous => ({ ...previous, public_ips: [...new Set([...(previous.public_ips || '').split(/[\s,;]+/).filter(Boolean), result.ip])].join('\n') })); } catch (failure) { setError(failure.message); } finally { setSaving(false); } }}>Usa IP attuale</button><p>Controlla l’elenco e premi Salva per applicare gli IP rilevati. Un elenco vuoto blocca le timbrature manuali.</p></section>}
      {model.siteLocation && <section className="hr-note"><h3>Individua la sede su Google Maps</h3><p>Inserisci l’indirizzo e apri la mappa. Da PC fai clic destro sul punto esatto e copia le coordinate; da smartphone tieni premuto sul punto e copia le coordinate del segnaposto.</p>{values.address?.trim() && <a href={mapsSearchUrl(values.address)} target="_blank" rel="noopener noreferrer">Cerca indirizzo su Google Maps ↗</a>}<label>Coordinate copiate da Google Maps<input value={values.map_point || ''} placeholder="Es. 41.9028, 12.4964" onChange={(e) => setValues({ ...values, map_point: e.target.value })}/></label><button type="button" onClick={() => { try { const point = parseCoordinates(values.map_point); setValues({ ...values, ...point }); setError(''); } catch (failure) { setError(failure.message); } }}>Usa questo punto</button>{values.latitude !== undefined && values.latitude !== '' && values.longitude !== undefined && values.longitude !== '' && <p><a href={mapsSearchUrl(values.latitude + ',' + values.longitude)} target="_blank" rel="noopener noreferrer">Verifica il punto selezionato su Google Maps ↗</a></p>}</section>}
      {error && <p role="alert" className="hr-error">{error}</p>}
      <footer><button type="button" onClick={onClose} disabled={saving}>Annulla</button><button className="hr-primary" disabled={saving}>{saving ? 'Salvataggio…' : model.submit || 'Salva'}</button></footer>
    </form>
  </dialog>;
}

export default function HrModule({ configuration = false }) {
  const { isAdminUser, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const monitor = useHrAttendance();
  const [data, setData] = useState(EMPTY);
  const [month, setMonth] = useState(romeDay().slice(0, 7));
  const [weekStart, setWeekStart] = useState(() => mondayOf(romeDay()));
  const [calendarView, setCalendarView] = useState(() => configuration ? 'week' : 'month');
  const [page, setPage] = useState(configuration ? 'employees' : ['leave','overtime'].includes(searchParams.get('richieste')) ? searchParams.get('richieste') : 'personal');
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [hrSearch, setHrSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [attendanceDayDetail, setAttendanceDayDetail] = useState(null);
  const [reportRange, setReportRange] = useState('week');
  const [reportFrom, setReportFrom] = useState(() => mondayOf(romeDay()));
  const [reportTo, setReportTo] = useState(() => shiftDate(mondayOf(romeDay()), 6));
  const generation = useRef(0);
  const punchKey = useRef(crypto.randomUUID());
  const calendarActive = page === 'company-calendar';
  const load = useCallback(async (silent = false) => {
    const id = ++generation.current;
    if (silent !== true) { setLoading(true); setError(''); }
    try {
      const monthDate = new Date(`${month}-01T12:00:00Z`);
      const requestedMonths = (calendarActive ? [-1, 0, 1] : [0]).map((offset) => { const date = new Date(monthDate); date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString().slice(0, 7); });
      const [snapshots, calendar] = await Promise.allSettled([
        Promise.all(requestedMonths.map((requestedMonth) => hrRpc('workspace_hr_snapshot', { p_month: `${requestedMonth}-01`, p_config: configuration }))),
        hrRpc('workspace_company_calendar_read'),
      ]);
      if (snapshots.status === 'rejected') throw snapshots.reason;
      const sources = snapshots.value;
      const mergeRows = (key) => [...new Map(sources.flatMap((source) => source?.[key] || []).map((row, index) => [row.id || `${row.user_id || ''}:${row.work_date || row.checkin_at || index}`, row])).values()];
      const result = sortHrPeople(selectedMonthSnapshot(requestedMonths, sources, month));
      result.calendarAttendance = mergeRows('attendance');
      result.calendarShifts = mergeRows('shifts');
      result.calendarRequests = mergeRows('requests');
      result.companyCalendar = calendar.status === 'fulfilled' ? calendar.value : null;
      if (id === generation.current) { setData({ ...EMPTY, ...result }); setSelected((previous) => result.employees.some((e) => e.user_id === previous) ? previous : result.employees[0]?.user_id || ''); }
    } catch (failure) { if (id === generation.current && silent !== true) { setError(failure.message); setData(EMPTY); } }
    finally { if (id === generation.current) setLoading(false); }
  }, [month, configuration, calendarActive]);
  useEffect(() => {
    const guard = generation;
    const timer = setTimeout(load, 0);
    const refresh = () => { void load(true); };
    if (!configuration) window.addEventListener('workspace:hr-changed', refresh);
    return () => { guard.current++; clearTimeout(timer); window.removeEventListener('workspace:hr-changed', refresh); };
  }, [load, configuration]);
  const name = (id) => data.employees.find((e) => e.user_id === id)?.name || 'Dipendente';
  const siteName = (id) => data.sites.find((s) => s.id === id)?.name || 'Sede non configurata';
  const today = romeDay();
  const ownShifts = data.shifts.filter((s) => s.user_id === profile?.id);
  const ownAttendance = data.attendance.filter((a) => a.user_id === profile?.id);
  const open = monitor?.open || ownAttendance.find((a) => !a.checkout_at);
  const todayShift = ownShifts.find((s) => s.work_date === today);
  const canManage = data.manager;
  const tabs = configuration ? [['employees', UsersRound, 'Schede dipendente'], ['company-calendar', CalendarDays, 'Calendario aziendale'], ['sites', MapPin, 'Sedi e timbrature'], ['export', CalendarDays, 'Esporta presenze'], ['economics', Timer, 'Riepilogo economico']]
    : [['personal', Clock3, 'Le mie presenze'], ['leave', CalendarCheck, 'Ferie e permessi'], ['overtime', Timer, 'Straordinari']];
  function show(model, save) { setEditor({ ...model, save }); }
  async function operate(action, payload) { await hrRpc('workspace_hr_operate', { p_action: action, p_data: payload }); await load(true); }
  async function configure(action, payload) { await hrRpc('workspace_hr_configure', { p_action: action, p_data: payload }); await load(); }
  async function punch(action) {
    setBusy(true); setError(''); setSuccess('');
    try {
      await hrNetwork({ action, key: punchKey.current, attendance_id: open?.id || null });
      punchKey.current = crypto.randomUUID();
      setSuccess(action === 'in' ? 'Check-in registrato.' : 'Checkout registrato. Controllo posizione terminato.');
      await monitor.refresh(); await load(true);
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
  function scheduleAbsence() {
    show({ title: 'Nuova assenza', submit: 'Salva assenza',
      description: 'L’assenza viene registrata come approvata e sarà visibile nell’elenco e nel calendario. Le date e gli orari usano Europe/Rome.',
      summary: (values) => `${data.employees.find((employee) => employee.user_id === values.user_id)?.name || 'Dipendente da selezionare'} · ${KIND[values.kind] || 'Causale da selezionare'} · ${values.starts_at || 'Data iniziale da selezionare'} → ${values.ends_at || 'Data finale da selezionare'}`,
      values: { user_id: selected, kind: 'leave', starts_at: `${today}T08:00`, ends_at: `${today}T17:00`, note: '' },
      fields: [field('user_id', 'Dipendente', 'select', { options: data.employees.filter((e) => e.active).map((e) => [e.user_id, e.name]) }),
        field('kind', 'Causale', 'select', { options: [['leave', 'Ferie'], ['permission', 'Permesso'], ['illness', 'Malattia'], ['pregnancy', 'Maternità']] }), // legacy label: ['pregnancy', 'Gravidanza']
        field('starts_at', 'Dal · data e ora', 'datetime-local'), field('ends_at', 'Al · data e ora', 'datetime-local'),
        field('note', 'Motivazione', 'textarea', { wide: true })] },
      (values, key) => hrRpc('workspace_hr_admin_request', { p_data: { ...values, starts_at: romeInstant(values.starts_at), ends_at: romeInstant(values.ends_at), request_key: key } }).then(() => load(true)));
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
    const current = data.contracts.find((c) => c.user_id === member.user_id);
    const initial = { ...agreementValues(current, data.sites), effective_from: current?.effective_from || '' };
    show({ title: `Scheda e accordi · ${member.name}`, description: 'Scheda dipendente e accordi riservati agli admin. La decorrenza può essere pregressa; gli altri campi degli accordi sono facoltativi e accettano testo libero. Le modifiche agli accordi conservano le versioni precedenti.',
      values: { ...initial, employee_code: member.employee_code || '', manager: member.manager ? 'true' : 'false', reviewer_ids: member.reviewer_ids || [] },
      fields: [field('reviewer_ids', 'Responsabili richieste · ferie, permessi, straordinari e correzioni', 'multiselect', { options: (data.users || []).filter(u => u.id !== member.user_id).map(u => [u.id, u.name]), wide: true }), field('employee_code', 'Matricola', 'text', { required: false }), field('manager', 'Permessi nel modulo HR', 'select', { options: [['false', 'Dipendente · Dati personali'], ['true', 'Gestore HR · Gestione operativa']] }), field('effective_from', 'Accordi contrattuali ed economici · Decorrenza', 'date', { required: false, wide: true }), ...AGREEMENT_FIELDS.map(([key, label]) => field(key, label, 'text', { required: false }))] },
      async (values, key) => {
        const changed = Object.keys(initial).some(k => values[k] !== initial[k]);
        if (changed && !values.effective_from) throw new Error('Indica la decorrenza degli accordi.');
        await hrRpc('workspace_hr_save_employee', { p_key: key, p_data: { user_id: member.user_id, employee_code: values.employee_code, reviewer_ids: values.reviewer_ids || [], manager: values.manager === 'true', contract_id: current?.id || null, ...(changed ? { contract: Object.fromEntries(Object.keys(initial).map(k => [k, values[k]])) } : {}) } });
        await load();
      });
  }

  function site(existing) {
    show({ title: existing ? 'Modifica sede' : 'Nuova sede', siteLocation: true, values: { checkin_radius: 30, checkout_radius: 100, ...existing, public_ips: (existing?.public_ips || []).join('\n'), auto_checkout: existing?.auto_checkout === false ? 'false' : 'true' }, fields: [field('name', 'Nome sede'), field('public_ips', 'IP pubblici aziendali autorizzati · uno per riga', 'textarea', { required: false, wide: true }), field('address', 'Indirizzo completo', 'text', { required: false, wide: true }), field('latitude', 'Latitudine', 'number', { min: -90, max: 90 }), field('longitude', 'Longitudine', 'number', { min: -180, max: 180 }), field('checkout_radius', 'Raggio checkout · metri', 'number', { min: 50, max: 1000 }), field('auto_checkout', 'Checkout automatico di supporto', 'select', { options: [['true', 'Attivo'], ['false', 'Disattivo']] })] }, (values) => configure('site', { ...values, public_ips: [...new Set((values.public_ips || '').split(/[\s,;]+/).filter(Boolean))], id: existing?.id, auto_checkout: values.auto_checkout === 'true' }));
  }
  function attendanceTable(rows) {
    return rows.length ? <div className="hr-table-wrap"><table data-column-controls="off"><thead><tr><th>Dipendente / giorno</th><th>Entrata</th><th>Uscita</th><th>Stato</th><th></th></tr></thead><tbody>{rows.map((a) => <tr key={a.id}><td><strong>{name(a.user_id)}</strong><small>{formatDate(a.checkin_at)} · {siteName(a.site_id)}</small></td><td data-label="Entrata">{formatTime(a.checkin_at)}</td><td data-label="Uscita">{formatTime(a.checkout_at)}{a.checkout_at && <small>{a.checkout_kind === 'automatic' ? 'Automatica' : a.checkout_kind === 'correction' ? 'Corretta' : 'Manuale'}</small>}</td><td><Badge kind={attendanceAnomaly(a, data.shifts) ? 'amber' : a.checkout_at ? '' : 'green'}>{a.checkout_at ? 'Completa' : attendanceAnomaly(a, data.shifts) ? 'Uscita da verificare' : 'Presente'}</Badge></td><td>{!a.checkout_at && a.user_id === profile?.id && <button onClick={() => request('correction', a)}>Segnala uscita</button>}{!a.checkout_at && canManage && a.user_id !== profile?.id && <button onClick={() => correctAttendance(a)}>Correggi uscita</button>}</td></tr>)}</tbody></table></div> : <Empty>Nessuna timbratura nel periodo.</Empty>;
  }
  function requestsTable(kind) {
    const rows = data.requests.filter((r) => kind === 'overtime' ? r.kind === kind : ABSENCE_KINDS.includes(r.kind) || r.kind === 'correction');
    return <section className="hr-panel"><div className="hr-heading"><h2>{kind === 'overtime' ? 'Straordinari' : 'Ferie, permessi e altre assenze'}</h2>{data.member && <div className="hr-actions">{kind === 'overtime' ? <button className="hr-primary" onClick={() => request('overtime')}>Richiedi straordinario</button> : <>{canManage && <button className="hr-primary" onClick={scheduleAbsence}>Nuova assenza</button>}{data.member && <><button className={canManage ? '' : 'hr-primary'} onClick={() => request('leave')}>Richiedi ferie</button><button onClick={() => request('permission')}>Richiedi permesso</button><button onClick={() => request('illness')}>Richiedi malattia</button><button onClick={() => request('pregnancy')}>Richiedi maternità</button></>}</>}</div>}</div>{rows.length ? <div className="hr-table-wrap"><table><thead><tr><th>Dipendente</th><th>Periodo</th><th>Richiesta</th><th>Stato</th><th data-column-control="off" aria-label="Azioni"></th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><strong>{name(r.user_id)}</strong></td><td data-label="Periodo">{formatDate(r.starts_at)} {formatTime(r.starts_at)}<small>→ {formatDate(r.ends_at)} {formatTime(r.ends_at)}</small></td><td>{KIND[r.kind]}<small>{r.note}</small></td><td><Badge kind={r.status === 'approved' ? 'green' : r.status === 'pending' ? 'amber' : ''}>{STATUS[r.status]}</Badge>{r.review_note && <small>{r.review_note}</small>}</td><td>{r.can_review && r.status === 'pending' && r.user_id !== profile?.id && <button onClick={() => review(r)}>Valuta</button>}</td></tr>)}</tbody></table></div> : <Empty>Nessuna richiesta nel periodo.</Empty>}</section>;
  }
  const searchTerm = searchable(hrSearch.trim());
  const visibleEmployees = !configuration || !searchTerm ? data.employees : data.employees.filter((employee) => {
    const relatedContracts = data.contracts.filter((contract) => contract.user_id === employee.user_id);
    const relatedReviewers = (employee.reviewer_ids || []).map((id) => data.users?.find((user) => user.id === id)?.name || id);
    const relatedSites = relatedContracts.map((contract) => siteName(contract.site_id));
    return searchable([employee, relatedContracts, relatedReviewers, relatedSites]).includes(searchTerm);
  });
  const selectedEmployee = visibleEmployees.find((e) => e.user_id === selected);
  const selectedContracts = data.contracts.filter((c) => c.user_id === selected);
  const calendarShifts = data.shifts.filter((s) => !canManage || !filter ? true : s.user_id === filter);
  const calendarAttendance = data.calendarAttendance || data.attendance;
  const calendarShiftRows = data.calendarShifts || data.shifts;
  const calendarRequestRows = data.calendarRequests || data.requests;
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const contractFor = (userId, day) => data.contracts.filter((contract) => contract.user_id === userId && contract.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const weekRows = weekDays.map((day) => {
    const present = calendarAttendance.filter((row) => romeDay(row.checkin_at) === day && (!filter || row.user_id === filter));
    const approved = calendarRequestRows.filter((row) => absenceCoversDay(row, day) && (!filter || row.user_id === filter));
    const derived = unjustifiedAbsences({ day, shifts: calendarShiftRows, attendance: calendarAttendance, absences: calendarRequestRows, closures: data.closures, companyCalendarDay: companyCalendarDay(data.companyCalendar, day), asOf: today }).filter(row => !filter || row.user_id === filter);
    return { day, present, absent: [...approved, ...derived] };
  });
  const reportDates = reportRange === 'week'
    ? weekDays
    : reportRange === 'month'
      ? monthDays(month)
      : (() => { const dates = []; let cursor = reportFrom; if (!/^\d{4}-\d{2}-\d{2}$/.test(reportFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(reportTo) || reportFrom > reportTo) return dates; while (cursor <= reportTo && dates.length < 366) { dates.push(cursor); cursor = shiftDate(cursor, 1); } return dates; })();
  const reportRows = data.employees.map(employee => {
    const employeeAttendance = calendarAttendance.filter(row => row.user_id === employee.user_id);
    const employeeShifts = calendarShiftRows.filter(row => row.user_id === employee.user_id);
    let worked = 0; let expected = 0; let hasIncomplete = false;
    for (const day of reportDates) {
      const dayAttendance = employeeAttendance.filter(row => romeDay(row.checkin_at) === day);
      const dayShifts = employeeShifts.filter(row => row.work_date === day);
      for (const row of dayAttendance) {
        if (!row.checkout_at) { hasIncomplete = true; continue; }
        const shiftRow = dayShifts.find(item => item.user_id === employee.user_id);
        worked += minutesBetween(row.checkin_at, row.checkout_at) - Number(shiftRow?.break_minutes || 0);
      }
      const agreement = agreementMinutes(contractFor(employee.user_id, day), day);
      if (agreement != null) expected += agreement;
      else expected += dayShifts.reduce((total, shift) => total + minutesBetween(shift.starts_at, shift.ends_at) - Number(shift.break_minutes || 0), 0);
    }
    return { employee, worked, expected, difference: worked - expected, hasIncomplete };
  }).filter(row => row.expected || row.worked || row.hasIncomplete);
  const reportTotals = reportRows.reduce((totals, row) => ({
    extra: totals.extra + (row.difference > 0 ? row.difference : 0),
    shortage: totals.shortage + (row.difference < 0 ? Math.abs(row.difference) : 0),
  }), { extra: 0, shortage: 0 });
  const openAttendanceDay = (day, present, absent) => setAttendanceDayDetail({
    label: new Date(`${day}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    present, absent, name,
  });
  if (configuration && !isAdminUser) return <section className="hr-page"><p role="alert">Configurazioni riservate agli admin.</p></section>;
  return <div className="hr-page">
    <WorkspacePageHeader icon={<UsersRound size={30}/>} eyebrow="Human Resources" title={configuration ? 'Configurazioni HR' : 'Presenze, turni e richieste'} description={configuration ? 'Schede dipendente e accordi contrattuali ed economici · Solo admin.' : 'Gestione del personale nel Workspace.'}/>
    {configuration && <div className="hr-global-search" role="search"><Search size={19} aria-hidden="true"/><label htmlFor="hr-global-search-input">Ricerca rapida HR</label><input id="hr-global-search-input" type="search" value={hrSearch} onChange={(event) => setHrSearch(event.target.value)} placeholder="Cerca dipendente, matricola, reparto o accordo…" autoComplete="off"/>{hrSearch && <button type="button" aria-label="Svuota ricerca HR" onClick={() => setHrSearch('')}><X size={17}/></button>}</div>}
    {!configuration && data.member && <button className={`hr-full hr-punch-action ${open ? 'hr-checkout' : 'hr-primary'}`} disabled={busy || loading} onClick={() => open ? show({ title: 'Conferma uscita', description: 'La presenza viene chiusa all’orario corrente del server. Il controllo della posizione termina.', submit: 'Registra uscita', fields: [] }, () => punch('out')) : punch('in')}>{busy ? 'Verifica in corso…' : open ? 'Registra uscita' : 'Registra entrata'}</button>}
    <div className="hr-controls"><nav className="hr-nav" aria-label="Sezioni HR">{tabs.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setFilter(''); if (id === 'company-calendar') setCalendarView('week'); }}><span><Icon size={23}/></span>{label}</button>)}</nav>
    <div className="hr-toolbar"><label>Periodo<input type="month" value={month} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setWeekStart(mondayOf(`${e.target.value}-01`)); } }}/></label><button onClick={load} disabled={loading}><RefreshCw size={16}/>Aggiorna</button>{isAdminUser && <Link to={configuration ? '/hr' : '/settings/hr'}><Settings size={16}/>{configuration ? 'Apri modulo HR' : 'Configurazioni HR'}</Link>}</div></div>
    {error && <div role="alert" className="hr-error">{error}</div>}{success && <div role="status" className="hr-success">{success}</div>}{monitor?.notice && <div role="status" className="hr-success">{monitor.notice}</div>}
    {loading ? <div className="hr-panel">Caricamento HR…</div> : !error && <>
      {page === 'personal' && <div className="hr-two-col"><section className="hr-panel"><div className="hr-heading"><h2>La mia giornata</h2><Badge kind={open ? 'green' : ''}>{open ? 'Presente' : 'Non presente'}</Badge></div><p className="hr-muted">{formatDate(new Date())}</p>{!data.member ? <Empty>Per timbrare devi essere assegnato al reparto Human Resources da Utenti e accessi.</Empty> : <><div className="hr-clock">{open ? formatTime(open.checkin_at) : '—'}</div><p className="hr-muted">{open ? `Ingresso del ${formatDate(open.checkin_at)}` : 'Nessuna presenza aperta'}</p><div className="hr-shift"><span>Turno assegnato<strong>{todayShift ? `${formatTime(todayShift.starts_at)} – ${formatTime(todayShift.ends_at)}` : month === today.slice(0, 7) ? 'Nessun turno oggi' : 'Seleziona il mese corrente'}</strong></span><span>Pausa prevista<strong>{todayShift ? `${todayShift.break_minutes} min` : '—'}</strong></span></div>{open && <p className="hr-location"><MapPin size={18}/>{siteName(open.site_id)} · {open.entry_ip ? 'Ingresso verificato sulla rete aziendale' : 'Ingresso verificato con GPS'}</p>}<p className="hr-muted hr-small">{monitor?.status}</p><div className="hr-note">Registra entrata e uscita dalla LAN o dal Wi-Fi aziendale. Ricorda il checkout manuale. Quello automatico oltre la soglia configurata è un supporto: può non intervenire a schermo spento o quando Workspace è sospeso.</div></>}</section><section className="hr-panel"><h2>Le mie presenze</h2>{attendanceTable(ownAttendance)}</section></div>}
      {page === 'attendance' && canManage && <section className="hr-panel"><div className="hr-heading"><h2>Presenze aziendali</h2><input aria-label="Cerca dipendente" placeholder="Cerca dipendente…" value={filter} onChange={(e) => setFilter(e.target.value)}/></div>{attendanceTable(data.attendance.filter((a) => name(a.user_id).toLowerCase().includes(filter.toLowerCase())))}</section>}
      {page === 'company-calendar' && calendarView === 'week' && <section className="hr-panel hr-company-weekly-calendar"><div className="hr-heading"><div><h2>Calendario aziendale · vista settimanale</h2><p className="hr-muted hr-small">Settimana {weekLabel(weekStart)} · Europe/Rome</p></div><div className="hr-actions"><button type="button" aria-pressed={true} onClick={() => setCalendarView('week')}>Vista settimanale</button><button type="button" aria-pressed={false} onClick={() => setCalendarView('month')}>Vista mensile</button><button type="button" aria-label="Settimana precedente" onClick={() => { const next = shiftDate(weekStart, -7); setWeekStart(next); setMonth(next.slice(0, 7)); }}><ChevronLeft size={18}/></button><button type="button" onClick={() => { const next = mondayOf(today); setWeekStart(next); setMonth(next.slice(0, 7)); }}>Questa settimana</button><button type="button" aria-label="Settimana successiva" onClick={() => { const next = shiftDate(weekStart, 7); setWeekStart(next); setMonth(next.slice(0, 7)); }}><ChevronRight size={18}/></button>{canManage && <><button onClick={closure}>Chiusura / festività</button><button className="hr-primary" onClick={shift} disabled={!data.sites.length || !data.employees.length}>Assegna turno</button></>}</div></div>{canManage && <label className="hr-calendar-filter">Dipendente<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Tutti</option>{data.employees.map((e) => <option key={e.user_id} value={e.user_id}>{e.name}</option>)}</select></label>}<div className="hr-week-grid" aria-label={`Presenze della settimana ${weekLabel(weekStart)}`}>{weekRows.map(({ day, present, absent }) => { const shifts = calendarShiftRows.filter((row) => row.work_date === day && (!filter || row.user_id === filter)); return <article className={`hr-week-day ${day === today ? 'today' : ''}`} key={day} role="button" tabIndex={0} aria-label={`Apri dettaglio del ${day}`} onClick={() => openAttendanceDay(day, present, absent)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAttendanceDay(day, present, absent); } }}><header><strong>{new Date(`${day}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</strong><span>{shifts.length ? `${plannedPresentCount(shifts, absent)} previsti` : 'Nessun turno registrato'}</span></header><h3>Presenti</h3>{present.length ? present.map((row) => { const shiftRow = shifts.find((item) => item.user_id === row.user_id); const worked = row.checkout_at ? minutesBetween(row.checkin_at, row.checkout_at) - Number(shiftRow?.break_minutes || 0) : null; const expected = agreementMinutes(contractFor(row.user_id, day), day) ?? (shiftRow ? minutesBetween(shiftRow.starts_at, shiftRow.ends_at) - Number(shiftRow.break_minutes || 0) : null); return <div className="hr-week-person" key={row.id}><b>{name(row.user_id)}</b><span>{row.checkout_at && expected != null ? formatMinutes(worked - expected) : 'Non determinabile'}</span></div>; }) : <p className="hr-muted hr-small">Nessuna presenza registrata.</p>}<h3>Assenti</h3>{absent.length ? absent.map((row) => <div className="hr-week-person absent" key={row.id}><b>{name(row.user_id)}</b><span>{row.kind === 'unjustified' ? 'ingiustificato' : 'ferie'}</span></div>) : <p className="hr-muted hr-small">Nessuna assenza disponibile nei dati HR.</p>}</article>; })}</div>{!weekRows.some(row => row.present.length) && <Empty>Nessuna registrazione nella settimana selezionata. I giorni senza dati restano visibili.</Empty>}</section>}
      {page === 'company-calendar' && calendarView === 'week' && <section className="hr-panel hr-attendance-report" aria-labelledby="hr-attendance-report-title"><div className="hr-heading"><div><h2 id="hr-attendance-report-title">Consuntivi presenze</h2><p className="hr-muted hr-small">Differenza tra ore lavorate e ore concordate nel periodo selezionato.</p></div><label>Intervallo<select value={reportRange} onChange={(event) => setReportRange(event.target.value)}><option value="week">Settimana</option><option value="month">Mese</option><option value="custom">Date selezionate</option></select></label></div>{reportRange === 'custom' && <div className="hr-report-dates"><label>Dal<input type="date" value={reportFrom} onChange={(event) => { const value = event.target.value; setReportFrom(value); if (value) setMonth(value.slice(0, 7)); }}/></label><label>Al<input type="date" value={reportTo} min={reportFrom} onChange={(event) => { const value = event.target.value; setReportTo(value); if (value) setMonth(value.slice(0, 7)); }}/></label></div>}{reportRows.length ? <><div className="hr-report-summary" aria-label="Totali consuntivi"><div className="positive"><span>Ore in più</span><strong>{formatMinutes(reportTotals.extra).replace(/^\+/, '')}</strong></div><div className="negative"><span>Ore in meno</span><strong>{formatMinutes(-reportTotals.shortage).replace(/^−/, '')}</strong></div></div><div className="hr-table-wrap"><table><thead><tr><th>Dipendente</th><th>Periodo</th><th>Ore lavorate</th><th>Ore concordate</th><th>Differenza</th></tr></thead><tbody>{reportRows.map(row => <tr key={row.employee.user_id}><td>{row.employee.name}</td><td>{reportRange === 'week' ? weekLabel(weekStart) : reportRange === 'month' ? month : `${reportFrom} – ${reportTo}`}</td><td>{formatMinutes(row.worked).replace(/^\+/, '')}</td><td>{formatMinutes(row.expected).replace(/^\+/, '')}</td><td><strong>{row.hasIncomplete ? 'Da verificare' : formatMinutes(row.difference)}</strong></td></tr>)}</tbody></table></div></> : <Empty>Nessun dato di presenza disponibile nell’intervallo selezionato.</Empty>}</section>}
      {/* Legacy attendance-calendar card removed. The live monthly company calendar is rendered by CompanyCalendar. <section className="hr-panel"><div className="hr-heading"><h2><button type="button" onClick={() => setCalendarView('week')}>Vista settimanale</button>{canManage && <div className="hr-actions"><button onClick={closure}>Chiusura / festività</button><button className="hr-primary" onClick={shift} disabled={!data.sites.length || !data.employees.length}>Assegna turno</button></div>}</div>{canManage && <label className="hr-calendar-filter">Dipendente<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Tutti</option>{data.employees.map((e) => <option key={e.user_id} value={e.user_id}>{e.name}</option>)}</select></label>}{!data.companyCalendar && <p className="hr-note" role="status">Calendario aziendale non disponibile. Aggiorna per riprovare; i turni personali restano consultabili.</p>}<div className="hr-calendar-scroll" tabIndex={0} aria-label="Calendario mensile, scorri orizzontalmente"><div className="hr-calendar">{WEEKDAYS.map((d) => <div className="hr-calendar-label" key={d}>{d}</div>)}{Array.from({ length: (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <div key={`blank${i}`}/>)}{monthDays(month).map((day) => { const shifts = calendarShifts.filter((s) => s.work_date === day); const leave = data.requests.filter((r) => absenceCoversDay(r, day) && (!canManage || !filter || r.user_id === filter)); const closures = data.closures.filter((c) => c.date_from <= day && c.date_to >= day); const companyDay=companyCalendarDay(data.companyCalendar,day); const derivedAbsences = unjustifiedAbsences({ day, shifts, attendance: calendarAttendance, absences: data.requests, closures: data.closures, companyCalendarDay: companyDay, asOf: today }).filter(r => !filter || r.user_id === filter); return <div key={day} className={`hr-calendar-day ${day === today ? 'today' : ''}`}><strong>{day.slice(-2)}</strong>{companyDay ? <span className={`hr-event ${companyDay.intervals.length ? '' : 'closure'}`}>Azienda: {companyDay.intervals.length ? companyDay.intervals.map(([from,to])=>`${from}–${to}`).join(', ') : 'chiusa'}{companyDay.reason && <><br/>{companyDay.reason}</>}</span> : closures.map((c) => <span className="hr-event closure" key={c.id}>{c.name}</span>)}<span className="hr-event"><b>Presenti previsti: {plannedPresentCount(shifts, leave)}</b></span>{[...leave, ...derivedAbsences].length > 0 && <span className="hr-muted">Assenze</span>}{[...leave, ...derivedAbsences].sort((a, b) => name(a.user_id).localeCompare(name(b.user_id), 'it')).map((r) => <span className="hr-event leave" key={r.id}><b>{name(r.user_id)}</b><br/>{KIND[r.kind]}{r.kind === 'permission' && <> · {formatTime(r.starts_at)}–{formatTime(r.ends_at)}</>}</span>)}</div>; })}</div></div>{!calendarShifts.length && <Empty>Nessun turno: l’admin può configurare gli orari e il gestore HR assegnare turni specifici.</Empty>}</section> */}
      {page === 'leave' && requestsTable('leave')}{page === 'overtime' && requestsTable('overtime')}
      {configuration && page === 'employees' && <div className="hr-master-detail hr-panel"><section className="hr-employee-card" aria-label="Dipendenti HR"><div className="hr-heading"><h2>Dipendenti HR</h2><Badge>{visibleEmployees.length}</Badge></div><Link to="/settings/users">Assegna utenti al reparto</Link><div className="hr-card-scroll" tabIndex={0} aria-label="Elenco dipendenti">{visibleEmployees.map((e) => <button className={`hr-person ${selected === e.user_id ? 'active' : ''}`} key={e.user_id} onClick={() => setSelected(e.user_id)}><strong>{e.name}</strong><small>{e.department || 'Nessun reparto operativo'} · {e.active ? 'Attivo' : 'Non attivo'}</small></button>)}{!visibleEmployees.length && <Empty>{hrSearch ? 'Nessun risultato per la ricerca.' : 'Assegna gli utenti al reparto Human Resources da Utenti e accessi.'}</Empty>}</div></section><section className="hr-employee-card" aria-label="Scheda dipendente">{selectedEmployee ? <HrEmployeeDetails employee={selectedEmployee} contracts={selectedContracts} sites={data.sites} users={data.users} onEdit={() => editMember(selectedEmployee)}/> : <Empty>Assegna gli utenti al reparto Human Resources da Utenti e accessi.</Empty>}</section></div>}
      {configuration && page === 'company-calendar' && calendarView === 'month' && <CompanyCalendar snapshot={data} month={month} onMonthChange={setMonth} onViewChange={setCalendarView} onReload={() => load(true)}/>}
      {configuration && page === 'sites' && <section className="hr-panel"><div className="hr-heading"><h2>Sedi e timbrature</h2><button className="hr-primary" onClick={() => site()}>Nuova sede</button></div>{data.sites.map((s) => <article className="hr-contract" key={s.id}><div className="hr-heading"><h3>{s.name}</h3><button onClick={() => site(s)}>Modifica</button></div><p>{s.address}</p><p><a href={mapsSearchUrl(s.latitude + ',' + s.longitude)} target="_blank" rel="noopener noreferrer">{s.latitude}, {s.longitude} · Apri Google Maps ↗</a></p><p><strong>Entrata e uscita: solo rete aziendale</strong></p><p>IP autorizzati: {s.public_ips?.length ? s.public_ips.join(', ') : 'Nessuno: timbrature manuali bloccate'}</p><p>Checkout automatico di supporto oltre {s.checkout_radius} m · {s.auto_checkout ? 'Supporto attivo' : 'Disattivo'}</p></article>)}{!data.sites.length && <Empty>Configura la sede e gli IP pubblici aziendali per abilitare le timbrature.</Empty>}<div className="hr-note">Entrata e uscita manuali richiedono la rete aziendale. L’uscita automatica richiede due rilevazioni attendibili distanziate di almeno 30 secondi. Una posizione mancante non chiude la presenza. Le presenze già aperte mantengono la sede verificata al check-in.</div></section>}
      {configuration && page === 'export' && <section className="hr-panel"><h2>Foglio presenze per il consulente del lavoro</h2><p>Periodo selezionato: <strong>{month}</strong>. Dettaglio giornaliero e riepilogo di presenze, ferie, permessi, straordinari approvati e assenze da verificare.</p><button className="hr-primary" disabled={busy || loading} onClick={async () => { setBusy(true); setError(''); try { await downloadAttendanceWorkbook(data,month); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>{busy ? 'Preparazione Excel…' : 'Esporta presenze Excel'}</button><p className="hr-note">Controlla le anomalie prima di inviare il file. Le uscite mancanti e i dati non determinabili restano evidenziati; le ore rilevate non equivalgono automaticamente alle ore retribuite.</p></section>}
      {configuration && page === 'economics' && <section className="hr-panel"><h2>Straordinari approvati · {month}</h2><p className="hr-muted">Valorizzazione delle ore autorizzate, da verificare con le presenze effettive prima del pagamento.</p><div className="hr-table-wrap"><table><thead><tr><th>Dipendente / data</th><th>Ore autorizzate</th><th>Gestione</th><th>Valore indicativo</th></tr></thead><tbody>{data.requests.filter((r) => r.kind === 'overtime' && r.status === 'approved').map((r) => { const c = data.contracts.find((c) => c.user_id === r.user_id && c.effective_from <= romeDay(r.starts_at)); const hours = (Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 3600000; return <tr key={r.id}><td>{name(r.user_id)}<small>{formatDate(r.starts_at)}</small></td><td>{hours.toLocaleString('it-IT', { maximumFractionDigits: 2 })}</td><td>{c ? agreementDisplay(c, 'overtime_mode', data.sites) : 'Accordo mancante'}</td><td>{overtimeValue(c, hours)}</td></tr>; })}</tbody></table></div></section>}

    </>}
    {editor && <Editor model={editor} onClose={() => setEditor(null)} onSave={editor.save}/>}
    {attendanceDayDetail && <AttendanceDayDialog detail={attendanceDayDetail} onClose={() => setAttendanceDayDetail(null)}/>}
  </div>;
}

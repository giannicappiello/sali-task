import { companyCalendarDay } from './companyCalendarDay';
import { monthDays, formatTime } from './hrService';
import { absenceCoversDay, plannedPresentCount, unjustifiedAbsences } from './hrCalendarPresence';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/** The historical attendance-oriented monthly rendering used by the HR calendar. */
export default function LegacyMonthlyCalendar({ snapshot, month, today, filter, onFilterChange, onWeek, onPrevious, onToday, onNext, canManage, onClosure, onShift, name }) {
  const { companyCalendar, closures = [], requests = [], employees = [] } = snapshot;
  const calendarAttendance = snapshot.calendarAttendance || snapshot.attendance || [];
  const calendarShifts = snapshot.calendarShifts || snapshot.shifts || [];
  const firstDay = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  return <section className="hr-panel hr-legacy-monthly-calendar">
    <div className="hr-heading">
      <div><h2>Calendario aziendale · vista mensile</h2><p className="hr-muted hr-small">Orario aziendale · Assenze approvate</p></div>
      <div className="hr-actions">
        <button type="button" onClick={onWeek}>Vista settimanale</button>
        <button type="button" aria-label="Mese precedente" onClick={onPrevious}>‹</button>
        <button type="button" onClick={onToday}>Oggi</button>
        <button type="button" aria-label="Mese successivo" onClick={onNext}>›</button>
        {canManage && <><button type="button" onClick={onClosure}>Chiusura / festività</button><button type="button" className="hr-primary" onClick={onShift} disabled={!snapshot.sites?.length || !employees.length}>Assegna turno</button></>}
      </div>
    </div>
    {canManage && <label className="hr-calendar-filter">Dipendente<select value={filter} onChange={(event) => onFilterChange(event.target.value)}><option value="">Tutti</option>{employees.map((employee) => <option key={employee.user_id} value={employee.user_id}>{employee.name}</option>)}</select></label>}
    {!companyCalendar && <p className="hr-note" role="status">Calendario aziendale non disponibile. Aggiorna per riprovare; i turni personali restano consultabili.</p>}
    <div className="hr-calendar-scroll" tabIndex={0} aria-label="Calendario mensile, scorri orizzontalmente"><div className="hr-calendar">
      {WEEKDAYS.map((day) => <div className="hr-calendar-label" key={day}>{day}</div>)}
      {Array.from({ length: firstDay }, (_, index) => <div key={`blank-${index}`} />)}
      {monthDays(month).map((day) => {
        const shifts = calendarShifts.filter((shift) => shift.work_date === day && (!filter || shift.user_id === filter));
        const approved = requests.filter((request) => absenceCoversDay(request, day) && (!filter || request.user_id === filter));
        const closuresForDay = closures.filter((closure) => closure.date_from <= day && closure.date_to >= day);
        const companyDay = companyCalendarDay(companyCalendar, day);
        const derived = unjustifiedAbsences({ day, shifts: calendarShifts, attendance: calendarAttendance, absences: requests, closures, companyCalendarDay: companyDay, asOf: today }).filter((row) => !filter || row.user_id === filter);
        const absences = [...approved, ...derived];
        return <div key={day} className={`hr-calendar-day ${day === today ? 'today' : ''}`}><strong>{day.slice(-2)}</strong>{companyDay ? <span className={`hr-event ${companyDay.intervals.length ? '' : 'closure'}`}>Azienda: {companyDay.intervals.length ? companyDay.intervals.map(([from, to]) => `${from}–${to}`).join(', ') : 'chiusa'}{companyDay.reason && <><br />{companyDay.reason}</>}</span> : closuresForDay.map((closure) => <span className="hr-event closure" key={closure.id}>{closure.name}</span>)}<span className="hr-event"><b>Presenti previsti: {plannedPresentCount(shifts, approved)}</b></span>{absences.length > 0 && <span className="hr-muted">Assenze</span>}{absences.sort((a, b) => name(a.user_id).localeCompare(name(b.user_id), 'it')).map((absence) => <span className="hr-event leave" key={absence.id}><b>{name(absence.user_id)}</b><br />{absence.kind === 'unjustified' ? 'Assente ingiustificato' : absence.kind === 'leave' ? 'Ferie' : absence.kind === 'permission' ? `Permesso · ${formatTime(absence.starts_at)}–${formatTime(absence.ends_at)}` : absence.kind === 'illness' ? 'Malattia' : 'Maternità'}</span>)}</div>;
      })}
    </div></div>
    {!calendarShifts.length && <p className="hr-empty">Nessun turno: il gestore HR può assegnare turni specifici.</p>}
  </section>;
}

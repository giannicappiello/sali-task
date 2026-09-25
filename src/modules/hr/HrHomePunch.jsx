import { useHrAttendance } from './HrAttendanceProvider';
import HrPunchButton from './HrPunchButton';
import './hr-home-punch.css';

export default function HrHomePunch() {
  const attendance = useHrAttendance();
  if (!attendance?.member) return null;
  return <section className="hr-home-punch" aria-label="Timbratura personale">
    <HrPunchButton className={attendance.open ? 'is-out' : ''}/>
    <p>Ingresso in azienda con verifica GPS. Uscita fuori sede con motivazione.</p>
    {attendance.open && <p role="status">{attendance.status} Mantieni Workspace aperto: il browser può sospendere il GPS in background.</p>}
    {attendance.notice && <p role="status">{attendance.notice}</p>}
    {!attendance.ready && <p role="status">Verifica della presenza non disponibile. Attendi il ripristino della connessione.</p>}
  </section>;
}

import { useHrAttendance } from './HrAttendanceProvider';
import HrPunchButton from './HrPunchButton';
import './hr-home-punch.css';
import { usesMobileLocation } from './hrPunchDevice';

export default function HrHomePunch() {
  const attendance = useHrAttendance();
  if (!attendance?.member) return null;
  return <section className="hr-home-punch" aria-label="Timbratura personale">
    <HrPunchButton className={attendance.open ? 'is-out' : ''}/>
    <p>{usesMobileLocation() ? 'Ingresso in azienda con verifica GPS. Uscita fuori sede con motivazione.' : 'Entrata e uscita tramite IP aziendale autorizzato.'}</p>
    {attendance.open?.auto_checkout && usesMobileLocation() && <p role="status">{attendance.status} Mantieni Workspace aperto: il browser può sospendere il GPS in background.</p>}
    {attendance.notice && <p role="status">{attendance.notice}</p>}
    {!attendance.ready && <p role="status">Verifica della presenza non disponibile. Attendi il ripristino della connessione.</p>}
  </section>;
}

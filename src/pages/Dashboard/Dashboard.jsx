import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CalendarDays, CheckCircle2, Clock, ListChecks, UserCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isPast(date) {
  return date && date < todayIso();
}

function isDone(item) {
  return ["completato", "completata", "evaso", "evasa", "chiuso", "chiusa"].includes(String(item?.stato || "").toLowerCase()) || item?.completato;
}

function formatDate(date) {
  if (!date) return "Senza deadline";
  return new Date(`${date}T00:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function Dashboard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [phases, setPhases] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, [profile?.id, profile?.reparto_id]);

  async function loadDashboard() {
    setLoading(true);

    let phasesQuery = supabase
      .from("v4_fasi_progetto")
      .select("id,titolo,stato,deadline,reparto_id,progetto_id,updated_at,v4_progetti(titolo)")
      .order("deadline", { ascending: true, nullsFirst: false });

    if (profile?.reparto_id) phasesQuery = phasesQuery.eq("reparto_id", profile.reparto_id);

    const [phasesRes, remindersRes, activityRes] = await Promise.all([
      phasesQuery.limit(120),
      supabase
        .from("agenda_reminder")
        .select("id,titolo,descrizione,stato,deadline,completato,created_at,updated_at")
        .eq("utente_id", profile?.id || "00000000-0000-0000-0000-000000000000")
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(120),
      supabase
        .from("v4_audit_log")
        .select("id,entity_type,azione,dettagli,created_at,user_id")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    if (phasesRes.error) console.error("Dashboard fasi:", phasesRes.error);
    if (remindersRes.error) console.error("Dashboard reminder:", remindersRes.error);
    if (activityRes.error) console.error("Dashboard timeline:", activityRes.error);

    setPhases(phasesRes.data || []);
    setReminders(remindersRes.data || []);
    setActivity(activityRes.data || []);
    setLoading(false);
  }

  const stats = useMemo(() => {
    const openPhases = phases.filter((item) => !isDone(item));
    const openReminders = reminders.filter((item) => !isDone(item));
    return {
      pAperte: openPhases.length,
      pOggi: openPhases.filter((item) => item.deadline === todayIso()).length,
      pScadute: openPhases.filter((item) => isPast(item.deadline)).length,
      pCompletate: phases.filter(isDone).length,
      rAperti: openReminders.length,
      rOggi: openReminders.filter((item) => item.deadline === todayIso()).length,
      rScaduti: openReminders.filter((item) => isPast(item.deadline)).length,
      rCompletati: reminders.filter(isDone).length,
    };
  }, [phases, reminders]);

  const upcoming = useMemo(() => {
    return [...phases]
      .filter((item) => !isDone(item))
      .sort((a, b) => String(a.deadline || "9999").localeCompare(String(b.deadline || "9999")))
      .slice(0, 8);
  }, [phases]);

  return (
    <div className="dashboard-page v4-page">
      <div className="v4-section-title">
        <div>
          <h1>Vista operativa</h1>
          <p>Solo attività del tuo reparto e reminder personali.</p>
        </div>
        <button className="secondary-action" onClick={loadDashboard}>Aggiorna</button>
      </div>

      <div className="kpi-grid">
        <button className="kpi-card kpi-clickable" onClick={() => navigate("/tasks?filter=aperte")}>
          <div className="kpi-icon blue"><ListChecks size={26} /></div>
          <div><span>Progetti aperti</span><strong>{loading ? "..." : stats.pAperte}</strong><p>Fasi del tuo reparto</p></div>
        </button>
        <button className="kpi-card kpi-clickable" onClick={() => navigate("/tasks?filter=oggi")}>
          <div className="kpi-icon orange"><Clock size={26} /></div>
          <div><span>In scadenza oggi</span><strong>{loading ? "..." : stats.pOggi}</strong><p>Fasi da evadere oggi</p></div>
        </button>
        <button className="kpi-card kpi-clickable" onClick={() => navigate("/tasks?filter=scadute")}>
          <div className="kpi-icon red"><AlertCircle size={26} /></div>
          <div><span>Scadute</span><strong>{loading ? "..." : stats.pScadute}</strong><p>Fasi oltre deadline</p></div>
        </button>
        <button className="kpi-card kpi-clickable" onClick={() => navigate("/tasks?filter=completate")}>
          <div className="kpi-icon green"><CheckCircle2 size={26} /></div>
          <div><span>Completate</span><strong>{loading ? "..." : stats.pCompletate}</strong><p>Fasi evase</p></div>
        </button>
      </div>

      <div className="dashboard-grid dashboard-grid-pro">
        <div className="panel my-tasks-panel">
          <div className="panel-header"><h3>Reminder personali</h3><UserCircle size={24} /></div>
          <div className="my-task-stats four-stats">
            <button onClick={() => navigate("/agenda?filter=aperti")}><strong>{stats.rAperti}</strong><span>aperti</span></button>
            <button onClick={() => navigate("/agenda?filter=oggi")}><strong>{stats.rOggi}</strong><span>oggi</span></button>
            <button onClick={() => navigate("/agenda?filter=scaduti")}><strong>{stats.rScaduti}</strong><span>scaduti</span></button>
            <button onClick={() => navigate("/agenda?filter=completati")}><strong>{stats.rCompletati}</strong><span>completati</span></button>
          </div>
        </div>

        <div className="panel calendar-summary-panel">
          <div className="panel-header"><h3>Prossime scadenze reparto</h3><CalendarDays size={24} /></div>
          {upcoming.length === 0 ? <p className="empty-text">Nessuna fase aperta per il tuo reparto.</p> : (
            <div className="v4-timeline-list">
              {upcoming.map((item) => (
                <button key={item.id} className={`v4-timeline-row ${isPast(item.deadline) ? "danger" : item.deadline === todayIso() ? "today" : ""}`} onClick={() => navigate(`/tasks?date=${item.deadline || ""}`)}>
                  <span>{formatDate(item.deadline)}</span>
                  <strong>{item.titolo}</strong>
                  <small>{item.v4_progetti?.titolo || "Progetto"}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel timeline-panel full-width-panel">
        <div className="panel-header"><h3>Timeline reparto</h3></div>
        {activity.length === 0 ? <p className="empty-text">Nessuna attività recente.</p> : (
          <div className="activity-list">
            {activity.map((item) => (
              <p key={item.id}><strong>{item.user_id ? "Utente" : "Sistema"}</strong> · {item.azione} · {item.dettagli || item.entity_type} <small>{new Date(item.created_at).toLocaleString("it-IT")}</small></p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ListChecks,
  Clock,
  AlertCircle,
  CheckCircle2,
  Activity,
  CalendarDays,
  UserCircle,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

function Dashboard() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [tasks, setTasks] = useState([]);
  const [attivita, setAttivita] = useState([]);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [profile?.id]);

  async function loadDashboard() {
    setLoading(true);

    const { data: taskData, error: tasksError } = await supabase
      .from("tasks")
      .select(`
        id,
        titolo,
        deadline,
        assegnato_a_id,
        data_completamento,
        stati_task(nome, chiusa)
      `);

    const { data: activityData, error: activityError } = await supabase
      .from("attivita_task")
      .select(`
        id,
        data_ora,
        tipo,
        campo,
        valore_precedente,
        valore_nuovo,
        note,
        utenti(nome),
        tasks(titolo)
      `)
      .order("data_ora", { ascending: false })
      .limit(10);

    if (tasksError) console.error("Errore caricamento dashboard task:", tasksError);
    if (activityError) console.error("Errore caricamento attività:", activityError);

    setTasks(taskData || []);
    setAttivita(activityData || []);
    setLoading(false);
  }

  function isClosed(task) {
    return Boolean(task.stati_task?.chiusa);
  }

  function isToday(date) {
    if (!date) return false;
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }

  function isOverdue(task) {
    if (!task.deadline || isClosed(task)) return false;
    const d = new Date(task.deadline);
    d.setHours(0, 0, 0, 0);
    return d < today;
  }

  function isUrgent(task) {
    if (!task.deadline || isClosed(task)) return false;
    const d = new Date(task.deadline);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 3;
  }

  const stats = useMemo(() => {
    const open = tasks.filter((task) => !isClosed(task));
    const mine = tasks.filter((task) => task.assegnato_a_id === profile?.id && !isClosed(task));

    return {
      aperte: open.length,
      oggi: tasks.filter((task) => isToday(task.deadline) && !isClosed(task)).length,
      scadute: tasks.filter(isOverdue).length,
      completate: tasks.filter(isClosed).length,
      mieAperte: mine.length,
      mieUrgenti: mine.filter(isUrgent).length,
      mieInRitardo: mine.filter(isOverdue).length,
    };
  }, [tasks, profile?.id]);

  const calendarDays = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - startOffset);

    return Array.from({ length: 35 }).map((_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);

      const dayTasks = tasks.filter((task) => {
        if (!task.deadline) return false;
        const d = new Date(task.deadline);
        return (
          d.getFullYear() === day.getFullYear() &&
          d.getMonth() === day.getMonth() &&
          d.getDate() === day.getDate()
        );
      });

      return {
        date: day,
        inMonth: day.getMonth() === month,
        isToday:
          day.getFullYear() === now.getFullYear() &&
          day.getMonth() === now.getMonth() &&
          day.getDate() === now.getDate(),
        count: dayTasks.length,
        hasOverdue: dayTasks.some(isOverdue),
      };
    });
  }, [tasks]);

  function goToTasks(filter) {
    navigate(`/tasks?filter=${filter}`);
  }

  function formatTime(date) {
    if (!date) return "-";
    return new Date(date).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function activityText(item) {
    const user = item.utenti?.nome || "Utente";
    const task = item.tasks?.titolo || "task";
    const field = item.campo ? ` / ${item.campo}` : "";
    return `${user} - ${item.tipo}${field} - ${task}`;
  }

  return (
    <div className="dashboard-page">
      <div className="kpi-grid">
        <button className="kpi-card kpi-clickable" onClick={() => goToTasks("aperte")}>
          <div className="kpi-icon blue"><ListChecks size={26} /></div>
          <div>
            <span>Task aperte</span>
            <strong>{loading ? "..." : stats.aperte}</strong>
            <p>Attività ancora da completare</p>
          </div>
        </button>

        <button className="kpi-card kpi-clickable" onClick={() => goToTasks("oggi")}>
          <div className="kpi-icon orange"><Clock size={26} /></div>
          <div>
            <span>In scadenza oggi</span>
            <strong>{loading ? "..." : stats.oggi}</strong>
            <p>Deadline previste oggi</p>
          </div>
        </button>

        <button className="kpi-card kpi-clickable" onClick={() => goToTasks("scadute")}>
          <div className="kpi-icon red"><AlertCircle size={26} /></div>
          <div>
            <span>Scadute</span>
            <strong>{loading ? "..." : stats.scadute}</strong>
            <p>Attività oltre deadline</p>
          </div>
        </button>

        <button className="kpi-card kpi-clickable" onClick={() => goToTasks("completate")}>
          <div className="kpi-icon green"><CheckCircle2 size={26} /></div>
          <div>
            <span>Completate</span>
            <strong>{loading ? "..." : stats.completate}</strong>
            <p>Attività chiuse</p>
          </div>
        </button>
      </div>

      <div className="dashboard-grid dashboard-grid-pro">
        <div className="panel my-tasks-panel">
          <div className="panel-header">
            <h3>Le mie task</h3>
            <UserCircle size={24} />
          </div>

          <div className="my-task-stats">
            <button onClick={() => goToTasks("mie")}>
              <strong>{stats.mieAperte}</strong>
              <span>aperte</span>
            </button>

            <button onClick={() => goToTasks("urgenti")}>
              <strong>{stats.mieUrgenti}</strong>
              <span>urgenti</span>
            </button>

            <button onClick={() => goToTasks("mie_scadute")}>
              <strong>{stats.mieInRitardo}</strong>
              <span>in ritardo</span>
            </button>
          </div>
        </div>

        <div className="panel mini-calendar-panel">
          <div className="panel-header">
            <h3>Calendario</h3>
            <CalendarDays size={24} />
          </div>

          <div className="mini-calendar">
            <div className="calendar-weekdays">
              <span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span>
            </div>

            <div className="calendar-days">
              {calendarDays.map((day, index) => (
                <button
                  key={index}
                  type="button"
                  className={`calendar-day ${day.inMonth ? "" : "muted"} ${day.isToday ? "today" : ""} ${day.count ? "has-task" : ""} ${day.hasOverdue ? "has-overdue" : ""}`}
                  onClick={() => day.count > 0 && navigate(`/tasks?date=${day.date.toISOString().slice(0, 10)}`)}
                  disabled={!day.count}
                >
                  <span>{day.date.getDate()}</span>
                  {day.count > 0 && <small>{day.count}</small>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="panel timeline-panel">
          <div className="panel-header">
            <h3>Timeline attività</h3>
            <Activity size={24} />
          </div>

          {attivita.length === 0 ? (
            <div className="empty-dashboard-state">
              <Activity size={34} />
              <h4>Nessuna attività registrata</h4>
              <p>Quando verranno create o modificate task, qui apparirà la timeline.</p>
            </div>
          ) : (
            <div className="timeline-list">
              {attivita.map((item) => (
                <button
                  type="button"
                  className="timeline-item"
                  key={item.id}
                  onClick={() => navigate("/tasks")}
                >
                  <time>{formatTime(item.data_ora)}</time>
                  <div>
                    <strong>{activityText(item)}</strong>
                    <span>{item.note || "Aggiornamento registrato"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;

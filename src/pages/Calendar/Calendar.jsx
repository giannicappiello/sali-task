import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function formatDateForQuery(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Calendar() {
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(formatDateForQuery(new Date()));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);

    const { data, error } = await supabase
      .from("tasks")
      .select(`
        id,
        titolo,
        descrizione,
        deadline,
        stati_task(nome, chiusa, colore),
        categorie_task(nome, colore),
        prodotti(nome),
        progetti(nome),
        assegnato:utenti!tasks_assegnato_a_id_fkey(nome)
      `)
      .order("deadline", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("Errore caricamento calendario:", error);
      setTasks([]);
    } else {
      setTasks(data || []);
    }

    setLoading(false);
  }

  function isClosed(task) {
    return Boolean(task.stati_task?.chiusa);
  }

  function isOverdue(task) {
    if (!task.deadline || isClosed(task)) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const deadline = new Date(`${task.deadline}T00:00:00`);
    deadline.setHours(0, 0, 0, 0);

    return deadline < today;
  }

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - startOffset);

    return Array.from({ length: 42 }).map((_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);

      const dateKey = formatDateForQuery(day);
      const dayTasks = tasks.filter((task) => task.deadline === dateKey);

      return {
        date: day,
        dateKey,
        inMonth: day.getMonth() === month,
        isToday: dateKey === formatDateForQuery(new Date()),
        isSelected: dateKey === selectedDate,
        tasks: dayTasks,
        openCount: dayTasks.filter((task) => !isClosed(task)).length,
        closedCount: dayTasks.filter(isClosed).length,
        overdueCount: dayTasks.filter(isOverdue).length,
      };
    });
  }, [tasks, currentMonth, selectedDate]);

  const selectedTasks = useMemo(() => {
    return tasks.filter((task) => task.deadline === selectedDate);
  }, [tasks, selectedDate]);

  const monthStats = useMemo(() => {
    const month = currentMonth.getMonth();
    const year = currentMonth.getFullYear();

    const monthTasks = tasks.filter((task) => {
      if (!task.deadline) return false;
      const d = new Date(`${task.deadline}T00:00:00`);
      return d.getMonth() === month && d.getFullYear() === year;
    });

    return {
      total: monthTasks.length,
      open: monthTasks.filter((task) => !isClosed(task)).length,
      closed: monthTasks.filter(isClosed).length,
      overdue: monthTasks.filter(isOverdue).length,
    };
  }, [tasks, currentMonth]);

  function changeMonth(direction) {
    setCurrentMonth((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + direction);
      return next;
    });
  }

  function goToday() {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(formatDateForQuery(today));
  }

  function formatMonth(date) {
    return date.toLocaleDateString("it-IT", {
      month: "long",
      year: "numeric",
    });
  }

  function formatDateHuman(dateKey) {
    if (!dateKey) return "-";
    return new Date(`${dateKey}T00:00:00`).toLocaleDateString("it-IT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  function goToTasksByDate(dateKey) {
    navigate(`/tasks?date=${dateKey}`);
  }

  return (
    <div className="calendar-page">
      <div className="page-title-row">
        <div>
          <h1>Calendario</h1>
          <p>Scadenze, attività e pianificazione mensile.</p>
        </div>

        <button className="secondary-action" onClick={goToday}>
          Oggi
        </button>
      </div>

      <div className="calendar-kpi-grid">
        <div className="calendar-kpi">
          <CalendarDays size={22} />
          <div>
            <strong>{monthStats.total}</strong>
            <span>Task nel mese</span>
          </div>
        </div>

        <div className="calendar-kpi">
          <Clock size={22} />
          <div>
            <strong>{monthStats.open}</strong>
            <span>Aperte</span>
          </div>
        </div>

        <div className="calendar-kpi">
          <CheckCircle2 size={22} />
          <div>
            <strong>{monthStats.closed}</strong>
            <span>Chiuse</span>
          </div>
        </div>

        <div className="calendar-kpi danger">
          <AlertCircle size={22} />
          <div>
            <strong>{monthStats.overdue}</strong>
            <span>Scadute</span>
          </div>
        </div>
      </div>

      <div className="calendar-layout-grid">
        <div className="panel calendar-main-panel">
          <div className="calendar-main-header">
            <button type="button" onClick={() => changeMonth(-1)}>
              <ChevronLeft size={20} />
            </button>

            <h3>{formatMonth(currentMonth)}</h3>

            <button type="button" onClick={() => changeMonth(1)}>
              <ChevronRight size={20} />
            </button>
          </div>

          {loading ? (
            <p className="table-message">Caricamento calendario...</p>
          ) : (
            <div className="full-calendar">
              <div className="full-calendar-weekdays">
                <span>Lunedì</span>
                <span>Martedì</span>
                <span>Mercoledì</span>
                <span>Giovedì</span>
                <span>Venerdì</span>
                <span>Sabato</span>
                <span>Domenica</span>
              </div>

              <div className="full-calendar-days">
                {calendarDays.map((day) => (
                  <button
                    key={day.dateKey}
                    type="button"
                    className={`full-calendar-day ${day.inMonth ? "" : "muted"} ${day.isToday ? "today" : ""} ${day.isSelected ? "selected" : ""} ${day.tasks.length ? "has-task" : ""} ${day.overdueCount ? "has-overdue" : ""}`}
                    onClick={() => setSelectedDate(day.dateKey)}
                  >
                    <span className="day-number">{day.date.getDate()}</span>

                    {day.tasks.length > 0 && (
                      <div className="day-dots">
                        {day.overdueCount > 0 && <span className="dot danger" />}
                        {day.openCount > 0 && <span className="dot primary" />}
                        {day.closedCount > 0 && <span className="dot success" />}
                      </div>
                    )}

                    {day.tasks.length > 0 && (
                      <small>{day.tasks.length} task</small>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="panel calendar-side-panel">
          <div className="panel-header">
            <div>
              <h3>{formatDateHuman(selectedDate)}</h3>
              <p>{selectedTasks.length} task in scadenza</p>
            </div>
          </div>

          {selectedTasks.length === 0 ? (
            <div className="calendar-empty-day">
              <CalendarDays size={34} />
              <h4>Nessuna task</h4>
              <p>Non ci sono attività con deadline in questa data.</p>
            </div>
          ) : (
            <>
              <div className="calendar-task-list">
                {selectedTasks.map((task) => (
                  <button
                    key={task.id}
                    className={`calendar-task-card ${isOverdue(task) ? "overdue" : ""}`}
                    onClick={() => goToTasksByDate(selectedDate)}
                  >
                    <strong>{task.titolo}</strong>
                    <span>{task.progetti?.nome || "Nessun progetto"}</span>
                    <small>{task.assegnato?.nome || "Non assegnata"}</small>
                  </button>
                ))}
              </div>

              <button
                className="primary-action calendar-open-tasks"
                onClick={() => goToTasksByDate(selectedDate)}
              >
                Apri elenco task filtrato
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Calendar;

import { AlertCircle, CalendarDays, Clock, ListChecks, Plus } from "lucide-react";
import InfoTooltip from "../../components/InfoTooltip";
import "./dashboard-compact-toolbar.css";

export default function DashboardActivityToolbar({ loading, monthStats, activityFilter, setActivityFilter, openNewPhase, openNewReminder, goToday }) {
  return (<div className="dashboard-activity-toolbar">
      <div className="calendar-kpi-grid dashboard-activity-kpis">
        <button type="button" className={`calendar-kpi success ${activityFilter === "plannedTasks" ? "active" : ""}`} onClick={() => setActivityFilter("plannedTasks")}>
          <ListChecks size={22} />
          <div><strong>{loading ? "..." : monthStats.plannedTasks}</strong><span>Task/fasi pianificate nel mese<InfoTooltip label="Task e fasi pianificate" text="Numero di task e fasi non completati con data compresa nel mese visualizzato." /></span></div>
        </button>
        <button type="button" className={`calendar-kpi danger ${activityFilter === "overdueTasks" ? "active" : ""}`} onClick={() => setActivityFilter("overdueTasks")}>
          <AlertCircle size={22} />
          <div><strong>{loading ? "..." : monthStats.overdueTasks}</strong><span>Task/fasi scadute nel mese<InfoTooltip label="Task e fasi scadute" text="Task e fasi non completati la cui scadenza è già trascorsa nel mese visualizzato." /></span></div>
        </button>
        <button type="button" className={`calendar-kpi success ${activityFilter === "plannedReminders" ? "active" : ""}`} onClick={() => setActivityFilter("plannedReminders")}>
          <CalendarDays size={22} />
          <div><strong>{loading ? "..." : monthStats.plannedReminders}</strong><span>Reminder pianificati nel mese<InfoTooltip label="Reminder pianificati" text="Numero di reminder non completati con data compresa nel mese visualizzato." /></span></div>
        </button>
        <button type="button" className={`calendar-kpi danger ${activityFilter === "overdueReminders" ? "active" : ""}`} onClick={() => setActivityFilter("overdueReminders")}>
          <Clock size={22} />
          <div><strong>{loading ? "..." : monthStats.overdueReminders}</strong><span>Reminder scaduti nel mese<InfoTooltip label="Reminder scaduti" text="Reminder non completati con scadenza precedente a oggi nel mese visualizzato." /></span></div>
        </button>
      </div>

        <div className="dashboard-quick-actions">
          <button className="primary-action" onClick={openNewPhase}><Plus size={18} /> Nuova task/fase</button>
          <button className="secondary-action" onClick={openNewReminder}><Plus size={18} /> Nuovo reminder</button>
          <button className="secondary-action" onClick={goToday}>Oggi</button>
        </div>
      </div>);
}

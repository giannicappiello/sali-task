import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  BellRing,
  ChartNoAxesCombined,
  ClipboardList,
  Folder,
  LayoutDashboard,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import "./activities-module.css";

const Dashboard = lazy(() => import("../Dashboard/Dashboard"));
const Agenda = lazy(() => import("../Agenda/Agenda"));
const Projects = lazy(() => import("../Projects/Projects"));
const Tasks = lazy(() => import("../Tasks/Tasks"));
const Reports = lazy(() => import("../Reports/Reports"));

const items = [
  {
    to: "/activities/dashboard",
    label: "Tutte le attività",
    icon: LayoutDashboard,
    permission: "dashboard.read",
  },
  {
    to: "/activities/reminders",
    label: "Reminder",
    icon: BellRing,
    permission: "agenda.read",
  },
  {
    to: "/activities/projects",
    label: "Progetti",
    icon: Folder,
    permission: "projects.read",
  },
  {
    to: "/activities/tasks",
    label: "Fasi dei progetti",
    icon: ClipboardList,
    permission: "tasks.read",
  },
  {
    to: "/activities/analysis-data",
    label: "Analisi dati",
    icon: ChartNoAxesCombined,
    permission: "reports.read",
  },
];

function Loader() {
  return <div className="activities-empty">Caricamento sezione attività...</div>;
}

export default function ActivitiesModule() {
  const { hasPermission } = useAuth();
  const visibleItems = items.filter((item) => hasPermission(item.permission));
  const firstVisiblePath = visibleItems[0]?.to || "/home";

  return (
    <div className="activities-module">
      <div className="activities-module-header">
        <div>
          <h1>Attività</h1>
          <p>Task, reminder, progetti, fasi e analisi del reparto.</p>
        </div>
      </div>

      <div className="activities-tabs" aria-label="Menu attività">
        {visibleItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </div>

      <Suspense fallback={<Loader />}>
        <Routes>
          <Route index element={<Navigate to={firstVisiblePath} replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="reminders" element={<Agenda />} />
          <Route path="projects" element={<Projects />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="analysis-data" element={<Reports />} />
          <Route path="*" element={<Navigate to={firstVisiblePath} replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

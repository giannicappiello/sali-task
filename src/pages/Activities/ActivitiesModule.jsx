import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  BellRing,
  Archive,
  ClipboardList,
  Folder,
  LayoutDashboard,
} from "lucide-react";
import useOrderedModuleScreens from "../../hooks/useOrderedModuleScreens";
import "./activities-module.css";

const Dashboard = lazy(() => import("../Dashboard/Dashboard"));
const Agenda = lazy(() => import("../Agenda/Agenda"));
const Projects = lazy(() => import("../Projects/Projects"));
const Tasks = lazy(() => import("../Tasks/Tasks"));
const ActivityArchive = lazy(() => import("./ActivityArchive"));

const items = [
  {
    screenCode: "attivita.dashboard",
    to: "/activities/dashboard",
    label: "Tutte le attività",
    icon: LayoutDashboard,
  },
  {
    screenCode: "attivita.reminder",
    to: "/activities/reminders",
    label: "Reminder",
    icon: BellRing,
  },
  {
    screenCode: "attivita.progetti",
    to: "/activities/projects",
    label: "Progetti",
    icon: Folder,
  },
  {
    screenCode: "attivita.fasi",
    to: "/activities/tasks",
    label: "Fasi dei progetti",
    icon: ClipboardList,
  },
  {
    screenCode: "attivita.archivio",
    to: "/activities/archive",
    label: "Archivio",
    icon: Archive,
  },
];

function Loader() {
  return <div className="activities-empty">Caricamento sezione attività...</div>;
}

export default function ActivitiesModule() {
  const { items: visibleItems, defaultItem } = useOrderedModuleScreens("attivita", items);
  const firstVisiblePath = defaultItem?.to || visibleItems[0]?.to || "/home";

  return (
    <div className="activities-module">
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
          <Route path="archive" element={<ActivityArchive />} />
          <Route path="analysis-data" element={<Navigate to="/analisi-dati/attivita" replace />} />
          <Route path="*" element={<Navigate to={firstVisiblePath} replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

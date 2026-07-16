import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  BellRing,
  ChartNoAxesCombined,
  ClipboardList,
  Folder,
  LayoutDashboard,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const activityItems = [
  {
    path: "/dashboard",
    label: "Tutte le attività del reparto",
    description: "Dashboard operativa con attività, scadenze e calendario.",
    icon: LayoutDashboard,
    permission: "dashboard.read",
  },
  {
    path: "/reminders",
    label: "Reminder del mio reparto",
    description: "Reminder aperti, completati e scaduti del reparto.",
    icon: BellRing,
    permission: "agenda.read",
  },
  {
    path: "/projects",
    label: "Progetti del mio reparto",
    description: "Progetti, checklist, prodotti collegati e avanzamento.",
    icon: Folder,
    permission: "projects.read",
  },
  {
    path: "/tasks",
    label: "Tutte le fasi dei progetti",
    description: "Planning completo delle fasi e delle attività progettuali.",
    icon: ClipboardList,
    permission: "tasks.read",
  },
  {
    path: "/analysis-data",
    label: "Analisi Dati Attività",
    description: "Analisi interattive su progetti, fasi e reminder.",
    icon: ChartNoAxesCombined,
    permission: "reports.read",
  },
];

export default function Activities() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const visibleItems = useMemo(
    () => activityItems.filter((item) => hasPermission(item.permission)),
    [hasPermission]
  );

  return (
    <div className="v4-page">
      <div className="page-title-row">
        <div>
          <h1>Attività</h1>
          <p>Seleziona la sezione operativa da consultare.</p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 18,
        }}
      >
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              type="button"
              className="panel"
              onClick={() => navigate(item.path)}
              style={{
                minHeight: 170,
                padding: 24,
                textAlign: "left",
                cursor: "pointer",
                border: "1px solid #e2e8f0",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 18,
              }}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  display: "grid",
                  placeItems: "center",
                  background: "#eef2ff",
                  color: "#4338ca",
                }}
              >
                <Icon size={24} />
              </span>
              <span>
                <strong style={{ display: "block", fontSize: 18, marginBottom: 8 }}>
                  {item.label}
                </strong>
                <small style={{ color: "#64748b", fontSize: 14, lineHeight: 1.5 }}>
                  {item.description}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

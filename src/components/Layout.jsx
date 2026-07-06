import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  CheckSquare,
  Folder,
  Package,
  Users,
  CalendarDays,
  BarChart3,
  Settings,
  Search,
  Bell,
  MessageCircle,
  Sun,
  Moon,
  Menu,
  LogOut,
  X,
  ArrowRight,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const APP_VERSION = "1.0.0";

const menuItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.read" },
  { path: "/tasks", label: "Task", icon: CheckSquare, permission: "tasks.read" },
  { path: "/projects", label: "Progetti", icon: Folder, permission: "projects.read" },
  { path: "/products", label: "Prodotti", icon: Package, permission: "products.read" },
  { path: "/team", label: "Team", icon: Users, permission: "team.read" },
  { path: "/calendar", label: "Calendario", icon: CalendarDays, permission: "tasks.read" },
  { path: "/reports", label: "Report", icon: BarChart3, permission: "reports.read" },
  { path: "/settings", label: "Impostazioni", icon: Settings, permission: "settings.manage" },
];

const pageInfo = {
  "/dashboard": { title: "Dashboard", subtitle: "Panoramica generale del workspace." },
  "/tasks": { title: "Task", subtitle: "Gestione attività, assegnazioni e deadline." },
  "/projects": { title: "Progetti", subtitle: "Avanzamento, timeline e attività collegate." },
  "/products": { title: "Prodotti", subtitle: "Schede prodotto, sviluppo e documentazione." },
  "/team": { title: "Team", subtitle: "Utenti, ruoli, reparti e carichi di lavoro." },
  "/calendar": { title: "Calendario", subtitle: "Scadenze, attività e pianificazione." },
  "/reports": { title: "Report", subtitle: "Analisi attività, tempi e performance." },
  "/settings": { title: "Impostazioni", subtitle: "Ruoli, reparti e configurazioni workspace." },
};

function getInitials(name) {
  if (!name) return "PW";
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDateTime(date) {
  if (!date) return "Mai registrato";
  return new Date(date).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPresence(profile) {
  if (!profile?.last_seen) return { label: "Offline", className: "offline" };

  const lastSeen = new Date(profile.last_seen).getTime();
  const diffMinutes = (Date.now() - lastSeen) / 1000 / 60;

  if (diffMinutes <= 2) return { label: "Online", className: "online" };
  if (diffMinutes <= 15) return { label: "Attivo di recente", className: "recent" };
  return { label: "Offline", className: "offline" };
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, hasPermission } = useAuth();

  const currentPage = pageInfo[location.pathname] || pageInfo["/dashboard"];
  const presence = getPresence(profile);

  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  const [notificationCount, setNotificationCount] = useState(0);

  const visibleMenuItems = useMemo(() => {
    return menuItems.filter((item) => hasPermission(item.permission));
  }, [hasPermission]);

  useEffect(() => {
    loadNotificationCount();
  }, [profile?.id]);

  useEffect(() => {
    if (!searchOpen) return;

    const handler = window.setTimeout(() => {
      runGlobalSearch(globalSearch);
    }, 280);

    return () => window.clearTimeout(handler);
  }, [globalSearch, searchOpen]);

  async function loadNotificationCount() {
    if (!profile?.id) return;

    const { count, error } = await supabase
      .from("notifiche")
      .select("*", { count: "exact", head: true })
      .eq("utente_id", profile.id)
      .eq("letta", false);

    if (error) {
      console.error("Errore conteggio notifiche:", error);
      setNotificationCount(0);
      return;
    }

    setNotificationCount(count || 0);
  }

  async function runGlobalSearch(query) {
    const q = query.trim();

    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);

    const pattern = `%${q}%`;

    const [tasksRes, projectsRes, productsRes, usersRes, commentsRes] =
      await Promise.all([
        supabase.from("tasks").select("id, titolo, descrizione").or(`titolo.ilike.${pattern},descrizione.ilike.${pattern}`).limit(6),
        supabase.from("progetti").select("id, nome, descrizione").or(`nome.ilike.${pattern},descrizione.ilike.${pattern}`).limit(6),
        supabase.from("prodotti").select("id, nome, codice, descrizione").or(`nome.ilike.${pattern},codice.ilike.${pattern},descrizione.ilike.${pattern}`).limit(6),
        supabase.from("utenti").select("id, nome, email").or(`nome.ilike.${pattern},email.ilike.${pattern}`).limit(6),
        supabase.from("task_commenti").select("id, commento, task_id").ilike("commento", pattern).limit(6),
      ]);

    const results = [];

    if (!tasksRes.error) {
      results.push(
        ...(tasksRes.data || []).map((item) => ({
          type: "Task",
          title: item.titolo,
          description: item.descrizione || "Task",
          path: "/tasks",
        }))
      );
    }

    if (!projectsRes.error) {
      results.push(
        ...(projectsRes.data || []).map((item) => ({
          type: "Progetto",
          title: item.nome,
          description: item.descrizione || "Progetto",
          path: "/projects",
        }))
      );
    }

    if (!productsRes.error) {
      results.push(
        ...(productsRes.data || []).map((item) => ({
          type: "Prodotto",
          title: item.nome,
          description: item.codice || item.descrizione || "Prodotto",
          path: "/products",
        }))
      );
    }

    if (!usersRes.error) {
      results.push(
        ...(usersRes.data || []).map((item) => ({
          type: "Utente",
          title: item.nome,
          description: item.email || "Utente",
          path: "/team",
        }))
      );
    }

    if (!commentsRes.error) {
      results.push(
        ...(commentsRes.data || []).map((item) => ({
          type: "Commento",
          title: item.commento.slice(0, 70),
          description: "Commento task",
          path: "/tasks",
        }))
      );
    }

    setSearchResults(results);
    setSearchLoading(false);
  }

  function openSearch() {
    setSearchOpen(true);
    setGlobalSearch("");
    setSearchResults([]);
  }

  function closeSearch() {
    setSearchOpen(false);
    setGlobalSearch("");
    setSearchResults([]);
  }

  function goToResult(path) {
    navigate(path);
    closeSearch();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand-area">
          <div className="brand-box">
            <div className="brand-logo">P</div>
            <div>
              <h1>PROGRE</h1>
              <p>WORKSPACE</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                <Icon size={21} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-profile-card">
            <div className="profile-main-row">
              <div className="avatar profile-avatar">{getInitials(profile?.nome)}</div>
              <div className="profile-main-text">
                <strong>{profile?.nome || "Utente"}</strong>
                <span>{profile?.ruoli?.nome || "Ruolo non impostato"}</span>
              </div>
            </div>

            <div className={`presence-badge ${presence.className}`}>
              <span className="presence-dot" />
              {presence.label}
            </div>

            <div className="profile-meta">
              <span>Ultimo accesso</span>
              <strong>{formatDateTime(profile?.ultimo_accesso)}</strong>
            </div>

            <div className="workspace-version">
              <span>Workspace Progre</span>
              <strong>v{APP_VERSION}</strong>
            </div>

            <button className="logout-btn" onClick={signOut}>
              <LogOut size={18} />
              Esci
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <Menu size={24} />
            <div>
              <h2>{currentPage.title}</h2>
              <p>{currentPage.subtitle}</p>
            </div>
          </div>

          <div className="topbar-actions">
            <button className="search-box search-box-button" onClick={openSearch}>
              <Search size={18} />
              <span className="search-placeholder">Cerca task, prodotti, utenti...</span>
              <strong>⌘ K</strong>
            </button>

            <button className="icon-btn notification-btn">
              <Bell size={21} />
              {notificationCount > 0 && <small>{notificationCount}</small>}
            </button>

            <button className="icon-btn">
              <MessageCircle size={21} />
            </button>

            <div className="theme-toggle">
              <Sun size={17} />
              <Moon size={17} />
            </div>
          </div>
        </header>

        <section className="content-area">
          <Outlet />
        </section>
      </main>

      {searchOpen && (
        <div className="global-search-backdrop" onClick={closeSearch}>
          <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="global-search-input-row">
              <Search size={21} />
              <input
                autoFocus
                placeholder="Cerca in task, prodotti, utenti, progetti, commenti..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              <button onClick={closeSearch}>
                <X size={20} />
              </button>
            </div>

            <div className="global-search-results">
              {globalSearch.trim().length < 2 ? (
                <p className="global-search-empty">Scrivi almeno 2 caratteri per cercare.</p>
              ) : searchLoading ? (
                <p className="global-search-empty">Ricerca in corso...</p>
              ) : searchResults.length === 0 ? (
                <p className="global-search-empty">Nessun risultato trovato.</p>
              ) : (
                searchResults.map((result, index) => (
                  <button
                    key={`${result.type}-${index}`}
                    className="global-search-result"
                    onClick={() => goToResult(result.path)}
                  >
                    <span>{result.type}</span>
                    <div>
                      <strong>{result.title}</strong>
                      <small>{result.description}</small>
                    </div>
                    <ArrowRight size={18} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Layout;

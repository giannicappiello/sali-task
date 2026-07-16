import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Bell,
  ClipboardList,
  FileArchive,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Store,
  ShoppingCart,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const menuItems = [
  { path: "/activities", label: "Attività", icon: ClipboardList, permission: "dashboard.read" },
  { path: "/farmacie/dashboard", label: "Beauty Days", icon: Store, permission: "pharmacy.read" },
  { path: "/ordini", label: "Ordini", icon: ShoppingCart, permission: "orders.read" },
  { path: "/products", label: "Prodotti", icon: Package, permission: "products.read" },
  { path: "/documentation", label: "Documenti", icon: FileArchive, permission: "documentation.read" },
  { path: "/messages", label: "Messaggi", icon: MessageCircle, permission: "messages.read" },
  { path: "/team", label: "Team", icon: Users, permission: "team.read" },
  { path: "/settings", label: "Impostazioni", icon: Settings, permission: "settings.manage" },
];

const pageInfo = {
  "/home": { title: "Home", subtitle: "Accesso rapido ai moduli del Workspace." },
  "/activities": { title: "Attività", subtitle: "Task, reminder, progetti, fasi e analisi del reparto." },
  "/dashboard": { title: "Tutte le attività del reparto", subtitle: "Task, fasi, reminder e scadenze del reparto." },
  "/agenda": { title: "Reminder", subtitle: "Reminder personali, allegati e commenti." },
  "/reminders": { title: "Reminder del mio reparto", subtitle: "Reminder organizzati per deadline." },
  "/projects": { title: "Progetti del mio reparto", subtitle: "Progetti con checklist e fasi operative." },
  "/tasks": { title: "Tutte le fasi dei progetti", subtitle: "Planning delle fasi progettuali." },
  "/products": { title: "Prodotti", subtitle: "Catalogo articoli attivi sincronizzato da Mexal in sola lettura." },
  "/documentation": { title: "Documenti", subtitle: "Schede tecniche, certificazioni e documentazione aziendale." },
  "/analysis-data": { title: "Analisi Dati Attività", subtitle: "Analisi su progetti, fasi e reminder." },
  "/reports": { title: "Analisi Dati Attività", subtitle: "Analisi su progetti, fasi e reminder." },
  "/messages": { title: "Messaggi", subtitle: "Conversazioni e notifiche interne." },
  "/team": { title: "Team", subtitle: "Utenti, ruoli, reparti e presenze." },
  "/settings": { title: "Impostazioni", subtitle: "Permessi, accessi e configurazioni." },
  "/farmacie/dashboard": { title: "Beauty Days", subtitle: "Giornate promozionali, farmacie e analisi dati." },
  "/ordini": { title: "Ordini", subtitle: "Clienti, ordini e attività commerciali collegate a Mexal." },
};

function getInitials(name) {
  if (!name) return "PW";
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDateTime(date) {
  if (!date) return "-";
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
  const diffMinutes = (Date.now() - new Date(profile.last_seen).getTime()) / 1000 / 60;
  if (diffMinutes <= 2) return { label: "Online", className: "online" };
  if (diffMinutes <= 15) return { label: "Attivo di recente", className: "recent" };
  return { label: "Offline", className: "offline" };
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, hasPermission, isAdminUser } = useAuth();

  const currentPage = location.pathname.startsWith("/farmacie")
    ? pageInfo["/farmacie/dashboard"]
    : location.pathname.startsWith("/ordini")
      ? pageInfo["/ordini"]
      : (pageInfo[location.pathname] || pageInfo["/home"]);
  const presence = getPresence(profile);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pharmacyEnabled, setPharmacyEnabled] = useState(false);
  const [ordersEnabled, setOrdersEnabled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    let active = true;

    async function loadPharmacyAccess() {
      if (!profile?.id) {
        if (active) setPharmacyEnabled(false);
        return;
      }

      if (isAdminUser) {
        if (active) setPharmacyEnabled(true);
        return;
      }

      const { data, error } = await supabase
        .from("integrazioni_utenti")
        .select("enabled")
        .eq("utente_id", profile.id)
        .eq("modulo", "report_giornate")
        .maybeSingle();

      if (error) {
        console.error("Errore caricamento accesso Gestione Farmacie:", error);
        if (active) setPharmacyEnabled(false);
        return;
      }

      if (active) setPharmacyEnabled(data?.enabled === true);
    }

    loadPharmacyAccess();

    return () => {
      active = false;
    };
  }, [profile?.id, isAdminUser]);


  useEffect(() => {
    let active = true;

    async function loadOrdersAccess() {
      if (!profile?.id) {
        if (active) setOrdersEnabled(false);
        return;
      }

      if (isAdminUser) {
        if (active) setOrdersEnabled(true);
        return;
      }

      const { data, error } = await supabase
        .from("integrazioni_utenti")
        .select("enabled,codice_agente_mexal")
        .eq("utente_id", profile.id)
        .eq("modulo", "gestione_ordini")
        .maybeSingle();

      if (error) {
        console.error("Errore caricamento accesso Gestione Ordini:", error);
        if (active) setOrdersEnabled(false);
        return;
      }

      if (active) setOrdersEnabled(data?.enabled === true);
    }

    loadOrdersAccess();

    return () => {
      active = false;
    };
  }, [profile?.id, isAdminUser]);

  const visibleMenuItems = useMemo(
    () =>
      menuItems.filter((item) => {
        if (item.path === "/farmacie/dashboard") {
          return pharmacyEnabled || hasPermission("pharmacy.read");
        }

        if (item.path === "/ordini") {
          return ordersEnabled || hasPermission("orders.read");
        }

        if (item.path === "/products") {
          return ordersEnabled || hasPermission("products.read");
        }

        return hasPermission(item.permission);
      }),
    [hasPermission, pharmacyEnabled, ordersEnabled]
  );

  useEffect(() => {
    document.title = `${currentPage.title} · Progre Workspace`;
    setMobileMenuOpen(false);
  }, [location.pathname, currentPage.title]);

  useEffect(() => {
    loadNotificationCount();
  }, [profile?.id]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const handler = window.setTimeout(() => runGlobalSearch(globalSearch), 280);
    return () => window.clearTimeout(handler);
  }, [globalSearch, searchOpen]);

  async function loadNotificationCount() {
    if (!profile?.id) return;
    const { count, error } = await supabase
      .from("notifiche")
      .select("*", { count: "exact", head: true })
      .eq("utente_id", profile.id)
      .eq("letta", false);
    if (!error) setNotificationCount(count || 0);
  }

  async function loadNotifications() {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from("notifiche")
      .select("id,titolo,messaggio,tipo,task_id,letta,created_at,chat_conversazione_id,progetto_id,prodotto_id")
      .eq("utente_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (!error) setNotifications(data || []);
  }

  async function runGlobalSearch(query) {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const pattern = `%${q}%`;

    const [projectsRes, phasesRes, productsRes, docsRes, remindersRes] = await Promise.all([
      supabase.from("v4_progetti").select("id,titolo,descrizione").or(`titolo.ilike.${pattern},descrizione.ilike.${pattern}`).limit(6),
      supabase.from("v4_fasi_progetto").select("id,titolo,descrizione,progetto_id").or(`titolo.ilike.${pattern},descrizione.ilike.${pattern},note.ilike.${pattern}`).limit(6),
      supabase.from("prodotti").select("id,nome,codice,descrizione").or(`nome.ilike.${pattern},codice.ilike.${pattern},descrizione.ilike.${pattern}`).limit(6),
      supabase.from("documenti").select("id,titolo,tipo_documento,tipo,codice_documento,codice").or(`titolo.ilike.${pattern},tipo.ilike.${pattern},tipo_documento.ilike.${pattern},codice.ilike.${pattern},codice_documento.ilike.${pattern}`).limit(6),
      supabase.from("agenda_reminder").select("id,titolo,descrizione").or(`titolo.ilike.${pattern},descrizione.ilike.${pattern}`).limit(6),
    ]);

    const results = [];
    if (!projectsRes.error) results.push(...(projectsRes.data || []).map((item) => ({ type: "Progetto", title: item.titolo, description: item.descrizione || "Progetto", path: "/projects" })));
    if (!phasesRes.error) results.push(...(phasesRes.data || []).map((item) => ({ type: "Fase", title: item.titolo, description: item.descrizione || "Fase checklist", path: "/tasks" })));
    if (!productsRes.error) results.push(...(productsRes.data || []).map((item) => ({ type: "Prodotto", title: item.nome, description: item.codice || "Prodotto", path: "/products" })));
    if (!docsRes.error) results.push(...(docsRes.data || []).map((item) => ({ type: "Documento", title: item.titolo, description: item.tipo_documento || item.tipo || item.codice_documento || item.codice || "Documento", path: "/documentation" })));
    if (!remindersRes.error) results.push(...(remindersRes.data || []).map((item) => ({ type: "Reminder", title: item.titolo, description: item.descrizione || "Agenda personale", path: "/reminders" })));

    setSearchResults(results);
    setSearchLoading(false);
  }

  function openSearch() {
    setSearchOpen(true);
    setGlobalSearch("");
    setSearchResults([]);
    setNotificationOpen(false);
  }

  function closeSearch() {
    setSearchOpen(false);
    setGlobalSearch("");
    setSearchResults([]);
  }

  function openNotifications() {
    setNotificationOpen((value) => !value);
    loadNotifications();
  }

  function goToResult(path) {
    navigate(path);
    closeSearch();
  }

  async function goToNotification(notification) {
    if (!notification.letta) {
      await supabase.from("notifiche").update({ letta: true }).eq("id", notification.id);
      await loadNotificationCount();
    }
    setNotificationOpen(false);
    if (notification.tipo === "chat") navigate("/messages");
    else if (notification.progetto_id) navigate("/projects");
    else if (notification.prodotto_id) navigate("/products");
    else navigate(notification.task_id ? `/tasks?task=${notification.task_id}` : "/tasks");
  }

  return (
    <div className={`app-shell ${mobileMenuOpen ? "mobile-menu-is-open" : ""}`}>
      {mobileMenuOpen && <button type="button" className="mobile-sidebar-overlay" aria-label="Chiudi menu" onClick={() => setMobileMenuOpen(false)} />}

      <aside className={`sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-brand-area">
          <div className="brand-box">
            <div className="brand-logo">P</div>
            <div>
              <h1>PROGRE</h1>
              <p>WORKSPACE</p>
            </div>
          </div>
          <button type="button" className="mobile-sidebar-close" onClick={() => setMobileMenuOpen(false)} aria-label="Chiudi menu"><X size={22} /></button>
        </div>

        <nav className="sidebar-nav">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                <Icon size={21} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-profile-card sidebar-profile-card-compact">
            <div className="profile-main-row">
              <div className="avatar profile-avatar">{getInitials(`${profile?.nome || ""} ${profile?.cognome || ""}`.trim())}</div>
              <div className="profile-main-text">
                <strong>{`${profile?.nome || ""} ${profile?.cognome || ""}`.trim() || "Utente"}</strong>
                <span>{profile?.ruoli?.nome || "Utente"}</span>
              </div>
            </div>

            <div className="profile-status-row">
              <div className={`presence-badge ${presence.className}`}>
                <span className="presence-dot" />
                {presence.label}
              </div>
              <span className="profile-department">{profile?.reparti?.nome || "Reparto non impostato"}</span>
            </div>

            <button className="logout-btn" onClick={signOut}><LogOut size={18} />Esci</button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)} aria-label="Apri menu"><Menu size={25} /></button>
            <div><h2>{currentPage.title}</h2><p>{currentPage.subtitle}</p></div>
          </div>

          <div className="topbar-actions">
            <button className="search-box search-box-button" onClick={openSearch}><Search size={18} /><span className="search-placeholder">Cerca tutto...</span><strong>⌘ K</strong></button>
            <button className="icon-btn notification-btn" onClick={openNotifications}><Bell size={21} />{notificationCount > 0 && <small>{notificationCount}</small>}</button>
            <button className="icon-btn notification-btn" onClick={() => navigate("/messages")}><MessageCircle size={21} /></button>
          </div>

          {notificationOpen && (
            <div className="topbar-popover">
              <div className="topbar-popover-header"><h3>Notifiche</h3><p>{notificationCount} non lette</p></div>
              <div className="notification-list">
                {notifications.length === 0 ? <div className="topbar-popover-empty">Nessuna notifica.</div> : notifications.map((item) => (
                  <button key={item.id} className={`notification-row ${item.letta ? "" : "unread"}`} onClick={() => goToNotification(item)}>
                    <strong>{item.titolo || "Notifica"}</strong><span>{item.messaggio || "-"}</span><small>{formatDateTime(item.created_at)}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </header>

        <section className="content-area"><Outlet /></section>
      </main>

      {searchOpen && (
        <div className="global-search-backdrop" onClick={closeSearch}>
          <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="global-search-input-row"><Search size={21} /><input autoFocus placeholder="Cerca in progetti, fasi, prodotti, documenti, reminder..." value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} /><button onClick={closeSearch}><X size={20} /></button></div>
            <div className="global-search-results">
              {globalSearch.trim().length < 2 ? <p className="global-search-empty">Scrivi almeno 2 caratteri per cercare.</p> : searchLoading ? <p className="global-search-empty">Ricerca in corso...</p> : searchResults.length === 0 ? <p className="global-search-empty">Nessun risultato.</p> : searchResults.map((item, index) => (
                <button key={`${item.type}-${index}`} className="global-search-result-row" onClick={() => goToResult(item.path)}>
                  <span>{item.type}</span><strong>{item.title}</strong><small>{item.description}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Layout;

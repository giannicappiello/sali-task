import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Bot,
  Blocks,
  ChevronDown,
  ClipboardList,
  FileArchive,
  Factory,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  PlugZap,
  Store,
  ShoppingCart,
  Settings,
  Users,
  Workflow,
  Warehouse,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import WorkspaceScreenLayout from "./WorkspaceScreenLayout";
import { getModuleIcon } from "../config/moduleIcons";
import { resolveCatalogModuleDestination } from "../config/workspaceNavigation";

const baseMenuItems = [
  { path: "/home", label: "Home", icon: Home, module: "home" },
  { path: "/activities", label: "Attività", icon: ClipboardList, module: "attivita" },
  { path: "/farmacie/dashboard", label: "Beauty Days", icon: Store, permission: "pharmacy.read", module: "beauty_days" },
  { path: "/ordini-prof", label: "Ordini PR", icon: ShoppingCart, permission: "orders.read", special: "orders_pr", module: "ordini_pr" },
  { path: "/ordini-ph", label: "Ordini PH", icon: ShoppingCart, permission: "orders.read", special: "orders_ph", module: "ordini_ph" },
  { path: "/ordini-private", label: "OrdiniPrivate", icon: ShoppingCart, permission: "orders.read", special: "orders_private", module: "ordini_private" },
  { path: "/products", label: "Prodotti", icon: Package, module: "prodotti" },
  { path: "/magazzino-dashboard", label: "Magazzino", icon: Warehouse, module: "magazzino" },
  { path: "/documentation", label: "Documenti", icon: FileArchive, module: "documenti" },
  { path: "/assistente-ai", label: "Assistente AI", icon: Bot, module: "assistente_ai" },
  { path: "/progremes", label: "ProgreMES APS", icon: Factory, module: "progremes" },
  { path: "/produzione", label: "Produzione", icon: Workflow, accessModule: "progremes", persistent: true },
  { path: "/analisi-dati", label: "Analisi dati", icon: BarChart3, feature: "analisi_dati", module: "analisi_dati" },
  { path: "/messages", label: "Messaggi", icon: MessageCircle, module: "messaggi" },
  { path: "/notifications", label: "Notifiche", icon: Bell, module: "notifiche" },
  { path: "/team", label: "Team", icon: Users, permission: "team.read", module: "team" },
  { path: "/integrations", label: "Integrazioni", icon: PlugZap, permission: "integrations.read", module: "integrazioni" },
  { path: "/settings", label: "Impostazioni", icon: Settings, permission: "settings.manage", module: "impostazioni" },
];

const pageInfo = {
  "/home": { title: "Home", subtitle: "Accesso rapido ai moduli del Workspace." },
  "/analisi-dati": { title: "Analisi dati", subtitle: "Fatture, Ordini PH, Beauty Days e Attività." },
  "/activities": { title: "Attività", subtitle: "Task, reminder, progetti, fasi e analisi del reparto." },
  "/activities/dashboard": { title: "Tutte le attività del reparto", subtitle: "Task, fasi, reminder e scadenze del reparto." },
  "/activities/reminders": { title: "Reminder del mio reparto", subtitle: "Reminder organizzati per deadline." },
  "/activities/projects": { title: "Progetti del mio reparto", subtitle: "Progetti con checklist e fasi operative." },
  "/activities/tasks": { title: "Tutte le fasi dei progetti", subtitle: "Planning delle fasi progettuali." },
  "/activities/analysis-data": { title: "Analisi Dati Attività", subtitle: "Analisi su progetti, fasi e reminder." },
  "/dashboard": { title: "Tutte le attività del reparto", subtitle: "Task, fasi, reminder e scadenze del reparto." },
  "/agenda": { title: "Reminder", subtitle: "Reminder personali, allegati e commenti." },
  "/reminders": { title: "Reminder del mio reparto", subtitle: "Reminder organizzati per deadline." },
  "/projects": { title: "Progetti del mio reparto", subtitle: "Progetti con checklist e fasi operative." },
  "/tasks": { title: "Tutte le fasi dei progetti", subtitle: "Planning delle fasi progettuali." },
  "/products": { title: "Prodotti", subtitle: "Catalogo articoli attivi sincronizzato da Mexal in sola lettura." },
  "/magazzino": { title: "Magazzino", subtitle: "Giacenze, disponibilità e valorizzazione economica del database Workspace." },
  "/magazzino-dashboard": { title: "Dashboard Magazzino", subtitle: "Resoconto quantitativo ed economico delle giacenze Workspace." },
  "/documentation": { title: "Documenti", subtitle: "Schede tecniche, certificazioni e documentazione aziendale." },
  "/manuali-uso": { title: "Manuali d'uso", subtitle: "Manuali d'uso e guide operative." },
  "/assistente-ai": { title: "Assistente AI", subtitle: "Dati interni, ricerca Web e pianificazione controllata." },
  "/settings/ai": { title: "Configurazione AI", subtitle: "Capacità, limiti e accessi per reparto." },
  "/settings/company-letterheads": { title: "Intestazioni aziendali", subtitle: "Modelli ufficiali, versioni e associazioni documentali." },
  "/settings/users": { title: "Utenti e accessi", subtitle: "Dati, organizzazione, autorizzazioni personali e AI." },
  "/settings/access-rules": { title: "Regole e profili", subtitle: "Aree, reparti, ruoli e livelli operativi." },
  "/settings/access-check": { title: "Verifica accessi", subtitle: "Controllo motivato della visibilità effettiva." },
  "/progremes": { title: "ProgreMES APS", subtitle: "Accesso transitorio alla pianificazione e gestione della produzione." },
  "/produzione": { title: "Gestione Produzione", subtitle: "Accesso diretto e autonomo alle aree operative della produzione." },
  "/produzione/rdp-workbench": { title: "Gestione Produzione", subtitle: "Gestione OCT, richieste di produzione, analisi MES e decisioni operative." },
  "/produzione/diagnostica": { title: "Centro Diagnostico", subtitle: "Stato globale, alert operativi e integrazioni WorkspaceMES." },
  "/analysis-data": { title: "Analisi Dati Attività", subtitle: "Analisi su progetti, fasi e reminder." },
  "/reports": { title: "Analisi Dati Attività", subtitle: "Analisi su progetti, fasi e reminder." },
  "/messages": { title: "Messaggi", subtitle: "Conversazioni e notifiche interne." },
  "/team": { title: "Team", subtitle: "Utenti, ruoli, reparti e presenze." },
  "/settings": { title: "Impostazioni", subtitle: "Permessi, accessi e configurazioni." },
  "/settings/notifications": { title: "Notifiche", subtitle: "Dispositivi, suoni ed eventi del Workspace." },
  "/notifications": { title: "Notifiche", subtitle: "Avvisi personali e aggiornamenti operativi." },
  "/integrations": { title: "Centro Integrazioni", subtitle: "Connessioni con Mexal e sistemi aziendali esterni." },
  "/integrations/mexal": { title: "Mexal ERP", subtitle: "Sincronizzazioni, storico e controllo della WebAPI Mexal." },
  "/integrations/documentale": { title: "Documentale", subtitle: "Sezioni, cartelle NAS e sincronizzazione dell'archivio." },
  "/crm": { title: "CRM Platform AI", subtitle: "Conto Terzi, B2B, Online e AI Business Assistant." },
  "/farmacie/dashboard": { title: "Beauty Days", subtitle: "Giornate promozionali, clienti Mexal e analisi dati." },
  "/ordini-prof": { title: "Ordini PR", subtitle: "Clienti, ordini e attività commerciali collegate a Mexal." },
  "/ordini-ph": { title: "Ordini PH", subtitle: "Clienti, ordini e attività commerciali collegate a Mexal." },
  "/ordini-private": { title: "OrdiniPrivate", subtitle: "Creazione e invio degli ordini cliente OCT a Mexal." },
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
  const { profile, signOut, hasPermission, hasModuleAccess, hasWorkspaceFeature, getModuleScreenGrant, isAdminUser } = useAuth();

  const currentPage = location.pathname.startsWith("/produzione")
    ? pageInfo["/produzione"]
    : location.pathname.startsWith("/settings/layout-builder/")
      ? { title: "Editor schermata", subtitle: "Composizione visuale, anteprima e versioni del layout." }
    : location.pathname.startsWith("/workspace/schermate/")
      ? { title: "Schermata Workspace", subtitle: "Schermata configurata dal Workspace Screen Builder." }
    : location.pathname.startsWith("/crm")
      ? pageInfo["/crm"]
    : location.pathname.startsWith("/moduli/")
      ? { title: "Modulo Workspace", subtitle: "Schermate e funzioni disponibili nel modulo." }
    : location.pathname.startsWith("/integrations/mexal")
    ? pageInfo["/integrations/mexal"]
    : location.pathname.startsWith("/integrations")
      ? pageInfo["/integrations"]
      : location.pathname.startsWith("/analisi-dati")
        ? pageInfo["/analisi-dati"]
      : location.pathname.startsWith("/farmacie")
    ? pageInfo["/farmacie/dashboard"]
    : location.pathname.startsWith("/ordini-private")
      ? pageInfo["/ordini-private"]
    : location.pathname.startsWith("/ordini-ph")
      ? pageInfo["/ordini-ph"]
      : location.pathname.startsWith("/ordini")
      ? pageInfo["/ordini-prof"]
      : (pageInfo[location.pathname] || pageInfo["/home"]);
  const presence = getPresence(profile);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pharmacyEnabled, setPharmacyEnabled] = useState(false);
  const [ordersAccess, setOrdersAccess] = useState({ pr: false, ph: false, private: false });
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [progremesConnection, setProgremesConnection] = useState({ open: false, error: "" });
  const [configuredModules, setConfiguredModules] = useState(null);
  const [configuredMenu, setConfiguredMenu] = useState(null);
  const [expandedMenuCode, setExpandedMenuCode] = useState("");

  useEffect(() => {
    let active = true;
    const loadConfiguredModules = async () => {
      const [modulesResult, menuResult, menuLinksResult, screensResult, screenLinksResult] = await Promise.all([
        supabase.from("workspace_moduli").select("codice,nome,descrizione,percorso,provider,attivo,mostra_menu,ordine,icona,area").eq("attivo", true).eq("mostra_menu", true).order("ordine"),
        supabase.from("workspace_menu_voci").select("codice,nome,descrizione,icona,ordine,attiva").eq("attiva", true).order("ordine"),
        supabase.from("workspace_menu_moduli").select("voce_codice,modulo_codice,ordine").order("ordine"),
        supabase.from("workspace_schermate").select("codice,percorso,attiva").eq("attiva", true),
        supabase.from("workspace_moduli_schermate").select("modulo_codice,schermata_codice,ordine,predefinita,visibile_menu"),
      ]);
        if (!active) return;
        if (modulesResult.error) {
          console.error("Errore caricamento menu moduli:", modulesResult.error);
          setConfiguredModules(null);
          return;
        }
        setConfiguredModules(modulesResult.data || []);
        if (menuResult.error || menuLinksResult.error || screensResult.error || screenLinksResult.error) {
          console.error("Errore caricamento composizione menu:", menuResult.error || menuLinksResult.error || screensResult.error || screenLinksResult.error);
          setConfiguredMenu(null);
        } else {
          setConfiguredMenu({
            entries: menuResult.data || [],
            links: menuLinksResult.data || [],
            screens: screensResult.data || [],
            screenLinks: screenLinksResult.data || [],
          });
        }
    };
    void loadConfiguredModules();
    window.addEventListener("workspace:module-catalog-changed", loadConfiguredModules);
    return () => {
      active = false;
      window.removeEventListener("workspace:module-catalog-changed", loadConfiguredModules);
    };
  }, []);

  const menuItems = useMemo(() => {
    if (!configuredModules) return baseMenuItems;
    const settingsItem = baseMenuItems.find((item) => item.path === "/settings");
    const templates = new Map(baseMenuItems.filter((item) => item.module).map((item) => [item.module, item]));
    const configured = configuredModules.map((module) => ({
      ...(templates.get(module.codice) || {}),
      path: resolveCatalogModuleDestination(module, templates.get(module.codice), configuredMenu?.screens, configuredMenu?.screenLinks),
      label: module.nome,
      description: module.descrizione || "Apri il modulo del Workspace.",
      icon: getModuleIcon(module.icona, templates.get(module.codice)?.icon || (module.provider === "progremes" ? Factory : Blocks)),
      catalogModule: module.codice,
      module: templates.get(module.codice)?.feature ? undefined : module.codice,
      provider: module.provider,
      order: module.ordine,
    })).filter((item) => item.path);
    const productionItem = baseMenuItems.find((item) => item.path === "/produzione");
    const progremesIndex = configured.findIndex((item) => item.module === "progremes");
    const withProduction = [...configured];
    if (!withProduction.some((item) => item.path === "/produzione")) {
      withProduction.splice(progremesIndex >= 0 ? progremesIndex + 1 : withProduction.length, 0, productionItem);
    }
    if (settingsItem && !withProduction.some((item) => item.module === "impostazioni")) withProduction.push(settingsItem);
    const canonicalSettings = withProduction.find((item) => item.module === "impostazioni");
    return withProduction.filter((item) => (
      !canonicalSettings
      || item === canonicalSettings
      || item.label?.trim().toLocaleLowerCase("it-IT") !== "impostazioni"
    ));
  }, [configuredMenu, configuredModules]);

  const launchProgremes = useCallback((screenCode = "", workspacePath = "") => {
    if (!hasModuleAccess("progremes")) {
      setProgremesConnection({ open: true, error: "Accesso al modulo ProgreMES non autorizzato." });
      return;
    }
    const destination = workspacePath || (screenCode
      ? `/produzione/${encodeURIComponent(screenCode)}`
      : "/progremes/accesso");
    const progremesWindow = window.open(destination, "_blank");
    if (!progremesWindow) {
      setProgremesConnection({ open: true, error: "Il browser ha bloccato la nuova finestra. Consenti i popup per Workspace e riprova." });
      return;
    }
    progremesWindow.opener = null;
    setProgremesConnection({ open: false, error: "" });
  }, [hasModuleAccess]);

  useEffect(() => {
    const handler = (event) => launchProgremes(event.detail?.screenCode || "");
    window.addEventListener("workspace:launch-progremes", handler);
    return () => window.removeEventListener("workspace:launch-progremes", handler);
  }, [launchProgremes]);
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
        console.error("Errore caricamento accesso Beauty Days:", error);
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
        if (active) setOrdersAccess({ pr: false, ph: false, private: false });
        return;
      }

      if (isAdminUser) {
        if (active) setOrdersAccess({ pr: true, ph: true, private: true });
        return;
      }

      const { data, error } = await supabase
        .from("integrazioni_utenti")
        .select("modulo,enabled")
        .eq("utente_id", profile.id)
        .in("modulo", ["gestione_ordini_pr", "gestione_ordini_ph", "gestione_ordini_private"]);

      if (error) {
        console.error("Errore caricamento accesso Gestione Ordini:", error);
        if (active) setOrdersAccess({ pr: false, ph: false, private: false });
        return;
      }

      if (active) setOrdersAccess({
        pr: (data || []).some((row) => row.modulo === "gestione_ordini_pr" && row.enabled === true),
        ph: (data || []).some((row) => row.modulo === "gestione_ordini_ph" && row.enabled === true),
        private: (data || []).some((row) => row.modulo === "gestione_ordini_private" && row.enabled === true),
      });
    }

    loadOrdersAccess();

    return () => {
      active = false;
    };
  }, [profile?.id, isAdminUser]);

  const visibleModuleItems = useMemo(
    () =>
      menuItems.filter((item) => {
        const itemModuleCode = item.catalogModule || item.module || item.accessModule || "";
        const screenGrant = getModuleScreenGrant(itemModuleCode);
        if (item.adminOnly && !isAdminUser) return false;
        if (item.module && !hasModuleAccess(item.module) && !screenGrant) return false;
        if (item.accessModule && !hasModuleAccess(item.accessModule) && !screenGrant) return false;
        if (screenGrant) return true;
        if (item.feature && !hasWorkspaceFeature(item.feature)) return false;

        if (item.path === "/farmacie/dashboard") {
          return pharmacyEnabled;
        }

        if (item.special === "orders_pr") return ordersAccess.pr;
        if (item.special === "orders_ph") return ordersAccess.ph;
        if (item.special === "orders_private") return ordersAccess.private;

        return item.permission ? hasPermission(item.permission) : true;
      }).map((item) => {
        const itemModuleCode = item.catalogModule || item.module || item.accessModule || "";
        const screenGrant = getModuleScreenGrant(itemModuleCode);
        return screenGrant && !hasModuleAccess(itemModuleCode) && screenGrant.percorso
          ? { ...item, path: screenGrant.percorso }
          : item;
      }),
    [menuItems, getModuleScreenGrant, hasPermission, hasModuleAccess, hasWorkspaceFeature, pharmacyEnabled, ordersAccess, isAdminUser]
  );

  const visibleMenuItems = useMemo(() => {
    if (!configuredMenu) return visibleModuleItems;
    const itemByModule = new Map(visibleModuleItems
      .filter((item) => item.catalogModule || item.module)
      .map((item) => [item.catalogModule || item.module,item]));
    return configuredMenu.entries.map((entry) => {
      const members = configuredMenu.links
        .filter((link) => link.voce_codice === entry.codice)
        .map((link) => itemByModule.get(link.modulo_codice))
        .filter(Boolean);
      if (!members.length) return null;
      if (members.length === 1) {
        return { ...members[0], label:entry.nome, description:entry.descrizione || members[0].description, icon:getModuleIcon(entry.icona,members[0].icon), menuCode:entry.codice };
      }
      return { path:`/menu/${entry.codice}`, label:entry.nome, description:entry.descrizione || "Apri i moduli disponibili.", icon:getModuleIcon(entry.icona,Blocks), menuCode:entry.codice, members };
    }).filter(Boolean);
  }, [configuredMenu,visibleModuleItems]);

  const activeNavigation = useMemo(() => {
    const pathname = location.pathname.replace(/\/$/, "") || "/";
    const directMatches = visibleModuleItems.filter((member) => {
      const memberPath = (member.path || "").replace(/\/$/, "") || "/";
      return pathname === memberPath || (memberPath !== "/settings" && pathname.startsWith(`${memberPath}/`));
    }).toSorted((left, right) => (right.path || "").length - (left.path || "").length);

    const matchingScreen = configuredMenu?.screens
      .filter((screen) => {
        if (!screen.percorso) return false;
        const screenPath = screen.percorso.replace(/\/$/, "") || "/";
        return pathname === screenPath || pathname.startsWith(`${screenPath}/`);
      })
      .toSorted((left, right) => right.percorso.length - left.percorso.length)[0];
    const linkedModuleCodes = matchingScreen
      ? configuredMenu.screenLinks.filter((link) => link.schermata_codice === matchingScreen.codice).map((link) => link.modulo_codice)
      : [];

    const requestedModuleCode = location.state?.workspaceModuleCode || "";
    let moduleCode = requestedModuleCode && (linkedModuleCodes.includes(requestedModuleCode) || !matchingScreen)
      ? requestedModuleCode
      : (directMatches[0]?.catalogModule || directMatches[0]?.module || "");
    if (!moduleCode && linkedModuleCodes.length) {
      const menuOrder = new Map();
      configuredMenu.links.forEach((link, index) => menuOrder.set(
        link.modulo_codice,
        Math.min(menuOrder.get(link.modulo_codice) ?? 100000, link.ordine ?? index)
      ));
      moduleCode = [...linkedModuleCodes].toSorted((left, right) => (menuOrder.get(left) ?? 100000) - (menuOrder.get(right) ?? 100000))[0] || "";
    }

    const menuCandidates = configuredMenu?.links.filter((link) => link.modulo_codice === moduleCode) || [];
    const requestedMenuCode = location.state?.workspaceMenuCode || "";
    const menuCode = requestedMenuCode && menuCandidates.some((link) => link.voce_codice === requestedMenuCode)
      ? requestedMenuCode
      : menuCandidates.toSorted((left, right) => (left.ordine || 0) - (right.ordine || 0))[0]?.voce_codice || "";
    return { moduleCode, menuCode };
  }, [configuredMenu, location.pathname, location.state, visibleModuleItems]);

  const isMenuMemberActive = useCallback((member, menuCode = "") => {
    const moduleCode = member.catalogModule || member.module || "";
    if (activeNavigation.moduleCode) {
      return activeNavigation.moduleCode === moduleCode
        && (!activeNavigation.menuCode || !menuCode || activeNavigation.menuCode === menuCode);
    }
    const pathname = location.pathname.replace(/\/$/, "") || "/";
    const memberPath = (member.path || "").replace(/\/$/, "") || "/";
    return pathname === memberPath || (memberPath !== "/settings" && pathname.startsWith(`${memberPath}/`));
  }, [activeNavigation, location.pathname]);

  useEffect(() => {
    document.title = `${currentPage.title} · Progre Workspace`;
  }, [location.pathname, currentPage.title]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    loadNotificationCount();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const channel = supabase
      .channel(`topbar-notifications-${profile.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notifiche",
        filter: `utente_id=eq.${profile.id}`,
      }, () => {
        loadNotificationCount();
        if (notificationOpen) loadNotifications();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, notificationOpen]);

  useEffect(() => {
    const refresh = () => {
      loadNotificationCount();
      if (notificationOpen) loadNotifications();
    };
    window.addEventListener("workspace:notifications-changed", refresh);
    return () => window.removeEventListener("workspace:notifications-changed", refresh);
  }, [profile?.id, notificationOpen]);


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
      .select("id,titolo,messaggio,tipo,evento,url,task_id,letta,created_at,chat_conversazione_id,progetto_id,prodotto_id")
      .eq("utente_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (!error) setNotifications(data || []);
  }

  async function openNotifications() {
    const opening = !notificationOpen;
    setNotificationOpen(opening);
    if (opening) await loadNotifications();
  }

  async function goToNotification(notification) {
    if (!notification.letta) {
      await supabase.from("notifiche").update({ letta: true }).eq("id", notification.id);
      await loadNotificationCount();
    }
    setNotificationOpen(false);
    if (notification.tipo === "chat" && notification.chat_conversazione_id) navigate(`/messages?conversation=${notification.chat_conversazione_id}`);
    else if (notification.url) navigate(notification.url);
    else if (notification.tipo === "chat") navigate("/messages");
    else if (notification.progetto_id) navigate("/projects");
    else if (notification.prodotto_id) navigate("/products");
    else navigate(notification.task_id ? `/tasks?task=${notification.task_id}` : "/tasks");
  }

  function handleSidebarItemClick(event, item) {
    setMobileMenuOpen(false);
    setExpandedMenuCode("");
    const isProductionHub = item.module === "progremes" && item.path === "/produzione";
    if (!isProductionHub && (item.module === "progremes" || item.provider === "progremes")) {
      event.preventDefault();
      launchProgremes("", item.provider === "progremes" && item.path !== "/progremes" ? item.path : "");
      return;
    }
    if (item.special === "orders") {
      window.dispatchEvent(new CustomEvent("orders:stock-sync-requested"));
    }
  }

  function toggleMenuGroup(menuCode) {
    setExpandedMenuCode((current) => current === menuCode ? "" : menuCode);
  }

  return (
    <div className={`app-shell ${mobileMenuOpen ? "mobile-menu-is-open" : ""}`}>
      {progremesConnection.open && (
        <div className="progremes-connection-overlay" role="dialog" aria-modal="true" aria-labelledby="progremes-connection-title">
          <div className="progremes-connection-dialog">
            {!progremesConnection.error ? (
              <>
                <div className="auth-spinner" aria-hidden="true" />
                <h2 id="progremes-connection-title">Connessione in corso...</h2>
                <p>Attendi il collegamento sicuro con ProgreMES APS.</p>
              </>
            ) : (
              <>
                <h2 id="progremes-connection-title">Connessione non riuscita</h2>
                <p>{progremesConnection.error}</p>
                <div className="progremes-connection-actions">
                  <button type="button" className="secondary-action" onClick={() => setProgremesConnection({ open: false, error: "" })}>Chiudi</button>
                  <button type="button" className="primary-action" onClick={() => { setProgremesConnection({ open: false, error: "" }); window.setTimeout(() => window.dispatchEvent(new CustomEvent("workspace:launch-progremes")), 0); }}>Riprova</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {mobileMenuOpen && <button type="button" className="mobile-sidebar-overlay" aria-label="Chiudi menu" onClick={() => setMobileMenuOpen(false)} />}

      <aside id="workspace-main-menu" className={`sidebar ${mobileMenuOpen ? "mobile-open" : ""}`} aria-hidden={!mobileMenuOpen}>
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
            if (item.members?.length > 1) {
              const expanded = expandedMenuCode === item.menuCode;
              const groupActive = activeNavigation.menuCode === item.menuCode
                || item.members.some((member) => isMenuMemberActive(member, item.menuCode));
              return (
                <div className={`nav-group ${expanded ? "expanded" : ""}`} key={`menu:${item.menuCode}`}>
                  <button
                    type="button"
                    className={`nav-item nav-group-toggle ${groupActive ? "active" : ""}`}
                    onClick={() => toggleMenuGroup(item.menuCode)}
                    aria-expanded={expanded}
                    aria-controls={`submenu-${item.menuCode}`}
                  >
                    <Icon size={21} />
                    <span>{item.label}</span>
                    <ChevronDown className="nav-group-chevron" size={17} aria-hidden="true" />
                  </button>
                  <div id={`submenu-${item.menuCode}`} className="nav-submenu" hidden={!expanded}>
                    {item.members.map((member) => {
                      const MemberIcon = member.icon;
                      return (
                        <NavLink
                          key={`${item.menuCode}:${member.catalogModule || member.module}:${member.path}`}
                          to={member.path}
                          state={{ workspaceMenuCode:item.menuCode,workspaceModuleCode:member.catalogModule || member.module || "" }}
                          onClick={(event) => handleSidebarItemClick(event, member)}
                          className={() => `nav-item nav-subitem ${isMenuMemberActive(member, item.menuCode) ? "active" : ""}`}
                        >
                          <MemberIcon size={18} />
                          <span>{member.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            }
            return (
              <NavLink
                key={`${item.menuCode || item.module || "item"}:${item.path}`}
                to={item.path}
                state={{ workspaceMenuCode:item.menuCode || "",workspaceModuleCode:item.catalogModule || item.module || "" }}
                onClick={(event) => handleSidebarItemClick(event, item)}
                className={() =>
                  `nav-item ${isMenuMemberActive(item, item.menuCode) ? "active" : ""}`
                }
              >
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
            <button type="button" className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)} aria-label="Apri menu principale" aria-expanded={mobileMenuOpen} aria-controls="workspace-main-menu"><Menu size={25} /></button>
            <div><h2>{currentPage.title}</h2><p>{currentPage.subtitle}</p></div>
          </div>

          <div className="topbar-actions">
            <button type="button" className="topbar-home-btn" onClick={() => navigate("/home")} aria-label="Vai alla Home"><Home size={19} /><span>Home</span></button>
            <button type="button" className="icon-btn notification-btn" onClick={openNotifications} aria-label="Apri notifiche"><Bell size={21} />{notificationCount > 0 && <small>{notificationCount}</small>}</button>
            <button type="button" className="icon-btn notification-btn" onClick={() => navigate("/messages")} aria-label="Apri messaggi"><MessageCircle size={21} /></button>
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
              <div className="topbar-popover-footer"><button type="button" onClick={() => { setNotificationOpen(false); navigate("/notifications"); }}>Vedi tutte</button><button type="button" onClick={() => { setNotificationOpen(false); navigate("/settings/notifications"); }}>Impostazioni</button></div>
            </div>
          )}
        </header>

        <section className="content-area">
          <WorkspaceScreenLayout fallbackTitle={currentPage.title} fallbackDescription={currentPage.subtitle}>
            <Outlet context={visibleMenuItems} />
          </WorkspaceScreenLayout>
        </section>
      </main>

    </div>
  );
}

export default Layout;

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Eye, Menu, Search, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import InfoTooltip from "../../components/InfoTooltip";
import { requiresDirectModuleGrant } from "../../config/directCrmAccess";
import "./access-control.css";

const levelLabel = { nessuno: "Non visibile", lettura: "Consultazione", scrittura: "Operatività", amministrazione: "Gestione" };
const fullName = (user) => [user?.nome, user?.cognome].filter(Boolean).join(" ") || user?.email || "Utente";

export default function AccessCheck() {
  const [data, setData] = useState({ users: [], departments: [], userDepartments: [], areas: [], roleAreas: [], departmentAreas: [], modules: [], departmentModules: [], roleModules: [], screens: [], links: [], exceptions: [], menuEntries: [], menuModules: [] });
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("tutti");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [moduleAudit, setModuleAudit] = useState({ userId: "", rows: [], error: "" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const results = await Promise.all([
        supabase.from("utenti").select("id,nome,cognome,email,attivo,reparto_id,ruolo_id,ruoli(id,nome,amministratore_workspace,livello_accesso,livello_ai,ambito_dati)").order("nome"),
        supabase.from("reparti").select("id,nome"), supabase.from("utenti_reparti").select("utente_id,reparto_id"),
        supabase.from("workspace_aree").select("codice,nome,attiva,ordine").order("ordine"), supabase.from("workspace_ruoli_aree").select("ruolo_id,area_codice"), supabase.from("workspace_reparti_aree").select("reparto_id,area_codice"),
        supabase.from("workspace_moduli").select("codice,nome,area,attivo,sempre_disponibile,assegnabile_reparto,ordine").order("ordine"), supabase.from("reparti_moduli").select("reparto_id,modulo"), supabase.from("ruoli_moduli").select("ruolo_id,modulo,livello_accesso"),
        supabase.from("workspace_schermate").select("codice,nome,attiva,ordine").order("ordine"), supabase.from("workspace_moduli_schermate").select("modulo_codice,schermata_codice,ordine,visibile_menu"),
        supabase.from("workspace_eccezioni_utente").select("*").order("creata_il"),
        supabase.from("workspace_menu_voci").select("codice,nome,attiva,ordine").order("ordine"), supabase.from("workspace_menu_moduli").select("voce_codice,modulo_codice,ordine"),
      ]);
      if (cancelled) return;
      const failure = results.find((result) => result.error)?.error;
      if (failure) {
        setLoadError(failure.message);
        setLoading(false);
        return;
      }
      const [users, departments, userDepartments, areas, roleAreas, departmentAreas, modules, departmentModules, roleModules, screens, links, exceptions, menuEntries, menuModules] = results.map((result) => result.data || []);
      setData({ users, departments, userDepartments, areas, roleAreas, departmentAreas, modules, departmentModules, roleModules, screens, links, exceptions, menuEntries, menuModules });
      setSelectedId((current) => current || users[0]?.id || "");
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    async function inspect() {
      try {
        const { data: rows, error } = await supabase.rpc("workspace_inspect_module_access", { target_user_id: selectedId });
        if (!cancelled) setModuleAudit({ userId: selectedId, rows: rows || [], error: error?.message || "" });
      } catch (error) {
        if (!cancelled) setModuleAudit({ userId: selectedId, rows: [], error: error.message || "Verifica accessi non disponibile." });
      }
    }
    void inspect();
    return () => { cancelled = true; };
  }, [selectedId]);

  const auditReady = moduleAudit.userId === selectedId && !moduleAudit.error;
  const selectedUser = data.users.find((user) => user.id === selectedId);
  const result = useMemo(() => {
    if (!selectedUser || !auditReady) return { areas: [], modules: [], screens: [], menus: [] };
    const isAdmin = selectedUser.ruoli?.amministratore_workspace === true;
    const departmentIds = [...new Set([selectedUser.reparto_id, ...data.userDepartments.filter((row) => row.utente_id === selectedId).map((row) => row.reparto_id)].filter(Boolean))];
    const activeExceptions = data.exceptions.filter((item) => item.utente_id === selectedId && (!item.valida_fino_a || new Date(item.valida_fino_a) > new Date()));
    const exceptionFor = (scope, code) => activeExceptions.find((item) => item.ambito === scope && item.codice === code);
    const inheritedAreaCodes = new Set([
      ...data.roleAreas.filter((row) => row.ruolo_id === selectedUser.ruolo_id).map((row) => row.area_codice),
      ...data.departmentAreas.filter((row) => departmentIds.includes(row.reparto_id)).map((row) => row.area_codice),
    ]);
    const areas = data.areas.map((area) => {
      const exception = exceptionFor("area", area.codice);
      const allowed = isAdmin || exception?.decisione === "consenti" || (!exception && inheritedAreaCodes.has(area.codice));
      return { ...area, allowed, reason: isAdmin ? "Accesso completo amministratore" : exception ? `Eccezione personale: ${exception.decisione}` : allowed ? "Concesso da ruolo o reparto" : "Area non assegnata" };
    });
    const decisions = new Map(moduleAudit.rows.map((row) => [row.codice, row]));
    const modules = data.modules.map((module) => {
      const decision = decisions.get(module.codice);
      return { ...module, allowed: decision?.allowed === true,
        level: decision?.level || "nessuno", reason: decision?.reason || "Esito non disponibile" };
    });
    const moduleByCode = Object.fromEntries(modules.map((module) => [module.codice, module]));
    const screens = data.screens.map((screen) => {
      const exception = exceptionFor("schermata", screen.codice);
      const parents = data.links.filter((link) => link.schermata_codice === screen.codice).map((link) => moduleByCode[link.modulo_codice]).filter(Boolean);
      const inherited = screen.attiva && parents.some((module) => module.allowed);
      const channelAllowed = !parents.some((module) => requiresDirectModuleGrant(module.codice))
        || parents.some((module) => requiresDirectModuleGrant(module.codice) && module.allowed);
      const allowed = isAdmin || (channelAllowed && (exception?.decisione === "consenti" || (!exception && inherited)));
      return { ...screen, allowed, reason: isAdmin ? "Accesso completo amministratore" : !channelAllowed ? "Modulo CRM non autorizzato" : exception ? `Eccezione personale: ${exception.decisione}` : allowed ? `Visibile tramite ${parents.filter((module) => module.allowed).map((module) => module.nome).join(", ")}` : "Nessun modulo collegato accessibile" };
    });
    const menus = data.menuEntries.map((entry) => {
      const linked = data.menuModules.filter((row) => row.voce_codice === entry.codice).map((row) => moduleByCode[row.modulo_codice]).filter(Boolean);
      const allowed = entry.attiva && linked.some((module) => module.allowed);
      return { ...entry, allowed, reason: allowed ? `Contiene ${linked.filter((module) => module.allowed).map((module) => module.nome).join(", ")}` : "Nessun modulo accessibile nella voce" };
    });
    return { areas, modules, screens, menus, exceptions: activeExceptions, departmentIds, isAdmin };
  }, [data, selectedId, selectedUser, auditReady, moduleAudit]);

  const rows = useMemo(() => {
    const source = filter === "aree" ? result.areas : filter === "moduli" ? result.modules : filter === "schermate" ? result.screens : filter === "menu" ? result.menus : [...result.areas.map((item) => ({ ...item, kind: "Area" })), ...result.modules.map((item) => ({ ...item, kind: "Modulo" })), ...result.screens.map((item) => ({ ...item, kind: "Schermata" }))];
    const query = search.trim().toLowerCase();
    return source.filter((item) => !query || `${item.nome} ${item.codice} ${item.reason}`.toLowerCase().includes(query));
  }, [filter, result, search]);

  if (loading) return <div className="access-loading">Calcolo delle autorizzazioni...</div>;
  if (loadError) return <div className="access-message error" role="alert">Impossibile verificare gli accessi: {loadError}</div>;

  return <section className="access-page">
    <div className="access-check-toolbar"><label>Utente<select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>{data.users.map((user) => <option key={user.id} value={user.id}>{fullName(user)}</option>)}</select></label><label className="access-search"><Search size={17}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca nel risultato..."/></label></div>
    {selectedUser && auditReady && <div className="access-audit-summary"><div><span className="access-avatar">{`${selectedUser.nome?.[0] || ""}${selectedUser.cognome?.[0] || ""}`}</span><span><strong>{fullName(selectedUser)}</strong><small>{selectedUser.ruoli?.nome || "Nessun ruolo"}</small></span></div><div><strong>{result.areas.filter((item) => item.allowed).length}</strong><span>Aree<InfoTooltip label="Aree" text="Numero di aree che risultano accessibili all’utente dopo ruolo, reparti ed eccezioni personali." /></span></div><div><strong>{result.modules.filter((item) => item.allowed).length}</strong><span>Moduli<InfoTooltip label="Moduli" text="Numero di moduli che risultano accessibili all’utente dopo tutte le regole autorizzative." /></span></div><div><strong>{result.screens.filter((item) => item.allowed).length}</strong><span>Schermate<InfoTooltip label="Schermate" text="Numero di schermate visibili tramite i moduli autorizzati o eccezioni personali." /></span></div><div><strong>{result.exceptions?.length || 0}</strong><span>Eccezioni<InfoTooltip label="Eccezioni" text="Numero di eccezioni personali attive e non scadute applicate all’utente." /></span></div></div>}
    {selectedId && !auditReady && <div className="access-message" role="status">{moduleAudit.userId === selectedId && moduleAudit.error ? `Verifica non disponibile: ${moduleAudit.error}` : "Calcolo delle autorizzazioni effettive..."}</div>}
    {auditReady && <>
    <nav className="access-audit-filters">{[["tutti","Tutto",Eye],["menu","Menu",Menu],["aree","Aree",ShieldCheck],["moduli","Moduli",CheckCircle2],["schermate","Schermate",Bot]].map(([code,label,Icon]) => <button type="button" key={code} className={filter === code ? "active" : ""} onClick={() => setFilter(code)}><Icon size={16}/>{label}</button>)}</nav>
    <div className="access-audit-table"><div className="head"><span>Elemento</span><span>Esito</span><span>Livello</span><span>Motivazione</span></div>{rows.map((item) => <div key={`${item.kind || filter}:${item.codice}`}><span><strong>{item.nome}</strong><small>{item.kind || (filter === "tutti" ? "Elemento" : filter.slice(0,-1))} · {item.codice}</small></span><span className={item.allowed ? "allowed" : "denied"}>{item.allowed ? <CheckCircle2 size={16}/> : <XCircle size={16}/>} {item.allowed ? "Visibile" : "Non visibile"}</span><span>{levelLabel[item.level] || (item.allowed ? "Disponibile" : "-")}</span><span>{item.reason}</span></div>)}{!rows.length && <p>Nessun risultato.</p>}</div>
    </>}
  </section>;
}

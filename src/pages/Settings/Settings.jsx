import { useEffect, useMemo, useState } from "react";
import { Building2, ClipboardList, Pencil, Plus, Save, Search, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import ProjectTypesSettings from "../../components/ProjectTypesSettings";

const emptyDepartment = { nome: "", descrizione: "", attivo: true };
const emptyRole = { nome: "", descrizione: "", livello: 40, permessi: [] };
const emptyTemplate = { titolo: "", reparto_id: "", reparto_ids: [], ordine: 1, attivo: true };
const emptyUserAccess = {
  ruolo_id: "",
  attivo: true,
  reparti: [],
  workspace_mexal_agente_id: "",
  agenti_coordinati: [],
  beauty_enabled: false,
  beauty_access_level: "read",
  beauty_role: "beauty",
  beauty_mexal_agente_id: "",
  beauty_pages: ["dashboard", "aperture", "giornate", "analisi"],
  orders_pr_enabled: false,
  orders_pr_role: "agente",
  orders_ph_enabled: false,
  orders_ph_role: "agente",
};

const beautyPages = [
  ["dashboard", "Dashboard"],
  ["aperture", "Aperture / Contatti"],
  ["giornate", "Giornate"],
  ["analisi", "Analisi dati"],
];

const permissionLabels = {
  "projects.read": "Vede progetti dei propri reparti",
  "projects.read.all": "Vede tutti i progetti",
  "projects.write": "Crea e modifica progetti/task",
  "tasks.read": "Vede task dei propri reparti",
  "tasks.read.project_departments": "Vede tutte le task dei progetti dei propri reparti",
  "tasks.write": "Aggiorna task/commenti/allegati",
  "agenda.read": "Vede la propria agenda",
  "agenda.read.all": "Vede tutte le agende",
  "agenda.write": "Crea/modifica appuntamenti",
  "messages.read": "Legge messaggi",
  "messages.write": "Invia messaggi",
  "reports.read": "Vede report",
  "reports.write": "Modifica report",
  "products.read": "Vede prodotti",
  "products.write": "Modifica prodotti",
  "settings.manage": "Gestisce impostazioni",
  "users.manage": "Gestisce utenti, ruoli e reparti",
};

export default function Settings() {
  const { hasPermission, profile, reloadProfile } = useAuth();
  const canManage = hasPermission("settings.manage") || hasPermission("users.manage");

  const [tab, setTab] = useState("team");
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [users, setUsers] = useState([]);
  const [userDepartments, setUserDepartments] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [rolePermissions, setRolePermissions] = useState([]);
  const [templateDepartments, setTemplateDepartments] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [mexalAgents, setMexalAgents] = useState([]);
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState({ open: false, type: "checklist", item: null });
  const [departmentForm, setDepartmentForm] = useState(emptyDepartment);
  const [roleForm, setRoleForm] = useState(emptyRole);
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [userAccessForm, setUserAccessForm] = useState(emptyUserAccess);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [departmentsRes, rolesRes, templatesRes, usersRes, userDepartmentsRes, permissionsRes, rolePermissionsRes, templateDepartmentsRes, integrationsRes, agentsRes] = await Promise.all([
      supabase.from("reparti").select("*").order("nome"),
      supabase.from("ruoli").select("*").order("livello", { ascending: false }),
      supabase.from("checklist_template").select("*,reparti(id,nome)").order("ordine", { ascending: true }),
      supabase.from("utenti").select("id,auth_user_id,nome,cognome,email,telefono,attivo,ruolo_id,mexal_agente_id,ruoli(id,nome,livello)").order("nome"),
      supabase.from("utenti_reparti").select("id,utente_id,reparto_id"),
      supabase.from("permessi").select("id,codice,descrizione").order("codice"),
      supabase.from("permessi_ruolo").select("ruolo_id,permesso_id,permessi(id,codice,descrizione)"),
      supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
      supabase.from("integrazioni_utenti").select("*").in("modulo", ["report_giornate", "gestione_ordini", "gestione_ordini_pr", "gestione_ordini_ph"]),
      supabase.from("mexal_agenti").select("id,codice,nome,cognome,attivo_mexal,workspace_utente_id,responsabile_utente_id").order("cognome"),
    ]);

    if (departmentsRes.error) console.error("Errore reparti:", departmentsRes.error.message);
    if (rolesRes.error) console.error("Errore ruoli:", rolesRes.error.message);
    if (templatesRes.error) console.error("Errore checklist:", templatesRes.error.message);
    if (usersRes.error) console.error("Errore utenti:", usersRes.error.message);
    if (userDepartmentsRes.error) console.error("Errore utenti_reparti:", userDepartmentsRes.error.message);
    if (permissionsRes.error) console.error("Errore permessi:", permissionsRes.error.message);
    if (rolePermissionsRes.error) console.error("Errore permessi_ruolo:", rolePermissionsRes.error.message);
    if (templateDepartmentsRes.error) console.error("Errore reparti checklist:", templateDepartmentsRes.error.message);
    if (integrationsRes.error) console.error("Errore integrazioni utenti:", integrationsRes.error.message);
    if (agentsRes.error) console.error("Errore agenti Mexal:", agentsRes.error.message);

    setDepartments(departmentsRes.data || []);
    setRoles(rolesRes.data || []);
    setTemplates(templatesRes.data || []);
    setUsers(usersRes.data || []);
    setUserDepartments(userDepartmentsRes.data || []);
    setPermissions(permissionsRes.data || []);
    setRolePermissions(rolePermissionsRes.data || []);
    setTemplateDepartments(templateDepartmentsRes.data || []);
    setIntegrations(integrationsRes.data || []);
    setMexalAgents(agentsRes.data || []);
  }

  const activeDepartments = useMemo(() => departments.filter((item) => item.attivo !== false), [departments]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!normalizedSearch) return users;
    return users.filter((user) => {
      const role = user.ruoli?.nome || "";
      const userDepartmentIds = userDepartments
        .filter((row) => row.utente_id === user.id && row.reparto_id)
        .map((row) => row.reparto_id);
      const departmentsText = userDepartmentIds
        .map((id) => departments.find((department) => department.id === id)?.nome)
        .filter(Boolean)
        .join(" ");
      return `${user.nome || ""} ${user.cognome || ""} ${user.email || ""} ${role} ${departmentsText}`.toLowerCase().includes(normalizedSearch);
    });
  }, [normalizedSearch, users, userDepartments, departments]);
  const filteredDepartments = useMemo(() => departments.filter((item) => !normalizedSearch || `${item.nome || ""} ${item.descrizione || ""}`.toLowerCase().includes(normalizedSearch)), [departments, normalizedSearch]);
  const filteredRoles = useMemo(() => roles.filter((item) => {
    const permissionText = rolePermissions.filter((row) => row.ruolo_id === item.id).map((row) => row.permessi?.codice || "").join(" ");
    return !normalizedSearch || `${item.nome || ""} ${item.descrizione || ""} ${permissionText}`.toLowerCase().includes(normalizedSearch);
  }), [roles, rolePermissions, normalizedSearch]);
  const filteredTemplates = useMemo(() => templates.filter((item) => {
    const departmentIds = templateDepartments.filter((row) => row.template_id === item.id).map((row) => row.reparto_id);
    const departmentText = departmentIds.map((id) => departments.find((department) => department.id === id)?.nome || "").join(" ");
    return !normalizedSearch || `${item.titolo || ""} ${item.reparti?.nome || ""} ${departmentText}`.toLowerCase().includes(normalizedSearch);
  }), [templates, templateDepartments, departments, normalizedSearch]);

  function getUserDepartmentIds(userId) {
    return userDepartments.filter((row) => row.utente_id === userId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getUserDepartmentNames(userId) {
    const ids = getUserDepartmentIds(userId);
    const names = ids.map((id) => departments.find((department) => department.id === id)?.nome).filter(Boolean);
    return names.length ? names.join(", ") : "Nessun reparto associato";
  }

  function getRolePermissionIds(roleId) {
    return rolePermissions.filter((row) => row.ruolo_id === roleId && row.permesso_id).map((row) => row.permesso_id);
  }

  function getRolePermissionCodes(roleId) {
    return rolePermissions
      .filter((row) => row.ruolo_id === roleId)
      .map((row) => row.permessi?.codice)
      .filter(Boolean);
  }

  function getTemplateDepartmentIds(templateId) {
    return templateDepartments.filter((row) => row.template_id === templateId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getTemplateDepartmentNames(templateId, fallbackName = "Tutti i reparti") {
    const names = getTemplateDepartmentIds(templateId)
      .map((id) => departments.find((department) => department.id === id)?.nome)
      .filter(Boolean);
    return names.length ? names.join(", ") : fallbackName;
  }

  function openCreate(type) {
    setModal({ open: true, type, item: null });
    setDepartmentForm(emptyDepartment);
    setRoleForm(emptyRole);
    setTemplateForm(emptyTemplate);
    setUserAccessForm(emptyUserAccess);
  }

  function openEdit(type, item) {
    setModal({ open: true, type, item });

    if (type === "reparto") {
      setDepartmentForm({ nome: item.nome || "", descrizione: item.descrizione || "", attivo: item.attivo !== false });
    }

    if (type === "ruolo") {
      setRoleForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        livello: item.livello || 40,
        permessi: getRolePermissionIds(item.id),
      });
    }

    if (type === "checklist") {
      const ids = getTemplateDepartmentIds(item.id);
      setTemplateForm({
        titolo: item.titolo || "",
        reparto_id: ids[0] || item.reparto_id || "",
        reparto_ids: ids.length ? ids : (item.reparto_id ? [item.reparto_id] : []),
        ordine: item.ordine || 1,
        attivo: item.attivo !== false,
      });
    }

    if (type === "utente_accessi") {
      const beautyAccess = integrations.find((row) => row.utente_id === item.id && row.modulo === "report_giornate");
      const legacyOrdersAccess = integrations.find((row) => row.utente_id === item.id && row.modulo === "gestione_ordini");
      const ordersPrAccess = integrations.find((row) => row.utente_id === item.id && row.modulo === "gestione_ordini_pr") || legacyOrdersAccess;
      const ordersPhAccess = integrations.find((row) => row.utente_id === item.id && row.modulo === "gestione_ordini_ph") || legacyOrdersAccess;
      const linkedAgent = mexalAgents.find((agent) => agent.workspace_utente_id === item.id);
      setUserAccessForm({
        ruolo_id: item.ruolo_id || "",
        attivo: item.attivo !== false,
        reparti: getUserDepartmentIds(item.id),
        workspace_mexal_agente_id: linkedAgent?.id || item.mexal_agente_id || "",
        agenti_coordinati: mexalAgents.filter((agent) => agent.responsabile_utente_id === item.id).map((agent) => agent.id),
        beauty_enabled: beautyAccess?.enabled === true,
        beauty_access_level: beautyAccess?.access_level || "read",
        beauty_role: beautyAccess?.external_role || "beauty",
        beauty_mexal_agente_id: beautyAccess?.mexal_agente_id || "",
        beauty_pages: Array.isArray(beautyAccess?.allowed_pages) ? beautyAccess.allowed_pages : emptyUserAccess.beauty_pages,
        orders_pr_enabled: ordersPrAccess?.enabled === true,
        orders_pr_role: ordersPrAccess?.ruolo_ordini || "agente",
        orders_ph_enabled: ordersPhAccess?.enabled === true,
        orders_ph_role: ordersPhAccess?.ruolo_ordini || "agente",
      });
    }
  }

  function closeModal() {
    setModal({ open: false, type: "checklist", item: null });
    setUserAccessForm(emptyUserAccess);
  }

  function toggleListValue(setter, field, value) {
    setter((current) => {
      const list = Array.isArray(current[field]) ? current[field] : [];
      return {
        ...current,
        [field]: list.includes(value) ? list.filter((id) => id !== value) : [...list, value],
      };
    });
  }

  async function saveReparto(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    const payload = { nome: departmentForm.nome.trim(), descrizione: departmentForm.descrizione.trim() || null, attivo: departmentForm.attivo };
    if (!payload.nome) return alert("Inserisci il nome del reparto.");
    setSaving(true);
    const request = modal.item ? supabase.from("reparti").update(payload).eq("id", modal.item.id) : supabase.from("reparti").insert(payload);
    const { error } = await request;
    setSaving(false);
    if (error) return alert(error.message);
    closeModal();
    await loadData();
  }

  async function saveRuolo(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    const payload = { nome: roleForm.nome.trim(), descrizione: roleForm.descrizione.trim() || null, livello: Number(roleForm.livello) || 0 };
    if (!payload.nome) return alert("Inserisci il nome del ruolo.");

    setSaving(true);
    const request = modal.item
      ? supabase.from("ruoli").update(payload).eq("id", modal.item.id).select().single()
      : supabase.from("ruoli").insert(payload).select().single();

    const { data, error } = await request;
    if (error) {
      setSaving(false);
      return alert(error.message);
    }

    const roleId = data?.id || modal.item?.id;
    await supabase.from("permessi_ruolo").delete().eq("ruolo_id", roleId);

    const rows = (roleForm.permessi || []).map((permesso_id) => ({ ruolo_id: roleId, permesso_id }));
    if (rows.length > 0) {
      const insertRes = await supabase.from("permessi_ruolo").insert(rows);
      if (insertRes.error) {
        setSaving(false);
        return alert(insertRes.error.message);
      }
    }

    setSaving(false);
    closeModal();
    await loadData();
    if (reloadProfile) await reloadProfile();
  }

  async function saveTemplate(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    const selectedDepartmentIds = Array.isArray(templateForm.reparto_ids) ? templateForm.reparto_ids.filter(Boolean) : [];
    const payload = {
      titolo: templateForm.titolo.trim(),
      reparto_id: selectedDepartmentIds[0] || null,
      ordine: Number(templateForm.ordine) || 1,
      attivo: templateForm.attivo,
    };
    if (!payload.titolo) return alert("Inserisci la voce checklist.");

    setSaving(true);
    const request = modal.item
      ? supabase.from("checklist_template").update(payload).eq("id", modal.item.id).select("id").single()
      : supabase.from("checklist_template").insert(payload).select("id").single();

    const { data, error } = await request;
    if (error) {
      setSaving(false);
      return alert(error.message);
    }

    const templateId = data?.id || modal.item?.id;
    await supabase.from("checklist_template_reparti").delete().eq("template_id", templateId);

    const rows = selectedDepartmentIds.map((reparto_id) => ({ template_id: templateId, reparto_id }));
    if (rows.length > 0) {
      const insertRes = await supabase.from("checklist_template_reparti").insert(rows);
      if (insertRes.error) {
        setSaving(false);
        return alert(insertRes.error.message);
      }
    }

    setSaving(false);
    closeModal();
    await loadData();
  }

  async function saveUserAccess(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    if (!modal.item?.id) return alert("Utente non selezionato.");
    if (userAccessForm.beauty_enabled && userAccessForm.beauty_role === "beauty" && (!modal.item.nome?.trim() || !modal.item.email?.trim())) {
      return alert("Per abilitare Beauty Days come Beauty sono obbligatori nome ed email dell'utente.");
    }

    setSaving(true);

    const updateUser = await supabase
      .from("utenti")
      .update({ ruolo_id: userAccessForm.ruolo_id || null, attivo: userAccessForm.attivo })
      .eq("id", modal.item.id);

    if (updateUser.error) {
      setSaving(false);
      return alert(updateUser.error.message);
    }

    const deleteRes = await supabase.from("utenti_reparti").delete().eq("utente_id", modal.item.id);
    if (deleteRes.error) {
      setSaving(false);
      return alert(deleteRes.error.message);
    }

    const rows = (userAccessForm.reparti || []).map((reparto_id) => ({ utente_id: modal.item.id, reparto_id }));
    if (rows.length > 0) {
      const insertRes = await supabase.from("utenti_reparti").insert(rows);
      if (insertRes.error) {
        setSaving(false);
        return alert(insertRes.error.message);
      }
    }

    const currentLinkedAgent = mexalAgents.find((agent) => agent.workspace_utente_id === modal.item.id);
    if (currentLinkedAgent && currentLinkedAgent.id !== userAccessForm.workspace_mexal_agente_id) {
      const unlinkRes = await supabase.from("mexal_agenti").update({ workspace_utente_id: null }).eq("id", currentLinkedAgent.id);
      if (unlinkRes.error) {
        setSaving(false);
        return alert(unlinkRes.error.message);
      }
    }
    if (userAccessForm.workspace_mexal_agente_id) {
      const linkRes = await supabase.from("mexal_agenti").update({ workspace_utente_id: modal.item.id }).eq("id", userAccessForm.workspace_mexal_agente_id);
      if (linkRes.error) {
        setSaving(false);
        return alert(linkRes.error.message);
      }
    }

    const managedNow = mexalAgents.filter((agent) => agent.responsabile_utente_id === modal.item.id);
    const removedManagedIds = managedNow.filter((agent) => !userAccessForm.agenti_coordinati.includes(agent.id)).map((agent) => agent.id);
    if (removedManagedIds.length) {
      const removeManagedRes = await supabase.from("mexal_agenti").update({ responsabile_utente_id: null }).in("id", removedManagedIds);
      if (removeManagedRes.error) {
        setSaving(false);
        return alert(removeManagedRes.error.message);
      }
    }
    if (userAccessForm.agenti_coordinati.length) {
      const manageRes = await supabase.from("mexal_agenti").update({ responsabile_utente_id: modal.item.id }).in("id", userAccessForm.agenti_coordinati);
      if (manageRes.error) {
        setSaving(false);
        return alert(manageRes.error.message);
      }
    }

    const beautyExisting = integrations.find((row) => row.utente_id === modal.item.id && row.modulo === "report_giornate");
    let external = {
      external_user_id: beautyExisting?.external_user_id || null,
      external_beauty_id: beautyExisting?.external_beauty_id || null,
      external_agent_id: beautyExisting?.external_agent_id || null,
    };
    if (userAccessForm.beauty_enabled && userAccessForm.beauty_role === "beauty") {
      const ensureRes = await supabase.functions.invoke("report-giornate-api", {
        body: {
          action: "ensure-external-user",
          ruolo: userAccessForm.beauty_role,
          nome: modal.item.nome || "",
          cognome: modal.item.cognome || "",
          email: modal.item.email || "",
          telefono: modal.item.telefono || "",
          ...external,
        },
      });
      if (ensureRes.error || ensureRes.data?.error) {
        setSaving(false);
        return alert(await getFunctionErrorMessage(ensureRes.error, ensureRes.data?.error));
      }
      external = { ...external, ...ensureRes.data };
    }

    const beautyRes = await supabase.from("integrazioni_utenti").upsert({
      utente_id: modal.item.id,
      modulo: "report_giornate",
      enabled: userAccessForm.beauty_enabled,
      access_level: userAccessForm.beauty_access_level,
      external_role: userAccessForm.beauty_role,
      mexal_agente_id: userAccessForm.beauty_mexal_agente_id || null,
      allowed_pages: userAccessForm.beauty_pages,
      external_user_id: userAccessForm.beauty_role === "beauty" ? external.external_user_id || null : null,
      external_beauty_id: userAccessForm.beauty_role === "beauty" ? external.external_beauty_id || null : null,
      external_agent_id: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "utente_id,modulo" });
    if (beautyRes.error) {
      setSaving(false);
      return alert(beautyRes.error.message);
    }

    const ordersPrRes = await supabase.from("integrazioni_utenti").upsert({
      utente_id: modal.item.id,
      modulo: "gestione_ordini_pr",
      enabled: userAccessForm.orders_pr_enabled,
      ruolo_ordini: userAccessForm.orders_pr_role,
      codice_agente_mexal: null,
      agenti_gestiti: [],
      updated_at: new Date().toISOString(),
    }, { onConflict: "utente_id,modulo" });
    if (ordersPrRes.error) {
      setSaving(false);
      return alert(ordersPrRes.error.message);
    }

    const ordersPhRes = await supabase.from("integrazioni_utenti").upsert({
      utente_id: modal.item.id,
      modulo: "gestione_ordini_ph",
      enabled: userAccessForm.orders_ph_enabled,
      ruolo_ordini: userAccessForm.orders_ph_role,
      codice_agente_mexal: null,
      agenti_gestiti: [],
      updated_at: new Date().toISOString(),
    }, { onConflict: "utente_id,modulo" });
    if (ordersPhRes.error) {
      setSaving(false);
      return alert(ordersPhRes.error.message);
    }

    setSaving(false);
    closeModal();
    await loadData();
    if (reloadProfile) await reloadProfile();
  }

  async function remove(type, item) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!window.confirm("Confermi eliminazione?")) return;
    const table = type === "reparto" ? "reparti" : type === "ruolo" ? "ruoli" : "checklist_template";
    const { error } = await supabase.from(table).delete().eq("id", item.id);
    if (error) return alert(error.message);
    await loadData();
  }

  async function getFunctionErrorMessage(error, fallback) {
    if (fallback) return fallback;
    const response = error?.context;
    if (response && typeof response.clone === "function") {
      try {
        const payload = await response.clone().json();
        if (payload?.error) return payload.error;
      } catch {
        // La risposta può non essere JSON: in quel caso usiamo il messaggio disponibile.
      }
    }
    return error?.message || "Errore durante l'aggiornamento degli accessi.";
  }

  async function deleteUser(item) {
    if (!canManage) return alert("Non hai i permessi.");
    if (item.id === profile?.id) return alert("Non puoi eliminare il tuo stesso utente.");
    const name = `${item.nome || ""} ${item.cognome || ""}`.trim() || item.email || "questo utente";
    if (!window.confirm(`Eliminare definitivamente ${name}?\n\nVerranno rimossi l'account di accesso, il profilo workspace e gli eventuali profili collegati a Beauty Days. Le attività già registrate resteranno archiviate.`)) return;

    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-manage-user", {
      body: { action: "delete", id: item.id, auth_user_id: item.auth_user_id },
    });
    setSaving(false);
    if (error || data?.error) return alert(error?.message || data?.error || "Eliminazione non riuscita.");
    closeModal();
    await loadData();
  }

  return (
    <div className="settings-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Impostazioni</h1>
          <p>Gestione checklist, reparti, ruoli, permessi e accessi utenti.</p>
        </div>
      </div>

      <div className="settings-area-cards">
        <button className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}><span className="settings-area-icon"><UserRound /></span><span><strong>Team</strong><small>Utenti, accessi, moduli e relazioni</small></span></button>
        <button className={tab === "organization" ? "active" : ""} onClick={() => setTab("organization")}><span className="settings-area-icon"><Building2 /></span><span><strong>Reparti / ruoli</strong><small>Struttura, ruoli e permessi</small></span></button>
        <button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}><span className="settings-area-icon"><ClipboardList /></span><span><strong>Voci di progetto</strong><small>Checklist, tipi e fasi di progetto</small></span></button>
      </div>

      <div className="settings-section-heading">
        <div><span>{tab === "team" ? "TEAM" : tab === "organization" ? "REPARTI / RUOLI" : "VOCI DI PROGETTO"}</span><h2>{tab === "team" ? "Gestione completa del team" : tab === "organization" ? "Organizzazione e autorizzazioni" : "Configurazione dei progetti"}</h2></div>
        <label className="settings-global-search"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ricerca rapida in questa schermata..." />{search && <button type="button" onClick={() => setSearch("")}><X size={16} /></button>}</label>
      </div>

      {tab === "team" && (
        <div className="panel settings-panel">
          <div className="panel-header"><div><h3>Utenti e autorizzazioni</h3><p>Una sola scheda per ruolo, reparti, relazioni Mexal e accesso ai moduli.</p></div><ShieldCheck size={28} /></div>
          <div className="settings-list">
            {filteredUsers.map((item) => {
              const beautyAccess = integrations.find((row) => row.utente_id === item.id && row.modulo === "report_giornate");
              const legacyOrders = integrations.find((row) => row.utente_id === item.id && row.modulo === "gestione_ordini");
              const ordersPrAccess = integrations.find((row) => row.utente_id === item.id && row.modulo === "gestione_ordini_pr") || legacyOrders;
              const ordersPhAccess = integrations.find((row) => row.utente_id === item.id && row.modulo === "gestione_ordini_ph") || legacyOrders;
              const linkedAgent = mexalAgents.find((agent) => agent.workspace_utente_id === item.id);
              return <div className="settings-row" key={item.id}><div><strong>{`${item.nome || ""} ${item.cognome || ""}`.trim() || item.email || "Utente senza nome"}</strong><span>{item.email || "Email non disponibile"}</span><span>Ruolo: {item.ruoli?.nome || "Nessun ruolo"} · Reparti: {getUserDepartmentNames(item.id)}</span><span>Agente Mexal: {linkedAgent ? `${linkedAgent.codice} · ${`${linkedAgent.nome || ""} ${linkedAgent.cognome || ""}`.trim()}` : "Non associato"}</span><span>Moduli: Beauty Days {beautyAccess?.enabled ? "attivo" : "non attivo"} · Ordini PR {ordersPrAccess?.enabled ? "attivo" : "non attivo"} · Ordini PH {ordersPhAccess?.enabled ? "attivo" : "non attivo"}</span></div><span className={`config-status ${item.attivo !== false ? "active" : "inactive"}`}>{item.attivo !== false ? "Attivo" : "Disattivo"}</span><div className="config-actions"><button title="Modifica configurazione completa" onClick={() => openEdit("utente_accessi", item)}><Pencil size={16} /></button>{canManage && item.id !== profile?.id && <button title="Elimina definitivamente" className="danger" onClick={() => deleteUser(item)}><Trash2 size={16} /></button>}</div></div>;
            })}
            {filteredUsers.length === 0 && <p>Nessun utente corrisponde alla ricerca.</p>}
          </div>
        </div>
      )}

      {tab === "organization" && (
        <div className="settings-two-columns">
          <div className="panel settings-panel"><div className="panel-header"><div><h3>Reparti</h3><p>Struttura organizzativa del workspace.</p></div>{canManage && <button className="primary-action" onClick={() => openCreate("reparto")}><Plus size={18} />Nuovo</button>}</div><div className="settings-list">{filteredDepartments.map((item) => <div className="settings-row" key={item.id}><div><strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span></div><span className={`config-status ${item.attivo ? "active" : "inactive"}`}>{item.attivo ? "Attivo" : "Disattivo"}</span><div className="config-actions"><button onClick={() => openEdit("reparto", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("reparto", item)}><Trash2 size={16} /></button></div></div>)}{filteredDepartments.length === 0 && <p>Nessun reparto corrisponde alla ricerca.</p>}</div></div>
          <div className="panel settings-panel"><div className="panel-header"><div><h3>Ruoli, permessi e moduli</h3><p>Definisci ogni ruolo e le autorizzazioni associate.</p></div>{canManage && <button className="primary-action" onClick={() => openCreate("ruolo")}><Plus size={18} />Nuovo</button>}</div><div className="settings-list">{filteredRoles.map((item) => { const codes = getRolePermissionCodes(item.id); return <div className="settings-row" key={item.id}><div><strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span><span>Permessi e moduli: {codes.length ? codes.map((code) => permissionLabels[code] || code).join(", ") : "Nessuno"}</span></div><span className="role-level">Livello {item.livello}</span><div className="config-actions"><button onClick={() => openEdit("ruolo", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("ruolo", item)}><Trash2 size={16} /></button></div></div>; })}{filteredRoles.length === 0 && <p>Nessun ruolo corrisponde alla ricerca.</p>}</div></div>
        </div>
      )}

      {tab === "projects" && (
        <div className="settings-project-stack">
          <div className="panel settings-panel"><div className="panel-header"><div><h3>Voci checklist preimpostate</h3><p>Voci riutilizzabili nelle fasi dei progetti.</p></div>{canManage && <button className="primary-action" onClick={() => openCreate("checklist")}><Plus size={18} />Nuova voce</button>}</div><div className="settings-list">{filteredTemplates.map((item) => <div className="settings-row" key={item.id}><div><strong>{item.titolo}</strong><span>{getTemplateDepartmentNames(item.id, item.reparti?.nome || "Tutti i reparti")}</span></div><span className={`config-status ${item.attivo ? "active" : "inactive"}`}>{item.attivo ? "Attiva" : "Disattiva"}</span><span className="role-level">Ordine {item.ordine}</span><div className="config-actions"><button onClick={() => openEdit("checklist", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("checklist", item)}><Trash2 size={16} /></button></div></div>)}{filteredTemplates.length === 0 && <p>Nessuna voce corrisponde alla ricerca.</p>}</div></div>
          <ProjectTypesSettings canManage={canManage} searchTerm={search} />
        </div>
      )}

      {modal.open && (
        <div className="modal-backdrop">
          <form className="modal-card v4-modal" onSubmit={modal.type === "reparto" ? saveReparto : modal.type === "ruolo" ? saveRuolo : modal.type === "utente_accessi" ? saveUserAccess : saveTemplate}>
            <div className="modal-header"><h2>{modal.type === "utente_accessi" ? `Accessi di ${`${modal.item?.nome || ""} ${modal.item?.cognome || ""}`.trim() || modal.item?.email || "utente"}` : modal.item ? "Modifica" : "Nuovo"}</h2><button type="button" onClick={closeModal}><X size={20} /></button></div>

            {modal.type === "reparto" && <><label>Nome reparto<input value={departmentForm.nome} onChange={(e) => setDepartmentForm({ ...departmentForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={departmentForm.descrizione} onChange={(e) => setDepartmentForm({ ...departmentForm, descrizione: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={departmentForm.attivo} onChange={(e) => setDepartmentForm({ ...departmentForm, attivo: e.target.checked })} />Attivo</label></>}

            {modal.type === "ruolo" && <><label>Nome ruolo<input value={roleForm.nome} onChange={(e) => setRoleForm({ ...roleForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={roleForm.descrizione} onChange={(e) => setRoleForm({ ...roleForm, descrizione: e.target.value })} /></label><label>Livello<input type="number" value={roleForm.livello} onChange={(e) => setRoleForm({ ...roleForm, livello: e.target.value })} /></label><div className="checkbox-group scrollable-check-group"><strong>Permessi del ruolo</strong>{permissions.map((permission) => (<label key={permission.id}><input type="checkbox" checked={(roleForm.permessi || []).includes(permission.id)} onChange={() => toggleListValue(setRoleForm, "permessi", permission.id)} />{permission.codice} · {permission.descrizione || permissionLabels[permission.codice] || ""}</label>))}{permissions.length === 0 && <p>Nessun permesso disponibile. Esegui prima la query SQL.</p>}</div></>}

            {modal.type === "checklist" && <><label>Voce checklist<input value={templateForm.titolo} onChange={(e) => setTemplateForm({ ...templateForm, titolo: e.target.value })} /></label><div className="checkbox-group scrollable-check-group"><strong>Reparti collegati alla voce checklist</strong><p className="muted">Se non selezioni reparti, la voce sarà valida per tutti i reparti.</p>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(templateForm.reparto_ids || []).includes(department.id)} onChange={() => toggleListValue(setTemplateForm, "reparto_ids", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div><label>Ordine<input type="number" value={templateForm.ordine} onChange={(e) => setTemplateForm({ ...templateForm, ordine: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={templateForm.attivo} onChange={(e) => setTemplateForm({ ...templateForm, attivo: e.target.checked })} />Attiva</label></>}

            {modal.type === "utente_accessi" && <>
              <h3>Profilo workspace</h3>
              <label>Ruolo<select value={userAccessForm.ruolo_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, ruolo_id: e.target.value })}><option value="">Nessun ruolo</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.nome} · livello {role.livello}</option>)}</select></label>
              <label className="check-line"><input type="checkbox" checked={userAccessForm.attivo} onChange={(e) => setUserAccessForm({ ...userAccessForm, attivo: e.target.checked })} />Utente attivo</label>
              <div className="checkbox-group scrollable-check-group"><strong>Reparti dell'utente</strong>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(userAccessForm.reparti || []).includes(department.id)} onChange={() => toggleListValue(setUserAccessForm, "reparti", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div>

              <h3>Relazioni organizzative</h3>
              <p className="muted">L'agente e il codice agente provengono esclusivamente da Mexal. Le associazioni sono facoltative.</p>
              <label>Identità agente dell'utente<select value={userAccessForm.workspace_mexal_agente_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, workspace_mexal_agente_id: e.target.value })}><option value="">Utente non agente</option>{mexalAgents.filter((agent) => agent.attivo_mexal !== false && (!agent.workspace_utente_id || agent.workspace_utente_id === modal.item?.id)).map((agent) => <option key={agent.id} value={agent.id}>{agent.codice} · {`${agent.nome || ""} ${agent.cognome || ""}`.trim()}</option>)}</select></label>
              <div className="checkbox-group scrollable-check-group"><strong>Agenti coordinati dal responsabile</strong>{mexalAgents.filter((agent) => agent.attivo_mexal !== false && agent.workspace_utente_id !== modal.item?.id).map((agent) => (<label key={agent.id}><input type="checkbox" checked={userAccessForm.agenti_coordinati.includes(agent.id)} onChange={() => toggleListValue(setUserAccessForm, "agenti_coordinati", agent.id)} />{agent.codice} · {`${agent.nome || ""} ${agent.cognome || ""}`.trim()}</label>))}{mexalAgents.length === 0 && <p>Sincronizza prima gli agenti da Mexal.</p>}</div>

              <h3>Accesso Beauty Days</h3>
              <label className="check-line"><input type="checkbox" checked={userAccessForm.beauty_enabled} onChange={(e) => setUserAccessForm({ ...userAccessForm, beauty_enabled: e.target.checked })} />Abilita Beauty Days</label>
              {userAccessForm.beauty_enabled && <>
                <label>Ruolo nel modulo<select value={userAccessForm.beauty_role} onChange={(e) => setUserAccessForm({ ...userAccessForm, beauty_role: e.target.value })}><option value="beauty">Beauty</option><option value="agent">Agente</option><option value="admin">Amministratore</option></select></label>
                {userAccessForm.beauty_role === "beauty" && <label>Agente commerciale associato alla Beauty<select value={userAccessForm.beauty_mexal_agente_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, beauty_mexal_agente_id: e.target.value })}><option value="">Nessun agente associato</option>{mexalAgents.filter((agent) => agent.attivo_mexal !== false).map((agent) => <option key={agent.id} value={agent.id}>{agent.codice} · {`${agent.nome || ""} ${agent.cognome || ""}`.trim()}</option>)}</select></label>}
                <label>Livello di accesso<select value={userAccessForm.beauty_access_level} onChange={(e) => setUserAccessForm({ ...userAccessForm, beauty_access_level: e.target.value })}><option value="read">Lettura</option><option value="write">Lettura e modifica</option><option value="admin">Amministrazione</option></select></label>
                <div className="checkbox-group"><strong>Pagine disponibili</strong>{beautyPages.map(([id, label]) => <label key={id}><input type="checkbox" checked={userAccessForm.beauty_pages.includes(id)} onChange={() => toggleListValue(setUserAccessForm, "beauty_pages", id)} />{label}</label>)}</div>
              </>}

              <h3>Accesso Ordini PR</h3>
              <label className="check-line"><input type="checkbox" checked={userAccessForm.orders_pr_enabled} onChange={(e) => setUserAccessForm({ ...userAccessForm, orders_pr_enabled: e.target.checked })} />Abilita Ordini PR</label>
              {userAccessForm.orders_pr_enabled && <label>Ruolo in Ordini PR<select value={userAccessForm.orders_pr_role} onChange={(e) => setUserAccessForm({ ...userAccessForm, orders_pr_role: e.target.value })}><option value="agente">Agente</option><option value="area_manager">Responsabile / Area Manager</option><option value="backoffice">Backoffice</option></select></label>}

              <h3>Accesso Ordini PH</h3>
              <label className="check-line"><input type="checkbox" checked={userAccessForm.orders_ph_enabled} onChange={(e) => setUserAccessForm({ ...userAccessForm, orders_ph_enabled: e.target.checked })} />Abilita Ordini PH</label>
              {userAccessForm.orders_ph_enabled && <label>Ruolo in Ordini PH<select value={userAccessForm.orders_ph_role} onChange={(e) => setUserAccessForm({ ...userAccessForm, orders_ph_role: e.target.value })}><option value="agente">Agente</option><option value="area_manager">Responsabile / Area Manager</option><option value="backoffice">Backoffice</option></select></label>}
            </>}

            <button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

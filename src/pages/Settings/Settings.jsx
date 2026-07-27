import { useEffect, useMemo, useState } from "react";
import { Building2, ClipboardList, Pencil, Plus, Save, Search, Trash2, UserRound, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import ProjectTypesSettings from "../../components/ProjectTypesSettings";

const workspaceModules = [
  ["beauty_days", "Beauty Days"],
  ["ordini_pr", "Ordini PR"],
  ["ordini_ph", "Ordini PH"],
  ["prodotti", "Prodotti"],
  ["documenti", "Documenti"],
  ["progetti", "Progetti"],
  ["attivita", "Attività"],
  ["agenda", "Agenda"],
  ["messaggi", "Messaggi"],
  ["report", "Report"],
  ["team", "Team"],
];
const RESPONSIBLE_ROLE_ID = "9b8431f9-e6f4-43a1-8de9-6bb7e9af7ed0";
const emptyDepartment = { nome: "", descrizione: "", attivo: true, moduli: [] };
const emptyRole = {
  nome: "",
  descrizione: "",
  livello: 40,
  ambito_dati: "propri",
  livello_accesso: "scrittura",
  accesso_come_beauty: false,
  permessi: [],
};
const emptyTemplate = { titolo: "", reparto_id: "", reparto_ids: [], ordine: 1, attivo: true };
const emptyUserAccess = {
  ruolo_id: "",
  attivo: true,
  reparti: [],
  workspace_mexal_agente_id: "",
  responsabile_utente_id: "",
  beauty_mexal_agente_id: "",
};
const emptyNewUser = { nome: "", cognome: "", email: "", password: "", telefono: "", ruolo_id: "", reparto_id: "", attivo: true };

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
  const [departmentModules, setDepartmentModules] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [mexalAgents, setMexalAgents] = useState([]);
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState({ open: false, type: "checklist", item: null });
  const [departmentForm, setDepartmentForm] = useState(emptyDepartment);
  const [roleForm, setRoleForm] = useState(emptyRole);
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [userAccessForm, setUserAccessForm] = useState(emptyUserAccess);
  const [newUserForm, setNewUserForm] = useState(emptyNewUser);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [departmentsRes, rolesRes, templatesRes, usersRes, userDepartmentsRes, permissionsRes, rolePermissionsRes, templateDepartmentsRes, integrationsRes, agentsRes, departmentModulesRes] = await Promise.all([
      supabase.from("reparti").select("*").order("nome"),
      supabase.from("ruoli").select("*").order("livello", { ascending: false }),
      supabase.from("checklist_template").select("*,reparti(id,nome)").order("ordine", { ascending: true }),
      supabase.from("utenti").select("id,auth_user_id,nome,cognome,email,telefono,attivo,reparto_id,ruolo_id,mexal_agente_id,ruoli(id,nome,livello,ambito_dati,livello_accesso,accesso_come_beauty)").order("nome"),
      supabase.from("utenti_reparti").select("id,utente_id,reparto_id"),
      supabase.from("permessi").select("id,codice,descrizione").order("codice"),
      supabase.from("permessi_ruolo").select("ruolo_id,permesso_id,permessi(id,codice,descrizione)"),
      supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
      supabase.from("integrazioni_utenti").select("*").in("modulo", ["report_giornate", "gestione_ordini", "gestione_ordini_pr", "gestione_ordini_ph"]),
      supabase.from("mexal_agenti").select("id,codice,nome,cognome,attivo_mexal,workspace_utente_id,responsabile_utente_id").order("cognome"),
      supabase.from("reparti_moduli").select("reparto_id,modulo"),
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
    if (departmentModulesRes.error) console.error("Errore moduli reparti:", departmentModulesRes.error.message);

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
    setDepartmentModules(departmentModulesRes.data || []);
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
  const responsibleUsers = useMemo(() => {
    return users.filter((user) => user.attivo !== false && user.ruolo_id === RESPONSIBLE_ROLE_ID);
  }, [users]);

  function getUserDepartmentIds(userId) {
    const linked = userDepartments.filter((row) => row.utente_id === userId && row.reparto_id).map((row) => row.reparto_id);
    const primary = users.find((user) => user.id === userId)?.reparto_id;
    return [...new Set(primary ? [...linked, primary] : linked)];
  }

  function getUserDepartmentNames(userId) {
    const ids = getUserDepartmentIds(userId);
    const names = ids.map((id) => departments.find((department) => department.id === id)?.nome).filter(Boolean);
    return names.length ? names.join(", ") : "Nessun reparto associato";
  }

  function getDepartmentModuleCodes(departmentId) {
    return departmentModules
      .filter((row) => row.reparto_id === departmentId)
      .map((row) => row.modulo);
  }

  function getUserModuleCodes(userId) {
    const departmentIds = getUserDepartmentIds(userId);
    return [...new Set(departmentIds.flatMap(getDepartmentModuleCodes))];
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

  function openCreateUser() {
    setNewUserForm(emptyNewUser);
    setModal({ open: true, type: "nuovo_utente", item: null });
  }

  function openEdit(type, item) {
    setModal({ open: true, type, item });

    if (type === "reparto") {
      setDepartmentForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        attivo: item.attivo !== false,
        moduli: departmentModules.filter((row) => row.reparto_id === item.id).map((row) => row.modulo),
      });
    }

    if (type === "ruolo") {
      setRoleForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        livello: item.livello || 40,
        ambito_dati: item.ambito_dati || "propri",
        livello_accesso: item.livello_accesso || "scrittura",
        accesso_come_beauty: item.accesso_come_beauty === true,
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
      const linkedAgent = mexalAgents.find((agent) => agent.workspace_utente_id === item.id);
      setUserAccessForm({
        ruolo_id: item.ruolo_id || "",
        attivo: item.attivo !== false,
        reparti: getUserDepartmentIds(item.id),
        workspace_mexal_agente_id: linkedAgent?.id || item.mexal_agente_id || "",
        responsabile_utente_id: linkedAgent?.responsabile_utente_id || "",
        beauty_mexal_agente_id: beautyAccess?.mexal_agente_id || "",
      });
    }
  }

  function closeModal() {
    setModal({ open: false, type: "checklist", item: null });
    setUserAccessForm(emptyUserAccess);
    setNewUserForm(emptyNewUser);
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
    const request = modal.item
      ? supabase.from("reparti").update(payload).eq("id", modal.item.id).select("id").single()
      : supabase.from("reparti").insert(payload).select("id").single();
    const { data, error } = await request;
    setSaving(false);
    if (error) return alert(error.message);
    const departmentId = data?.id || modal.item?.id;
    const deleteModules = await supabase.from("reparti_moduli").delete().eq("reparto_id", departmentId);
    if (deleteModules.error) return alert(deleteModules.error.message);
    const moduleRows = (departmentForm.moduli || []).map((modulo) => ({ reparto_id: departmentId, modulo }));
    if (moduleRows.length) {
      const insertModules = await supabase.from("reparti_moduli").insert(moduleRows);
      if (insertModules.error) return alert(insertModules.error.message);
    }
    closeModal();
    await loadData();
  }

  async function saveRuolo(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    const payload = {
      nome: roleForm.nome.trim(),
      descrizione: roleForm.descrizione.trim() || null,
      livello: Number(roleForm.livello) || 0,
      ambito_dati: roleForm.ambito_dati,
      livello_accesso: roleForm.livello_accesso,
      accesso_come_beauty: roleForm.accesso_come_beauty === true,
    };
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
      const linkRes = await supabase.from("mexal_agenti").update({
        workspace_utente_id: modal.item.id,
        responsabile_utente_id: userAccessForm.responsabile_utente_id || null,
      }).eq("id", userAccessForm.workspace_mexal_agente_id);
      if (linkRes.error) {
        setSaving(false);
        return alert(linkRes.error.message);
      }
    }

    const syncAccess = await supabase.rpc("sync_workspace_user_integrations", {
      target_user_id: modal.item.id,
    });
    if (syncAccess.error) {
      setSaving(false);
      return alert(syncAccess.error.message);
    }

    const beautyAccessResult = await supabase
      .from("integrazioni_utenti")
      .select("*")
      .eq("utente_id", modal.item.id)
      .eq("modulo", "report_giornate")
      .maybeSingle();
    if (beautyAccessResult.error) {
      setSaving(false);
      return alert(beautyAccessResult.error.message);
    }

    const beautyAccess = beautyAccessResult.data;
    if (beautyAccess?.enabled && (!modal.item.nome?.trim() || !modal.item.email?.trim())) {
      setSaving(false);
      return alert("Per accedere a Beauty Days sono obbligatori nome ed email dell'utente.");
    }

    let external = {
      external_user_id: beautyAccess?.external_user_id || null,
      external_beauty_id: beautyAccess?.external_beauty_id || null,
      external_agent_id: beautyAccess?.external_agent_id || null,
    };
    if (beautyAccess?.enabled && ["beauty", "agent"].includes(beautyAccess.external_role)) {
      const ensureRes = await supabase.functions.invoke("report-giornate-api", {
        body: {
          action: "ensure-external-user",
          ruolo: beautyAccess.external_role,
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

    const beautyRelation = await supabase
      .from("integrazioni_utenti")
      .update({
        mexal_agente_id: userAccessForm.beauty_mexal_agente_id || null,
        external_user_id: external.external_user_id || null,
        external_beauty_id: external.external_beauty_id || null,
        external_agent_id: external.external_agent_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq("utente_id", modal.item.id)
      .eq("modulo", "report_giornate");
    if (beautyRelation.error) {
      setSaving(false);
      return alert(beautyRelation.error.message);
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

  async function saveNewUser(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    if (!newUserForm.nome.trim() || !newUserForm.cognome.trim() || !newUserForm.email.trim() || !newUserForm.password) {
      return alert("Nome, cognome, email e password iniziale sono obbligatori.");
    }
    if (newUserForm.password.length < 8) return alert("La password deve avere almeno 8 caratteri.");

    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-manage-user", {
      body: {
        action: "create",
        ...newUserForm,
        nome: newUserForm.nome.trim(),
        cognome: newUserForm.cognome.trim(),
        email: newUserForm.email.trim(),
        telefono: newUserForm.telefono.trim(),
        ruolo_id: newUserForm.ruolo_id || null,
        reparto_id: newUserForm.reparto_id || null,
      },
    });
    setSaving(false);
    if (error || data?.error) return alert(await getFunctionErrorMessage(error, data?.error));
    closeModal();
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

  const selectedUserModuleCodes = [
    ...new Set((userAccessForm.reparti || []).flatMap(getDepartmentModuleCodes)),
  ];

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
          <div className="panel-header"><div><h3>Utenti e autorizzazioni</h3><p>Una sola scheda per ruolo, reparti, relazioni Mexal e accesso ai moduli.</p></div>{canManage && <button className="primary-action" onClick={openCreateUser}><Plus size={18} />Nuovo utente</button>}</div>
          <div className="settings-list">
            {filteredUsers.map((item) => {
              const moduleCodes = getUserModuleCodes(item.id);
              const linkedAgent = mexalAgents.find((agent) => agent.workspace_utente_id === item.id);
              return <div className="settings-row" key={item.id}><div><strong>{`${item.nome || ""} ${item.cognome || ""}`.trim() || item.email || "Utente senza nome"}</strong><span>{item.email || "Email non disponibile"}</span><span>Ruolo: {item.ruoli?.nome || "Nessun ruolo"} · Reparti: {getUserDepartmentNames(item.id)}</span><span>Agente Mexal: {linkedAgent ? `${linkedAgent.codice} · ${`${linkedAgent.nome || ""} ${linkedAgent.cognome || ""}`.trim()}` : "Non associato"}</span><span>Moduli dai reparti: {moduleCodes.length ? moduleCodes.map((code) => workspaceModules.find(([id]) => id === code)?.[1] || code).join(", ") : "Nessuno"}</span></div><span className={`config-status ${item.attivo !== false ? "active" : "inactive"}`}>{item.attivo !== false ? "Attivo" : "Disattivo"}</span><div className="config-actions"><button title="Modifica configurazione completa" onClick={() => openEdit("utente_accessi", item)}><Pencil size={16} /></button>{canManage && item.id !== profile?.id && <button title="Elimina definitivamente" className="danger" onClick={() => deleteUser(item)}><Trash2 size={16} /></button>}</div></div>;
            })}
            {filteredUsers.length === 0 && <p>Nessun utente corrisponde alla ricerca.</p>}
          </div>
        </div>
      )}

      {tab === "organization" && (
        <div className="settings-two-columns">
          <div className="panel settings-panel"><div className="panel-header"><div><h3>Reparti e moduli</h3><p>Ogni reparto stabilisce quali moduli sono disponibili ai suoi utenti.</p></div>{canManage && <button className="primary-action" onClick={() => openCreate("reparto")}><Plus size={18} />Nuovo</button>}</div><div className="settings-list">{filteredDepartments.map((item) => { const moduleCodes = getDepartmentModuleCodes(item.id); return <div className="settings-row" key={item.id}><div><strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span><span>Moduli: {moduleCodes.length ? moduleCodes.map((code) => workspaceModules.find(([id]) => id === code)?.[1] || code).join(", ") : "Nessuno"}</span></div><span className={`config-status ${item.attivo ? "active" : "inactive"}`}>{item.attivo ? "Attivo" : "Disattivo"}</span><div className="config-actions"><button onClick={() => openEdit("reparto", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("reparto", item)}><Trash2 size={16} /></button></div></div>; })}{filteredDepartments.length === 0 && <p>Nessun reparto corrisponde alla ricerca.</p>}</div></div>
          <div className="panel settings-panel"><div className="panel-header"><div><h3>Ruoli e permessi</h3><p>Il ruolo Workspace determina livello operativo e ampiezza dei dati in tutti i moduli.</p></div>{canManage && <button className="primary-action" onClick={() => openCreate("ruolo")}><Plus size={18} />Nuovo</button>}</div><div className="settings-list">{filteredRoles.map((item) => { const codes = getRolePermissionCodes(item.id); return <div className="settings-row" key={item.id}><div><strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span><span>Ambito dati: {item.ambito_dati || "propri"} · Accesso: {item.livello_accesso || "scrittura"}</span><span>Profilo Beauty: {item.accesso_come_beauty ? "abilitato" : "non abilitato"}</span><span>Permessi: {codes.length ? codes.map((code) => permissionLabels[code] || code).join(", ") : "Nessuno"}</span></div><span className="role-level">Livello {item.livello}</span><div className="config-actions"><button onClick={() => openEdit("ruolo", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("ruolo", item)}><Trash2 size={16} /></button></div></div>; })}{filteredRoles.length === 0 && <p>Nessun ruolo corrisponde alla ricerca.</p>}</div></div>
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
          <form className="modal-card v4-modal" onSubmit={modal.type === "reparto" ? saveReparto : modal.type === "ruolo" ? saveRuolo : modal.type === "utente_accessi" ? saveUserAccess : modal.type === "nuovo_utente" ? saveNewUser : saveTemplate}>
            <div className="modal-header"><h2>{modal.type === "utente_accessi" ? `Accessi di ${`${modal.item?.nome || ""} ${modal.item?.cognome || ""}`.trim() || modal.item?.email || "utente"}` : modal.type === "nuovo_utente" ? "Nuovo utente" : modal.item ? "Modifica" : "Nuovo"}</h2><button type="button" onClick={closeModal}><X size={20} /></button></div>

            {modal.type === "nuovo_utente" && <>
              <label>Nome<input value={newUserForm.nome} onChange={(e) => setNewUserForm({ ...newUserForm, nome: e.target.value })} /></label>
              <label>Cognome<input value={newUserForm.cognome} onChange={(e) => setNewUserForm({ ...newUserForm, cognome: e.target.value })} /></label>
              <label>Email<input type="email" value={newUserForm.email} onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })} /></label>
              <label>Password iniziale<input type="password" minLength="8" value={newUserForm.password} onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })} /></label>
              <label>Telefono<input value={newUserForm.telefono} onChange={(e) => setNewUserForm({ ...newUserForm, telefono: e.target.value })} /></label>
              <label>Ruolo<select value={newUserForm.ruolo_id} onChange={(e) => setNewUserForm({ ...newUserForm, ruolo_id: e.target.value })}><option value="">Nessun ruolo</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.nome}</option>)}</select></label>
              <label>Reparto principale<select value={newUserForm.reparto_id} onChange={(e) => setNewUserForm({ ...newUserForm, reparto_id: e.target.value })}><option value="">Nessun reparto</option>{activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.nome}</option>)}</select></label>
              <label className="check-line"><input type="checkbox" checked={newUserForm.attivo} onChange={(e) => setNewUserForm({ ...newUserForm, attivo: e.target.checked })} />Utente attivo</label>
            </>}

            {modal.type === "reparto" && <><label>Nome reparto<input value={departmentForm.nome} onChange={(e) => setDepartmentForm({ ...departmentForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={departmentForm.descrizione} onChange={(e) => setDepartmentForm({ ...departmentForm, descrizione: e.target.value })} /></label><div className="checkbox-group"><strong>Moduli accessibili dal reparto</strong>{workspaceModules.map(([id, label]) => <label key={id}><input type="checkbox" checked={(departmentForm.moduli || []).includes(id)} onChange={() => toggleListValue(setDepartmentForm, "moduli", id)} />{label}</label>)}</div><label className="check-line"><input type="checkbox" checked={departmentForm.attivo} onChange={(e) => setDepartmentForm({ ...departmentForm, attivo: e.target.checked })} />Attivo</label></>}

            {modal.type === "ruolo" && <><label>Nome ruolo<input value={roleForm.nome} onChange={(e) => setRoleForm({ ...roleForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={roleForm.descrizione} onChange={(e) => setRoleForm({ ...roleForm, descrizione: e.target.value })} /></label><label>Livello<input type="number" value={roleForm.livello} onChange={(e) => setRoleForm({ ...roleForm, livello: e.target.value })} /></label><label>Ambito dei dati<select value={roleForm.ambito_dati} onChange={(e) => setRoleForm({ ...roleForm, ambito_dati: e.target.value })}><option value="propri">Solo dati propri e clienti associati</option><option value="team">Propri dati e team collegato</option><option value="tutti">Tutti i dati del workspace</option></select></label><label>Livello operativo<select value={roleForm.livello_accesso} onChange={(e) => setRoleForm({ ...roleForm, livello_accesso: e.target.value })}><option value="lettura">Sola lettura</option><option value="scrittura">Lettura e modifica</option><option value="amministrazione">Amministrazione</option></select></label><label className="check-line"><input type="checkbox" checked={roleForm.accesso_come_beauty === true} onChange={(e) => setRoleForm({ ...roleForm, accesso_come_beauty: e.target.checked })} />Autorizza l'accesso a Beauty Days con profilo Beauty</label><p className="muted">Per entrare, l'utente deve appartenere anche a un reparto con il modulo Beauty Days abilitato.</p><div className="checkbox-group scrollable-check-group"><strong>Permessi del ruolo</strong>{permissions.map((permission) => (<label key={permission.id}><input type="checkbox" checked={(roleForm.permessi || []).includes(permission.id)} onChange={() => toggleListValue(setRoleForm, "permessi", permission.id)} />{permission.codice} · {permission.descrizione || permissionLabels[permission.codice] || ""}</label>))}{permissions.length === 0 && <p>Nessun permesso disponibile.</p>}</div></>}

            {modal.type === "checklist" && <><label>Voce checklist<input value={templateForm.titolo} onChange={(e) => setTemplateForm({ ...templateForm, titolo: e.target.value })} /></label><div className="checkbox-group scrollable-check-group"><strong>Reparti collegati alla voce checklist</strong><p className="muted">Se non selezioni reparti, la voce sarà valida per tutti i reparti.</p>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(templateForm.reparto_ids || []).includes(department.id)} onChange={() => toggleListValue(setTemplateForm, "reparto_ids", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div><label>Ordine<input type="number" value={templateForm.ordine} onChange={(e) => setTemplateForm({ ...templateForm, ordine: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={templateForm.attivo} onChange={(e) => setTemplateForm({ ...templateForm, attivo: e.target.checked })} />Attiva</label></>}

            {modal.type === "utente_accessi" && <>
              <h3>Profilo workspace</h3>
              <label>Ruolo<select value={userAccessForm.ruolo_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, ruolo_id: e.target.value })}><option value="">Nessun ruolo</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.nome} · livello {role.livello}</option>)}</select></label>
              <label className="check-line"><input type="checkbox" checked={userAccessForm.attivo} onChange={(e) => setUserAccessForm({ ...userAccessForm, attivo: e.target.checked })} />Utente attivo</label>
              <div className="checkbox-group scrollable-check-group"><strong>Reparti dell'utente</strong>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(userAccessForm.reparti || []).includes(department.id)} onChange={() => toggleListValue(setUserAccessForm, "reparti", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div>

              <h3>Relazioni organizzative</h3>
              <p className="muted">L'agente e il codice agente provengono esclusivamente da Mexal. Le associazioni sono facoltative.</p>
              <label>Identità agente dell'utente<select value={userAccessForm.workspace_mexal_agente_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, workspace_mexal_agente_id: e.target.value })}><option value="">Utente non agente</option>{mexalAgents.filter((agent) => agent.attivo_mexal !== false && (!agent.workspace_utente_id || agent.workspace_utente_id === modal.item?.id)).map((agent) => <option key={agent.id} value={agent.id}>{agent.codice} · {`${agent.nome || ""} ${agent.cognome || ""}`.trim()}</option>)}</select></label>
              {userAccessForm.workspace_mexal_agente_id && <label>Responsabile dell'agente<select value={userAccessForm.responsabile_utente_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, responsabile_utente_id: e.target.value })}><option value="">Nessun responsabile</option>{responsibleUsers.filter((user) => user.id !== modal.item?.id).map((user) => <option key={user.id} value={user.id}>{`${user.nome || ""} ${user.cognome || ""}`.trim() || user.email}</option>)}</select>{responsibleUsers.length === 0 && <span className="muted">Non ci sono utenti attivi associati al ruolo Responsabile configurato.</span>}</label>}

              <h3>Moduli ereditati dai reparti</h3>
              <p className="muted">{selectedUserModuleCodes.length ? selectedUserModuleCodes.map((code) => workspaceModules.find(([id]) => id === code)?.[1] || code).join(", ") : "Nessun modulo abilitato. Configura i moduli nella card Reparti."}</p>
              {selectedUserModuleCodes.includes("beauty_days") && <label>Agente commerciale associato alla Beauty<select value={userAccessForm.beauty_mexal_agente_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, beauty_mexal_agente_id: e.target.value })}><option value="">Nessun agente associato</option>{mexalAgents.filter((agent) => agent.attivo_mexal !== false).map((agent) => <option key={agent.id} value={agent.id}>{agent.codice} · {`${agent.nome || ""} ${agent.cognome || ""}`.trim()}</option>)}</select></label>}
            </>}

            <button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

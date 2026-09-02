import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import useBackNavigation from "../../hooks/useBackNavigation";
import ProjectTypesSettings from "../../components/ProjectTypesSettings";
import {
  WORKSPACE_MODULES,
} from "../../config/workspaceModules";

const fallbackWorkspaceModules = Object.values(WORKSPACE_MODULES).map(({ code, label }) => [code, label]);
const fallbackDepartmentModules = Object.values(WORKSPACE_MODULES).filter((module) => module.departmentAssignable).map(({ code, label }) => [code, label]);
const fallbackRoleModules = Object.values(WORKSPACE_MODULES).filter((module) => module.roleConfigurable).map((module) => ({ code: module.code, label: module.label }));
const RESPONSIBLE_ROLE_ID = "9b8431f9-e6f4-43a1-8de9-6bb7e9af7ed0";
const emptyDepartment = { nome: "", descrizione: "", attivo: true, moduli: [], progremes_moduli: [] };
const emptyRole = {
  nome: "",
  descrizione: "",
  amministratore_workspace: false,
  ambito_dati: "propri",
  livello_accesso: "scrittura",
  livello_ai: "analisi",
  accesso_come_beauty: false,
  permessi: [],
  moduli: {},
};
const emptyTemplate = { titolo: "", reparto_id: "", reparto_ids: [], ordine: 1, attivo: true };
const emptyUserAccess = {
  ruolo_id: "",
  attivo: true,
  reparti: [],
  workspace_mexal_agente_id: "",
  responsabile_utente_id: "",
  beauty_mexal_agente_id: "",
  permessi: [],
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
  "integrations.read": "Accede al Centro Integrazioni",
  "integrations.configure": "Gestisce configurazioni e automazioni delle integrazioni",
  "integrations.sync.clients": "Sincronizza clienti",
  "integrations.sync.agents": "Sincronizza agenti",
  "integrations.sync.products": "Sincronizza prodotti",
  "integrations.sync.product_categories": "Sincronizza categorie prodotto",
  "integrations.sync.commercial_conditions": "Sincronizza condizioni commerciali",
  "integrations.sync.document_series": "Sincronizza serie documenti",
  "integrations.sync.stocks": "Sincronizza giacenze",
  "integrations.sync.list_price_commissions": "Sincronizza provvigioni listini",
  "integrations.sync.orders": "Sincronizza ordini",
  "integrations.sync.sales_invoices": "Sincronizza fatture",
  "integrations.sync.oct_orders": "Importa ordini cliente OCT",
  "integrations.sync.documents": "Sincronizza documenti",
  "integrations.sync.progremes_modules": "Sincronizza moduli ProgreMES",
};

const SECTION_COPY = Object.freeze({
  team: { eyebrow: "UTENTI E ACCESSI", title: "Gestione utenti e accessi", description: "Utenti, accessi, moduli e relazioni organizzative." },
  organization: { eyebrow: "REPARTI / RUOLI", title: "Organizzazione e autorizzazioni", description: "Struttura dei reparti, ruoli, permessi e livelli operativi." },
  projects: { eyebrow: "VOCI DI PROGETTO", title: "Configurazione dei progetti", description: "Checklist, tipi e regole applicate ai progetti." },
});

export default function Settings({ section = "team" }) {
  const goBack = useBackNavigation("/settings");
  const { hasPermission, profile, reloadProfile } = useAuth();
  const canManage = hasPermission("settings.manage") || hasPermission("users.manage");

  const tab = Object.hasOwn(SECTION_COPY, section) ? section : "team";
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [users, setUsers] = useState([]);
  const [userDepartments, setUserDepartments] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [userPermissions, setUserPermissions] = useState([]);
  const [templateDepartments, setTemplateDepartments] = useState([]);
  const [departmentModules, setDepartmentModules] = useState([]);
  const [roleModuleLevels, setRoleModuleLevels] = useState([]);
  const [moduleCatalog, setModuleCatalog] = useState([]);
  const [progremesModules, setProgremesModules] = useState([]);
  const [progremesDepartmentModules, setProgremesDepartmentModules] = useState([]);
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
    const [departmentsRes, rolesRes, templatesRes, usersRes, userDepartmentsRes, permissionsRes, userPermissionsRes, templateDepartmentsRes, integrationsRes, agentsRes, departmentModulesRes, progremesModulesRes, progremesDepartmentModulesRes, roleModuleLevelsRes, moduleCatalogRes] = await Promise.all([
      supabase.from("reparti").select("*").order("nome"),
      supabase.from("ruoli").select("*").order("nome"),
      supabase.from("checklist_template").select("*,reparti(id,nome)").order("ordine", { ascending: true }),
      supabase.from("utenti").select("id,auth_user_id,nome,cognome,email,telefono,attivo,reparto_id,ruolo_id,mexal_agente_id,ruoli(id,nome,amministratore_workspace,ambito_dati,livello_accesso,livello_ai,accesso_come_beauty)").order("nome"),
      supabase.from("utenti_reparti").select("id,utente_id,reparto_id"),
      supabase.from("permessi").select("id,codice,descrizione").order("codice"),
      supabase.from("permessi_utente").select("utente_id,permesso_id,permessi(id,codice,descrizione)"),
      supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
      supabase.from("integrazioni_utenti").select("*").in("modulo", ["report_giornate", "gestione_ordini", "gestione_ordini_pr", "gestione_ordini_ph", "gestione_ordini_private"]),
      supabase.from("mexal_agenti").select("id,codice,nome,cognome,attivo_mexal,workspace_utente_id,responsabile_utente_id").order("cognome"),
      supabase.from("reparti_moduli").select("reparto_id,modulo"),
      supabase.from("progremes_moduli").select("codice,nome,descrizione,attivo,ordine").order("ordine").order("nome"),
      supabase.from("progremes_reparti_moduli").select("reparto_id,modulo_codice"),
      supabase.from("ruoli_moduli").select("ruolo_id,modulo,livello_accesso"),
      supabase.from("workspace_moduli").select("codice,nome,attivo,assegnabile_reparto,configurabile_ruolo,ordine").order("ordine").order("nome"),
    ]);

    if (departmentsRes.error) console.error("Errore reparti:", departmentsRes.error.message);
    if (rolesRes.error) console.error("Errore ruoli:", rolesRes.error.message);
    if (templatesRes.error) console.error("Errore checklist:", templatesRes.error.message);
    if (usersRes.error) console.error("Errore utenti:", usersRes.error.message);
    if (userDepartmentsRes.error) console.error("Errore utenti_reparti:", userDepartmentsRes.error.message);
    if (permissionsRes.error) console.error("Errore permessi:", permissionsRes.error.message);
    if (userPermissionsRes.error) console.error("Errore permessi speciali utente:", userPermissionsRes.error.message);
    if (templateDepartmentsRes.error) console.error("Errore reparti checklist:", templateDepartmentsRes.error.message);
    if (integrationsRes.error) console.error("Errore integrazioni utenti:", integrationsRes.error.message);
    if (agentsRes.error) console.error("Errore agenti Mexal:", agentsRes.error.message);
    if (departmentModulesRes.error) console.error("Errore moduli reparti:", departmentModulesRes.error.message);
    if (progremesModulesRes.error) console.error("Errore moduli ProgreMES:", progremesModulesRes.error.message);
    if (progremesDepartmentModulesRes.error) console.error("Errore moduli ProgreMES dei reparti:", progremesDepartmentModulesRes.error.message);
    if (roleModuleLevelsRes.error) console.error("Errore livelli operativi dei ruoli:", roleModuleLevelsRes.error.message);
    if (moduleCatalogRes.error) console.error("Errore catalogo moduli Workspace:", moduleCatalogRes.error.message);

    setDepartments(departmentsRes.data || []);
    setRoles(rolesRes.data || []);
    setTemplates(templatesRes.data || []);
    setUsers(usersRes.data || []);
    setUserDepartments(userDepartmentsRes.data || []);
    setPermissions(permissionsRes.data || []);
    setUserPermissions(userPermissionsRes.data || []);
    setTemplateDepartments(templateDepartmentsRes.data || []);
    setIntegrations(integrationsRes.data || []);
    setMexalAgents(agentsRes.data || []);
    setDepartmentModules(departmentModulesRes.data || []);
    setProgremesModules(progremesModulesRes.data || []);
    setProgremesDepartmentModules(progremesDepartmentModulesRes.data || []);
    setRoleModuleLevels(roleModuleLevelsRes.data || []);
    setModuleCatalog(moduleCatalogRes.data || []);
  }

  const workspaceModules = useMemo(() => moduleCatalog.length
    ? moduleCatalog.map((module) => [module.codice, module.nome])
    : fallbackWorkspaceModules, [moduleCatalog]);
  const departmentAssignableModules = useMemo(() => moduleCatalog.length
    ? moduleCatalog.filter((module) => module.attivo && module.assegnabile_reparto).map((module) => [module.codice, module.nome])
    : fallbackDepartmentModules, [moduleCatalog]);
  const roleConfigurableModules = useMemo(() => moduleCatalog.length
    ? moduleCatalog.filter((module) => module.attivo && module.configurabile_ruolo).map((module) => ({ code: module.codice, label: module.nome }))
    : fallbackRoleModules, [moduleCatalog]);

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
  const filteredRoles = useMemo(() => roles.filter((item) => !normalizedSearch || `${item.nome || ""} ${item.descrizione || ""}`.toLowerCase().includes(normalizedSearch)), [roles, normalizedSearch]);
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

  function getUserPermissionIds(userId) {
    return userPermissions.filter((row) => row.utente_id === userId && row.permesso_id).map((row) => row.permesso_id);
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
        progremes_moduli: progremesDepartmentModules.filter((row) => row.reparto_id === item.id).map((row) => row.modulo_codice),
      });
    }

    if (type === "ruolo") {
      const configuredModuleLevels = Object.fromEntries(
        roleModuleLevels
          .filter((row) => row.ruolo_id === item.id)
          .map((row) => [row.modulo, row.livello_accesso])
      );
      setRoleForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        amministratore_workspace: item.amministratore_workspace === true,
        ambito_dati: item.ambito_dati || "propri",
        livello_accesso: item.livello_accesso || "scrittura",
        livello_ai: item.livello_ai || "analisi",
        accesso_come_beauty: item.accesso_come_beauty === true,
        permessi: [],
        moduli: Object.fromEntries(
          roleConfigurableModules.map(({ code }) => [
            code,
            configuredModuleLevels[code] || item.livello_accesso || "lettura",
          ])
        ),
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
        permessi: getUserPermissionIds(item.id),
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
    const deleteProgremesModules = await supabase.from("progremes_reparti_moduli").delete().eq("reparto_id", departmentId);
    if (deleteProgremesModules.error) return alert(deleteProgremesModules.error.message);
    const progremesRows = (departmentForm.progremes_moduli || []).map((modulo_codice) => ({ reparto_id: departmentId, modulo_codice }));
    if (progremesRows.length) {
      const insertProgremesModules = await supabase.from("progremes_reparti_moduli").insert(progremesRows);
      if (insertProgremesModules.error) return alert(insertProgremesModules.error.message);
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
      amministratore_workspace: roleForm.amministratore_workspace === true,
      ambito_dati: roleForm.ambito_dati,
      livello_accesso: roleForm.livello_accesso,
      livello_ai: roleForm.livello_ai || "analisi",
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

    const roleModuleRows = roleConfigurableModules.map(({ code }) => ({
      ruolo_id: data.id,
      modulo: code,
      livello_accesso: roleForm.moduli?.[code] || payload.livello_accesso || "lettura",
    }));
    const moduleLevelsResult = await supabase
      .from("ruoli_moduli")
      .upsert(roleModuleRows, { onConflict: "ruolo_id,modulo" });
    if (moduleLevelsResult.error) {
      setSaving(false);
      return alert(moduleLevelsResult.error.message);
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

    const selectedDepartmentIds = [
      ...new Set((userAccessForm.reparti || []).filter(Boolean)),
    ];

    const updateUser = await supabase
      .from("utenti")
      .update({
        ruolo_id: userAccessForm.ruolo_id || null,
        reparto_id: selectedDepartmentIds[0] || null,
        attivo: userAccessForm.attivo,
      })
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

    const rows = selectedDepartmentIds.map((reparto_id) => ({
      utente_id: modal.item.id,
      reparto_id,
    }));
    if (rows.length > 0) {
      const insertRes = await supabase.from("utenti_reparti").insert(rows);
      if (insertRes.error) {
        setSaving(false);
        return alert(insertRes.error.message);
      }
    }

    const specialPermissionRows = (userAccessForm.permessi || []).map((permesso_id) => ({ utente_id: modal.item.id, permesso_id }));
    if (specialPermissionRows.length > 0) {
      const insertSpecialPermissions = await supabase.from("permessi_utente").upsert(specialPermissionRows, { onConflict: "utente_id,permesso_id" });
      if (insertSpecialPermissions.error) {
        setSaving(false);
        return alert(insertSpecialPermissions.error.message);
      }
    }
    let deleteSpecialPermissions = supabase.from("permessi_utente").delete().eq("utente_id", modal.item.id);
    if ((userAccessForm.permessi || []).length > 0) {
      deleteSpecialPermissions = deleteSpecialPermissions.not("permesso_id", "in", `(${userAccessForm.permessi.join(",")})`);
    }
    const deleteObsoleteSpecialPermissions = await deleteSpecialPermissions;
    if (deleteObsoleteSpecialPermissions.error) {
      setSaving(false);
      return alert(deleteObsoleteSpecialPermissions.error.message);
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
    if (!await window.workspaceConfirm("Confermi eliminazione?")) return;
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
    if (!await window.workspaceConfirm(`Eliminare definitivamente ${name}?\n\nVerranno rimossi l'account di accesso, il profilo workspace e gli eventuali profili collegati a Beauty Days. Le attività già registrate resteranno archiviate.`)) return;

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
          <button type="button" className="settings-hub-back" onClick={goBack}><ArrowLeft size={17} />Torna a Impostazioni</button>
          <h1>{SECTION_COPY[tab].title}</h1>
          <p>{SECTION_COPY[tab].description}</p>
        </div>
      </div>

      <div className="settings-section-heading">
        <div><span>{SECTION_COPY[tab].eyebrow}</span><h2>{SECTION_COPY[tab].title}</h2></div>
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
          <div className="panel settings-panel"><div className="panel-header"><div><h3>Ruoli e permessi</h3><p>Il ruolo determina livello operativo e ambito dati; i moduli dipendono esclusivamente dai reparti.</p></div>{canManage && <button className="primary-action" onClick={() => openCreate("ruolo")}><Plus size={18} />Nuovo</button>}</div><div className="settings-list">{filteredRoles.map((item) => { const scopeLabels = { propri: "Dati personali e identità agente", team: "Dati personali, reparti e agenti associati", tutti: "Tutto il workspace" }; const accessLabels = { lettura: "Solo lettura", scrittura: "Lettura/scrittura", amministrazione: "Gestione completa" }; return <div className="settings-row" key={item.id}><div><strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span><span>Ambito dati: {scopeLabels[item.ambito_dati] || scopeLabels.propri}</span><span>Permessi: {accessLabels[item.livello_accesso] || accessLabels.scrittura}</span><span>Livello AI: {{ nessuno: "Nessun accesso", analisi: "Solo analisi", bozza: "Crea bozza", conferma: "Esegui dopo conferma" }[item.livello_ai] || "Solo analisi"}</span><span>Accesso Beauty Days con profilo Beauty: {item.accesso_come_beauty ? "abilitato" : "non abilitato"}</span></div>{item.amministratore_workspace && <span className="role-level">Accesso completo Amministratore</span>}<div className="config-actions"><button onClick={() => openEdit("ruolo", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("ruolo", item)}><Trash2 size={16} /></button></div></div>; })}{filteredRoles.length === 0 && <p>Nessun ruolo corrisponde alla ricerca.</p>}</div></div>
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

            {modal.type === "reparto" && <><label>Nome reparto<input value={departmentForm.nome} onChange={(e) => setDepartmentForm({ ...departmentForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={departmentForm.descrizione} onChange={(e) => setDepartmentForm({ ...departmentForm, descrizione: e.target.value })} /></label><div className="checkbox-group"><strong>Moduli assegnabili al reparto</strong><p className="muted">Attività, Messaggi, Notifiche e Home sono sempre disponibili.</p>{departmentAssignableModules.map(([id, label]) => <label key={id}><input type="checkbox" checked={(departmentForm.moduli || []).includes(id)} onChange={() => toggleListValue(setDepartmentForm, "moduli", id)} />{label}</label>)}</div><div className="checkbox-group scrollable-check-group"><strong>Funzionalità di produzione</strong><p className="muted">Catalogo tecnico sincronizzato da ProgreMES e integrato nelle aree Workspace.</p>{progremesModules.map((module) => <label key={module.codice}><input type="checkbox" disabled={!module.attivo} checked={(departmentForm.progremes_moduli || []).includes(module.codice)} onChange={() => toggleListValue(setDepartmentForm, "progremes_moduli", module.codice)} />{module.nome}{!module.attivo ? " · non disponibile" : ""}</label>)}{!progremesModules.length && <p>Nessuna funzionalità di produzione sincronizzata.</p>}</div><label className="check-line"><input type="checkbox" checked={departmentForm.attivo} onChange={(e) => setDepartmentForm({ ...departmentForm, attivo: e.target.checked })} />Attivo</label></>}

            {modal.type === "ruolo" && <><label>Nome ruolo<input value={roleForm.nome} onChange={(e) => setRoleForm({ ...roleForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={roleForm.descrizione} onChange={(e) => setRoleForm({ ...roleForm, descrizione: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={roleForm.amministratore_workspace === true} onChange={(e) => setRoleForm({ ...roleForm, amministratore_workspace: e.target.checked })} />Accesso completo Amministratore</label><label>Ambito dati<select value={roleForm.ambito_dati} onChange={(e) => setRoleForm({ ...roleForm, ambito_dati: e.target.value })}><option value="propri">Dati personali e propria identità agente</option><option value="team">Dati personali, reparti e agenti associati</option><option value="tutti">Tutto il workspace</option></select></label><label>Livello operativo predefinito<select value={roleForm.livello_accesso} onChange={(e) => setRoleForm({ ...roleForm, livello_accesso: e.target.value })}><option value="lettura">Solo lettura</option><option value="scrittura">Operatività</option><option value="amministrazione">Gestione</option></select></label><label>Livello AI<select value={roleForm.livello_ai || "analisi"} onChange={(e) => setRoleForm({ ...roleForm, livello_ai: e.target.value })}><option value="nessuno">Nessun accesso</option><option value="analisi">Solo analisi</option><option value="bozza">Crea bozza</option><option value="conferma">Esegui dopo conferma</option></select></label><div className="checkbox-group scrollable-check-group"><strong>Operatività per modulo</strong><p className="muted">Il ruolo disciplina le operazioni su reparto, altri utenti e dati condivisi. Ogni utente può comunque organizzare le proprie attività e usare chat e messaggi personali.</p>{roleConfigurableModules.map((module) => <label key={module.code}>{module.label}<select value={roleForm.moduli?.[module.code] || roleForm.livello_accesso} onChange={(e) => setRoleForm((current) => ({ ...current, moduli: { ...current.moduli, [module.code]: e.target.value } }))}><option value="lettura">Lettura</option><option value="scrittura">Operatività</option><option value="amministrazione">Gestione</option></select></label>)}</div><label className="check-line"><input type="checkbox" checked={roleForm.accesso_come_beauty === true} onChange={(e) => setRoleForm({ ...roleForm, accesso_come_beauty: e.target.checked })} />Accesso Beauty Days con profilo Beauty</label><p className="muted">La visibilità dei moduli assegnabili dipende dai reparti; i livelli operativi dipendono sempre dal ruolo.</p></>}

            {modal.type === "checklist" && <><label>Voce checklist<input value={templateForm.titolo} onChange={(e) => setTemplateForm({ ...templateForm, titolo: e.target.value })} /></label><div className="checkbox-group scrollable-check-group"><strong>Reparti collegati alla voce checklist</strong><p className="muted">Se non selezioni reparti, la voce sarà valida per tutti i reparti.</p>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(templateForm.reparto_ids || []).includes(department.id)} onChange={() => toggleListValue(setTemplateForm, "reparto_ids", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div><label>Ordine<input type="number" value={templateForm.ordine} onChange={(e) => setTemplateForm({ ...templateForm, ordine: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={templateForm.attivo} onChange={(e) => setTemplateForm({ ...templateForm, attivo: e.target.checked })} />Attiva</label></>}

            {modal.type === "utente_accessi" && <>
              <h3>Profilo workspace</h3>
              <label>Ruolo<select value={userAccessForm.ruolo_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, ruolo_id: e.target.value })}><option value="">Nessun ruolo</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.nome}{role.amministratore_workspace ? " · Amministratore Workspace" : ""}</option>)}</select></label>
              <label className="check-line"><input type="checkbox" checked={userAccessForm.attivo} onChange={(e) => setUserAccessForm({ ...userAccessForm, attivo: e.target.checked })} />Utente attivo</label>
              <div className="checkbox-group scrollable-check-group"><strong>Reparti dell'utente</strong>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(userAccessForm.reparti || []).includes(department.id)} onChange={() => toggleListValue(setUserAccessForm, "reparti", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div>
              <div className="checkbox-group scrollable-check-group"><strong>Permessi speciali dell'utente</strong><p className="muted">Eccezioni individuali aggiuntive rispetto a ruolo e reparti. Le autorizzazioni già esistenti sono conservate qui.</p>{permissions.map((permission) => (<label key={permission.id}><input type="checkbox" checked={(userAccessForm.permessi || []).includes(permission.id)} onChange={() => toggleListValue(setUserAccessForm, "permessi", permission.id)} />{permission.codice} · {permission.descrizione || permissionLabels[permission.codice] || ""}</label>))}{permissions.length === 0 && <p>Nessun permesso speciale disponibile.</p>}</div>

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

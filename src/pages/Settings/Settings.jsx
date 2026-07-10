import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import ProjectTypesSettings from "../../components/ProjectTypesSettings";

const emptyDepartment = { nome: "", descrizione: "", attivo: true };
const emptyRole = { nome: "", descrizione: "", livello: 40, permessi: [] };
const emptyTemplate = { titolo: "", reparto_id: "", reparto_ids: [], ordine: 1, attivo: true };
const emptyUserAccess = { ruolo_id: "", attivo: true, reparti: [] };

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
  const { hasPermission, reloadProfile } = useAuth();
  const canManage = hasPermission("settings.manage") || hasPermission("users.manage");

  const [tab, setTab] = useState("checklist");
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [users, setUsers] = useState([]);
  const [userDepartments, setUserDepartments] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [rolePermissions, setRolePermissions] = useState([]);
  const [templateDepartments, setTemplateDepartments] = useState([]);

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
    const [departmentsRes, rolesRes, templatesRes, usersRes, userDepartmentsRes, permissionsRes, rolePermissionsRes, templateDepartmentsRes] = await Promise.all([
      supabase.from("reparti").select("*").order("nome"),
      supabase.from("ruoli").select("*").order("livello", { ascending: false }),
      supabase.from("checklist_template").select("*,reparti(id,nome)").order("ordine", { ascending: true }),
      supabase.from("utenti").select("id,nome,email,attivo,ruolo_id,ruoli(id,nome,livello)").order("nome"),
      supabase.from("utenti_reparti").select("id,utente_id,reparto_id"),
      supabase.from("permessi").select("id,codice,descrizione").order("codice"),
      supabase.from("permessi_ruolo").select("ruolo_id,permesso_id,permessi(id,codice,descrizione)"),
      supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
    ]);

    if (departmentsRes.error) console.error("Errore reparti:", departmentsRes.error.message);
    if (rolesRes.error) console.error("Errore ruoli:", rolesRes.error.message);
    if (templatesRes.error) console.error("Errore checklist:", templatesRes.error.message);
    if (usersRes.error) console.error("Errore utenti:", usersRes.error.message);
    if (userDepartmentsRes.error) console.error("Errore utenti_reparti:", userDepartmentsRes.error.message);
    if (permissionsRes.error) console.error("Errore permessi:", permissionsRes.error.message);
    if (rolePermissionsRes.error) console.error("Errore permessi_ruolo:", rolePermissionsRes.error.message);
    if (templateDepartmentsRes.error) console.error("Errore reparti checklist:", templateDepartmentsRes.error.message);

    setDepartments(departmentsRes.data || []);
    setRoles(rolesRes.data || []);
    setTemplates(templatesRes.data || []);
    setUsers(usersRes.data || []);
    setUserDepartments(userDepartmentsRes.data || []);
    setPermissions(permissionsRes.data || []);
    setRolePermissions(rolePermissionsRes.data || []);
    setTemplateDepartments(templateDepartmentsRes.data || []);
  }

  const activeDepartments = useMemo(() => departments.filter((item) => item.attivo !== false), [departments]);

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
      setUserAccessForm({
        ruolo_id: item.ruolo_id || "",
        attivo: item.attivo !== false,
        reparti: getUserDepartmentIds(item.id),
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

  return (
    <div className="settings-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Impostazioni</h1>
          <p>Gestione checklist, reparti, ruoli, permessi e accessi utenti.</p>
        </div>
      </div>

      <div className="settings-tabs">
        <button className={tab === "checklist" ? "active" : ""} onClick={() => setTab("checklist")}>Checklist progetto</button>
        <button className={tab === "tipi_progetto" ? "active" : ""} onClick={() => setTab("tipi_progetto")}>Tipi di progetto</button>
        <button className={tab === "reparti" ? "active" : ""} onClick={() => setTab("reparti")}>Reparti</button>
        <button className={tab === "ruoli" ? "active" : ""} onClick={() => setTab("ruoli")}>Ruoli / permessi</button>
        <button className={tab === "utenti" ? "active" : ""} onClick={() => setTab("utenti")}>Utenti / accessi</button>
      </div>

      {tab === "tipi_progetto" && <ProjectTypesSettings canManage={canManage} />}

      {tab === "checklist" && (
        <div className="panel settings-panel">
          <div className="panel-header"><h3>Voci checklist preimpostate</h3>{canManage && <button className="primary-action" onClick={() => openCreate("checklist")}><Plus size={18} />Nuova voce</button>}</div>
          <div className="settings-list">
            {templates.map((item) => (
              <div className="settings-row" key={item.id}>
                <div><strong>{item.titolo}</strong><span>{getTemplateDepartmentNames(item.id, item.reparti?.nome || "Tutti i reparti")}</span></div>
                <span className={`config-status ${item.attivo ? "active" : "inactive"}`}>{item.attivo ? "Attiva" : "Disattiva"}</span>
                <span className="role-level">Ordine {item.ordine}</span>
                <div className="config-actions"><button onClick={() => openEdit("checklist", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("checklist", item)}><Trash2 size={16} /></button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "reparti" && (
        <div className="panel settings-panel">
          <div className="panel-header"><h3>Reparti</h3>{canManage && <button className="primary-action" onClick={() => openCreate("reparto")}><Plus size={18} />Nuovo reparto</button>}</div>
          <div className="settings-list">
            {departments.map((item) => (
              <div className="settings-row" key={item.id}>
                <div><strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span></div>
                <span className={`config-status ${item.attivo ? "active" : "inactive"}`}>{item.attivo ? "Attivo" : "Disattivo"}</span>
                <div className="config-actions"><button onClick={() => openEdit("reparto", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("reparto", item)}><Trash2 size={16} /></button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "ruoli" && (
        <div className="panel settings-panel">
          <div className="panel-header"><h3>Ruoli e permessi</h3>{canManage && <button className="primary-action" onClick={() => openCreate("ruolo")}><Plus size={18} />Nuovo ruolo</button>}</div>
          <div className="settings-list">
            {roles.map((item) => {
              const codes = getRolePermissionCodes(item.id);
              return (
                <div className="settings-row" key={item.id}>
                  <div><strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span><span>Permessi: {codes.length ? codes.join(", ") : "Nessun permesso"}</span></div>
                  <span className="role-level">Livello {item.livello}</span>
                  <div className="config-actions"><button onClick={() => openEdit("ruolo", item)}><Pencil size={16} /></button><button className="danger" onClick={() => remove("ruolo", item)}><Trash2 size={16} /></button></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "utenti" && (
        <div className="panel settings-panel">
          <div className="panel-header"><h3>Utenti, ruoli e reparti</h3></div>
          <div className="settings-list">
            {users.map((item) => (
              <div className="settings-row" key={item.id}>
                <div>
                  <strong>{item.nome || item.email || "Utente senza nome"}</strong>
                  <span>{item.email || "Email non disponibile"}</span>
                  <span>Ruolo: {item.ruoli?.nome || "Nessun ruolo"}</span>
                  <span>Reparti: {getUserDepartmentNames(item.id)}</span>
                </div>
                <span className={`config-status ${item.attivo !== false ? "active" : "inactive"}`}>{item.attivo !== false ? "Attivo" : "Disattivo"}</span>
                <div className="config-actions"><button onClick={() => openEdit("utente_accessi", item)}><Pencil size={16} /></button></div>
              </div>
            ))}
            {users.length === 0 && <p>Nessun utente trovato.</p>}
          </div>
        </div>
      )}

      {modal.open && (
        <div className="modal-backdrop">
          <form className="modal-card v4-modal" onSubmit={modal.type === "reparto" ? saveReparto : modal.type === "ruolo" ? saveRuolo : modal.type === "utente_accessi" ? saveUserAccess : saveTemplate}>
            <div className="modal-header"><h2>{modal.type === "utente_accessi" ? `Accessi di ${modal.item?.nome || modal.item?.email || "utente"}` : modal.item ? "Modifica" : "Nuovo"}</h2><button type="button" onClick={closeModal}><X size={20} /></button></div>

            {modal.type === "reparto" && <><label>Nome reparto<input value={departmentForm.nome} onChange={(e) => setDepartmentForm({ ...departmentForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={departmentForm.descrizione} onChange={(e) => setDepartmentForm({ ...departmentForm, descrizione: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={departmentForm.attivo} onChange={(e) => setDepartmentForm({ ...departmentForm, attivo: e.target.checked })} />Attivo</label></>}

            {modal.type === "ruolo" && <><label>Nome ruolo<input value={roleForm.nome} onChange={(e) => setRoleForm({ ...roleForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="3" value={roleForm.descrizione} onChange={(e) => setRoleForm({ ...roleForm, descrizione: e.target.value })} /></label><label>Livello<input type="number" value={roleForm.livello} onChange={(e) => setRoleForm({ ...roleForm, livello: e.target.value })} /></label><div className="checkbox-group scrollable-check-group"><strong>Permessi del ruolo</strong>{permissions.map((permission) => (<label key={permission.id}><input type="checkbox" checked={(roleForm.permessi || []).includes(permission.id)} onChange={() => toggleListValue(setRoleForm, "permessi", permission.id)} />{permission.codice} · {permission.descrizione || permissionLabels[permission.codice] || ""}</label>))}{permissions.length === 0 && <p>Nessun permesso disponibile. Esegui prima la query SQL.</p>}</div></>}

            {modal.type === "checklist" && <><label>Voce checklist<input value={templateForm.titolo} onChange={(e) => setTemplateForm({ ...templateForm, titolo: e.target.value })} /></label><div className="checkbox-group scrollable-check-group"><strong>Reparti collegati alla voce checklist</strong><p className="muted">Se non selezioni reparti, la voce sarà valida per tutti i reparti.</p>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(templateForm.reparto_ids || []).includes(department.id)} onChange={() => toggleListValue(setTemplateForm, "reparto_ids", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div><label>Ordine<input type="number" value={templateForm.ordine} onChange={(e) => setTemplateForm({ ...templateForm, ordine: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={templateForm.attivo} onChange={(e) => setTemplateForm({ ...templateForm, attivo: e.target.checked })} />Attiva</label></>}

            {modal.type === "utente_accessi" && <><label>Ruolo<select value={userAccessForm.ruolo_id} onChange={(e) => setUserAccessForm({ ...userAccessForm, ruolo_id: e.target.value })}><option value="">Nessun ruolo</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.nome} · livello {role.livello}</option>)}</select></label><label className="check-line"><input type="checkbox" checked={userAccessForm.attivo} onChange={(e) => setUserAccessForm({ ...userAccessForm, attivo: e.target.checked })} />Utente attivo</label><div className="checkbox-group scrollable-check-group"><strong>Reparti dell'utente</strong>{activeDepartments.map((department) => (<label key={department.id}><input type="checkbox" checked={(userAccessForm.reparti || []).includes(department.id)} onChange={() => toggleListValue(setUserAccessForm, "reparti", department.id)} />{department.nome}</label>))}{activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}</div></>}

            <button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

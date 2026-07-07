import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const emptyDepartment = { nome: "", descrizione: "", attivo: true };
const emptyRole = { nome: "", descrizione: "", livello: 10 };
const emptyTemplate = { titolo: "", reparto_id: "", ordine: 1, attivo: true };

export default function Settings() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.manage");

  const [tab, setTab] = useState("checklist");
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [users, setUsers] = useState([]);
  const [userDepartments, setUserDepartments] = useState([]);

  const [modal, setModal] = useState({ open: false, type: "checklist", item: null });
  const [departmentForm, setDepartmentForm] = useState(emptyDepartment);
  const [roleForm, setRoleForm] = useState(emptyRole);
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [selectedUserDepartmentIds, setSelectedUserDepartmentIds] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [departmentsRes, rolesRes, templatesRes, usersRes, userDepartmentsRes] = await Promise.all([
      supabase.from("reparti").select("*").order("nome"),
      supabase.from("ruoli").select("*").order("livello", { ascending: false }),
      supabase.from("checklist_template").select("*,reparti(id,nome)").order("ordine", { ascending: true }),
      supabase.from("utenti").select("id,nome,email,attivo").order("nome"),
      supabase.from("utenti_reparti").select("id,utente_id,reparto_id"),
    ]);

    if (departmentsRes.error) console.error("Errore reparti:", departmentsRes.error.message);
    if (rolesRes.error) console.error("Errore ruoli:", rolesRes.error.message);
    if (templatesRes.error) console.error("Errore checklist:", templatesRes.error.message);
    if (usersRes.error) console.error("Errore utenti:", usersRes.error.message);
    if (userDepartmentsRes.error) console.error("Errore utenti_reparti:", userDepartmentsRes.error.message);

    setDepartments(departmentsRes.data || []);
    setRoles(rolesRes.data || []);
    setTemplates(templatesRes.data || []);
    setUsers(usersRes.data || []);
    setUserDepartments(userDepartmentsRes.data || []);
  }

  const activeDepartments = useMemo(
    () => departments.filter((item) => item.attivo !== false),
    [departments]
  );

  function getUserDepartmentIds(userId) {
    return userDepartments
      .filter((row) => row.utente_id === userId && row.reparto_id)
      .map((row) => row.reparto_id);
  }

  function getUserDepartmentNames(userId) {
    const ids = getUserDepartmentIds(userId);
    const names = ids
      .map((id) => departments.find((department) => department.id === id)?.nome)
      .filter(Boolean);

    return names.length ? names.join(", ") : "Nessun reparto associato";
  }

  function openCreate(type) {
    setModal({ open: true, type, item: null });
    setDepartmentForm(emptyDepartment);
    setRoleForm(emptyRole);
    setTemplateForm(emptyTemplate);
    setSelectedUserDepartmentIds([]);
  }

  function openEdit(type, item) {
    setModal({ open: true, type, item });

    if (type === "reparto") {
      setDepartmentForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        attivo: item.attivo !== false,
      });
    }

    if (type === "ruolo") {
      setRoleForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        livello: item.livello || 10,
      });
    }

    if (type === "checklist") {
      setTemplateForm({
        titolo: item.titolo || "",
        reparto_id: item.reparto_id || "",
        ordine: item.ordine || 1,
        attivo: item.attivo !== false,
      });
    }

    if (type === "utente_reparti") {
      setSelectedUserDepartmentIds(getUserDepartmentIds(item.id));
    }
  }

  function closeModal() {
    setModal({ open: false, type: "checklist", item: null });
    setSelectedUserDepartmentIds([]);
  }

  function toggleUserDepartment(repartoId) {
    setSelectedUserDepartmentIds((current) =>
      current.includes(repartoId)
        ? current.filter((id) => id !== repartoId)
        : [...current, repartoId]
    );
  }

  async function saveReparto(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");

    const payload = {
      nome: departmentForm.nome.trim(),
      descrizione: departmentForm.descrizione.trim() || null,
      attivo: departmentForm.attivo,
    };

    if (!payload.nome) return alert("Inserisci il nome del reparto.");

    setSaving(true);
    const request = modal.item
      ? supabase.from("reparti").update(payload).eq("id", modal.item.id)
      : supabase.from("reparti").insert(payload);

    const { error } = await request;
    setSaving(false);

    if (error) return alert(error.message);

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
    };

    if (!payload.nome) return alert("Inserisci il nome del ruolo.");

    setSaving(true);
    const request = modal.item
      ? supabase.from("ruoli").update(payload).eq("id", modal.item.id)
      : supabase.from("ruoli").insert(payload);

    const { error } = await request;
    setSaving(false);

    if (error) return alert(error.message);

    closeModal();
    await loadData();
  }

  async function saveTemplate(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");

    const payload = {
      titolo: templateForm.titolo.trim(),
      reparto_id: templateForm.reparto_id || null,
      ordine: Number(templateForm.ordine) || 1,
      attivo: templateForm.attivo,
    };

    if (!payload.titolo) return alert("Inserisci la voce checklist.");

    setSaving(true);
    const request = modal.item
      ? supabase.from("checklist_template").update(payload).eq("id", modal.item.id)
      : supabase.from("checklist_template").insert(payload);

    const { error } = await request;
    setSaving(false);

    if (error) return alert(error.message);

    closeModal();
    await loadData();
  }

  async function saveUserDepartments(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    if (!modal.item?.id) return alert("Utente non selezionato.");

    setSaving(true);

    const deleteRes = await supabase
      .from("utenti_reparti")
      .delete()
      .eq("utente_id", modal.item.id);

    if (deleteRes.error) {
      setSaving(false);
      return alert(deleteRes.error.message);
    }

    const rows = selectedUserDepartmentIds.map((reparto_id) => ({
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

    setSaving(false);
    closeModal();
    await loadData();
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
          <p>Gestione checklist preimpostate, reparti, ruoli e associazioni utente/reparto.</p>
        </div>
      </div>

      <div className="settings-tabs">
        <button className={tab === "checklist" ? "active" : ""} onClick={() => setTab("checklist")}>
          Checklist progetto
        </button>
        <button className={tab === "reparti" ? "active" : ""} onClick={() => setTab("reparti")}>
          Reparti
        </button>
        <button className={tab === "ruoli" ? "active" : ""} onClick={() => setTab("ruoli")}>
          Ruoli
        </button>
        <button className={tab === "utenti" ? "active" : ""} onClick={() => setTab("utenti")}>
          Utenti / reparti
        </button>
      </div>

      {tab === "checklist" && (
        <div className="panel settings-panel">
          <div className="panel-header">
            <h3>Voci checklist preimpostate</h3>
            {canManage && (
              <button className="primary-action" onClick={() => openCreate("checklist")}>
                <Plus size={18} /> Nuova voce
              </button>
            )}
          </div>

          <div className="settings-list">
            {templates.map((item) => (
              <div className="settings-row" key={item.id}>
                <div>
                  <strong>{item.titolo}</strong>
                  <span>{item.reparti?.nome || "Tutti i reparti"}</span>
                </div>
                <span className={`config-status ${item.attivo ? "active" : "inactive"}`}>
                  {item.attivo ? "Attiva" : "Disattiva"}
                </span>
                <span className="role-level">Ordine {item.ordine}</span>
                <div className="config-actions">
                  <button onClick={() => openEdit("checklist", item)}>
                    <Pencil size={16} />
                  </button>
                  <button className="danger" onClick={() => remove("checklist", item)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "reparti" && (
        <div className="panel settings-panel">
          <div className="panel-header">
            <h3>Reparti</h3>
            {canManage && (
              <button className="primary-action" onClick={() => openCreate("reparto")}>
                <Plus size={18} /> Nuovo reparto
              </button>
            )}
          </div>

          <div className="settings-list">
            {departments.map((item) => (
              <div className="settings-row" key={item.id}>
                <div>
                  <strong>{item.nome}</strong>
                  <span>{item.descrizione || "Nessuna descrizione"}</span>
                </div>
                <span className={`config-status ${item.attivo ? "active" : "inactive"}`}>
                  {item.attivo ? "Attivo" : "Disattivo"}
                </span>
                <div className="config-actions">
                  <button onClick={() => openEdit("reparto", item)}>
                    <Pencil size={16} />
                  </button>
                  <button className="danger" onClick={() => remove("reparto", item)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "ruoli" && (
        <div className="panel settings-panel">
          <div className="panel-header">
            <h3>Ruoli</h3>
            {canManage && (
              <button className="primary-action" onClick={() => openCreate("ruolo")}>
                <Plus size={18} /> Nuovo ruolo
              </button>
            )}
          </div>

          <div className="settings-list">
            {roles.map((item) => (
              <div className="settings-row" key={item.id}>
                <div>
                  <strong>{item.nome}</strong>
                  <span>{item.descrizione || "Nessuna descrizione"}</span>
                </div>
                <span className="role-level">Livello {item.livello}</span>
                <div className="config-actions">
                  <button onClick={() => openEdit("ruolo", item)}>
                    <Pencil size={16} />
                  </button>
                  <button className="danger" onClick={() => remove("ruolo", item)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "utenti" && (
        <div className="panel settings-panel">
          <div className="panel-header">
            <h3>Utenti / reparti</h3>
          </div>

          <div className="settings-list">
            {users.map((item) => (
              <div className="settings-row" key={item.id}>
                <div>
                  <strong>{item.nome || item.email || "Utente senza nome"}</strong>
                  <span>{item.email || "Email non disponibile"}</span>
                  <span>Reparti: {getUserDepartmentNames(item.id)}</span>
                </div>

                <span className={`config-status ${item.attivo !== false ? "active" : "inactive"}`}>
                  {item.attivo !== false ? "Attivo" : "Disattivo"}
                </span>

                <div className="config-actions">
                  <button onClick={() => openEdit("utente_reparti", item)}>
                    <Pencil size={16} />
                  </button>
                </div>
              </div>
            ))}

            {users.length === 0 && <p>Nessun utente trovato.</p>}
          </div>
        </div>
      )}

      {modal.open && (
        <div className="modal-backdrop">
          <form
            className="modal-card v4-modal"
            onSubmit={
              modal.type === "reparto"
                ? saveReparto
                : modal.type === "ruolo"
                  ? saveRuolo
                  : modal.type === "utente_reparti"
                    ? saveUserDepartments
                    : saveTemplate
            }
          >
            <div className="modal-header">
              <h2>
                {modal.type === "utente_reparti"
                  ? `Reparti di ${modal.item?.nome || modal.item?.email || "utente"}`
                  : modal.item
                    ? "Modifica"
                    : "Nuovo"}
              </h2>
              <button type="button" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>

            {modal.type === "reparto" && (
              <>
                <label>
                  Nome reparto
                  <input
                    value={departmentForm.nome}
                    onChange={(e) => setDepartmentForm({ ...departmentForm, nome: e.target.value })}
                  />
                </label>

                <label>
                  Descrizione
                  <textarea
                    rows="3"
                    value={departmentForm.descrizione}
                    onChange={(e) => setDepartmentForm({ ...departmentForm, descrizione: e.target.value })}
                  />
                </label>

                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={departmentForm.attivo}
                    onChange={(e) => setDepartmentForm({ ...departmentForm, attivo: e.target.checked })}
                  />
                  Attivo
                </label>
              </>
            )}

            {modal.type === "ruolo" && (
              <>
                <label>
                  Nome ruolo
                  <input
                    value={roleForm.nome}
                    onChange={(e) => setRoleForm({ ...roleForm, nome: e.target.value })}
                  />
                </label>

                <label>
                  Descrizione
                  <textarea
                    rows="3"
                    value={roleForm.descrizione}
                    onChange={(e) => setRoleForm({ ...roleForm, descrizione: e.target.value })}
                  />
                </label>

                <label>
                  Livello
                  <input
                    type="number"
                    value={roleForm.livello}
                    onChange={(e) => setRoleForm({ ...roleForm, livello: e.target.value })}
                  />
                </label>
              </>
            )}

            {modal.type === "checklist" && (
              <>
                <label>
                  Voce checklist
                  <input
                    value={templateForm.titolo}
                    onChange={(e) => setTemplateForm({ ...templateForm, titolo: e.target.value })}
                  />
                </label>

                <label>
                  Reparto
                  <select
                    value={templateForm.reparto_id}
                    onChange={(e) => setTemplateForm({ ...templateForm, reparto_id: e.target.value })}
                  >
                    <option value="">Tutti i reparti</option>
                    {activeDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Ordine
                  <input
                    type="number"
                    value={templateForm.ordine}
                    onChange={(e) => setTemplateForm({ ...templateForm, ordine: e.target.value })}
                  />
                </label>

                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={templateForm.attivo}
                    onChange={(e) => setTemplateForm({ ...templateForm, attivo: e.target.checked })}
                  />
                  Attiva
                </label>
              </>
            )}

            {modal.type === "utente_reparti" && (
              <div className="checkbox-group scrollable-check-group">
                <strong>Seleziona uno o più reparti</strong>

                {activeDepartments.map((department) => (
                  <label key={department.id}>
                    <input
                      type="checkbox"
                      checked={selectedUserDepartmentIds.includes(department.id)}
                      onChange={() => toggleUserDepartment(department.id)}
                    />
                    {department.nome}
                  </label>
                ))}

                {activeDepartments.length === 0 && <p>Nessun reparto attivo disponibile.</p>}
              </div>
            )}

            <button className="primary-action" disabled={saving}>
              <Save size={18} />
              {saving ? "Salvataggio..." : "Salva"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

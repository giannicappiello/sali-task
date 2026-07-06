import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const emptyRole = { nome: "", descrizione: "", livello: 10 };
const emptyDepartment = { nome: "", descrizione: "", attivo: true };

function Settings() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.manage");

  const [activeTab, setActiveTab] = useState("reparti");
  const [reparti, setReparti] = useState([]);
  const [ruoli, setRuoli] = useState([]);

  const [modal, setModal] = useState({ open: false, type: "reparto", item: null });
  const [roleForm, setRoleForm] = useState(emptyRole);
  const [departmentForm, setDepartmentForm] = useState(emptyDepartment);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [repartiRes, ruoliRes] = await Promise.all([
      supabase.from("reparti").select("*").order("nome"),
      supabase.from("ruoli").select("*").order("livello", { ascending: false }),
    ]);

    if (repartiRes.error) {
      console.error("Errore reparti:", repartiRes.error);
      setReparti([]);
    } else {
      setReparti(repartiRes.data || []);
    }

    if (ruoliRes.error) {
      console.error("Errore ruoli:", ruoliRes.error);
      setRuoli([]);
    } else {
      setRuoli(ruoliRes.data || []);
    }
  }

  function openCreate(type) {
    setModal({ open: true, type, item: null });
    setRoleForm(emptyRole);
    setDepartmentForm(emptyDepartment);
  }

  function openEdit(type, item) {
    setModal({ open: true, type, item });

    if (type === "ruolo") {
      setRoleForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        livello: item.livello || 10,
      });
    } else {
      setDepartmentForm({
        nome: item.nome || "",
        descrizione: item.descrizione || "",
        attivo: item.attivo !== false,
      });
    }
  }

  function closeModal() {
    setModal({ open: false, type: "reparto", item: null });
    setRoleForm(emptyRole);
    setDepartmentForm(emptyDepartment);
  }

  async function saveReparto(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");

    if (!departmentForm.nome.trim()) {
      alert("Inserisci il nome del reparto.");
      return;
    }

    setSaving(true);

    const payload = {
      nome: departmentForm.nome.trim(),
      descrizione: departmentForm.descrizione.trim() || null,
      attivo: departmentForm.attivo,
    };

    const request = modal.item
      ? supabase.from("reparti").update(payload).eq("id", modal.item.id)
      : supabase.from("reparti").insert(payload);

    const { error } = await request;

    setSaving(false);

    if (error) {
      console.error(error);
      alert("Errore durante il salvataggio del reparto.");
      return;
    }

    await loadData();
    closeModal();
  }

  async function saveRuolo(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");

    if (!roleForm.nome.trim()) {
      alert("Inserisci il nome del ruolo.");
      return;
    }

    setSaving(true);

    const payload = {
      nome: roleForm.nome.trim().toLowerCase(),
      descrizione: roleForm.descrizione.trim() || null,
      livello: Number(roleForm.livello) || 0,
    };

    const request = modal.item
      ? supabase.from("ruoli").update(payload).eq("id", modal.item.id)
      : supabase.from("ruoli").insert(payload);

    const { error } = await request;

    setSaving(false);

    if (error) {
      console.error(error);
      alert("Errore durante il salvataggio del ruolo.");
      return;
    }

    await loadData();
    closeModal();
  }

  async function deleteReparto(item) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!window.confirm(`Eliminare il reparto ${item.nome}?`)) return;

    const { error } = await supabase.from("reparti").delete().eq("id", item.id);

    if (error) {
      console.error(error);
      alert("Impossibile eliminare il reparto. Potrebbe essere collegato a utenti o task.");
      return;
    }

    await loadData();
  }

  async function deleteRuolo(item) {
    if (!canManage) return alert("Non hai i permessi.");

    if (item.nome === "admin") {
      alert("Non puoi eliminare il ruolo admin.");
      return;
    }

    if (!window.confirm(`Eliminare il ruolo ${item.nome}?`)) return;

    const { error } = await supabase.from("ruoli").delete().eq("id", item.id);

    if (error) {
      console.error(error);
      alert("Impossibile eliminare il ruolo. Potrebbe essere collegato a utenti o permessi.");
      return;
    }

    await loadData();
  }

  return (
    <div className="settings-page">
      <div className="page-title-row">
        <div>
          <h1>Impostazioni</h1>
          <p>Gestione ruoli, reparti e configurazioni base.</p>
        </div>
      </div>

      <div className="settings-tabs">
        <button className={activeTab === "reparti" ? "active" : ""} onClick={() => setActiveTab("reparti")}>
          Reparti
        </button>
        <button className={activeTab === "ruoli" ? "active" : ""} onClick={() => setActiveTab("ruoli")}>
          Ruoli
        </button>
      </div>

      {activeTab === "reparti" && (
        <div className="panel settings-panel">
          <div className="panel-header">
            <h3>Reparti</h3>
            {canManage && (
              <button className="primary-action" onClick={() => openCreate("reparto")}>
                <Plus size={18} />
                Nuovo reparto
              </button>
            )}
          </div>

          <div className="settings-list">
            {reparti.map((item) => (
              <div className="settings-row" key={item.id}>
                <div>
                  <strong>{item.nome}</strong>
                  <span>{item.descrizione || "Nessuna descrizione"}</span>
                </div>
                <span className={`config-status ${item.attivo ? "active" : "inactive"}`}>
                  {item.attivo ? "Attivo" : "Disattivo"}
                </span>
                <div className="config-actions">
                  <button onClick={() => openEdit("reparto", item)}><Pencil size={16} /></button>
                  <button className="danger" onClick={() => deleteReparto(item)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "ruoli" && (
        <div className="panel settings-panel">
          <div className="panel-header">
            <h3>Ruoli</h3>
            {canManage && (
              <button className="primary-action" onClick={() => openCreate("ruolo")}>
                <Plus size={18} />
                Nuovo ruolo
              </button>
            )}
          </div>

          <div className="settings-list">
            {ruoli.map((item) => (
              <div className="settings-row" key={item.id}>
                <div>
                  <strong>{item.nome}</strong>
                  <span>{item.descrizione || "Nessuna descrizione"}</span>
                </div>
                <span className="role-level">Livello {item.livello}</span>
                <div className="config-actions">
                  <button onClick={() => openEdit("ruolo", item)}><Pencil size={16} /></button>
                  <button className="danger" onClick={() => deleteRuolo(item)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal.open && (
        <div className="modal-backdrop">
          <div className="config-modal">
            <div className="modal-header">
              <div>
                <h2>{modal.item ? "Modifica" : "Nuovo"} {modal.type === "ruolo" ? "ruolo" : "reparto"}</h2>
                <p>Gestisci le configurazioni base del workspace.</p>
              </div>
              <button className="modal-close" onClick={closeModal}><X size={22} /></button>
            </div>

            {modal.type === "reparto" ? (
              <form className="config-form" onSubmit={saveReparto}>
                <div className="form-group full">
                  <label>Nome reparto</label>
                  <input value={departmentForm.nome} onChange={(e) => setDepartmentForm({ ...departmentForm, nome: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label>Descrizione</label>
                  <textarea value={departmentForm.descrizione} onChange={(e) => setDepartmentForm({ ...departmentForm, descrizione: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label>Stato</label>
                  <select value={departmentForm.attivo ? "true" : "false"} onChange={(e) => setDepartmentForm({ ...departmentForm, attivo: e.target.value === "true" })}>
                    <option value="true">Attivo</option>
                    <option value="false">Disattivo</option>
                  </select>
                </div>
                <div className="modal-actions">
                  <button type="button" className="secondary-action" onClick={closeModal}>Annulla</button>
                  <button className="primary-action" disabled={saving}><Save size={18} /> Salva</button>
                </div>
              </form>
            ) : (
              <form className="config-form" onSubmit={saveRuolo}>
                <div className="form-group full">
                  <label>Nome ruolo</label>
                  <input value={roleForm.nome} onChange={(e) => setRoleForm({ ...roleForm, nome: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label>Descrizione</label>
                  <textarea value={roleForm.descrizione} onChange={(e) => setRoleForm({ ...roleForm, descrizione: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label>Livello</label>
                  <input type="number" value={roleForm.livello} onChange={(e) => setRoleForm({ ...roleForm, livello: e.target.value })} />
                </div>
                <div className="modal-actions">
                  <button type="button" className="secondary-action" onClick={closeModal}>Annulla</button>
                  <button className="primary-action" disabled={saving}><Save size={18} /> Salva</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;

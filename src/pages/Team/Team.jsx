import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  UserCheck,
  UserX,
  X,
  Save,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import "./Team.css";

const emptyForm = {
  nome: "",
  email: "",
  password: "",
  telefono: "",
  ruolo_id: "",
  reparto_id: "",
  attivo: true,
};

function Team() {
  const { profile, hasPermission } = useAuth();

  const [utenti, setUtenti] = useState([]);
  const [ruoli, setRuoli] = useState([]);
  const [reparti, setReparti] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const canManageTeam = hasPermission("team.manage");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const [utentiRes, ruoliRes, repartiRes] = await Promise.all([
      supabase
        .from("utenti")
        .select(`
          id,
          auth_user_id,
          nome,
          email,
          telefono,
          avatar_url,
          attivo,
          ultimo_accesso,
          created_at,
          reparto_id,
          ruolo_id,
          reparti(id, nome),
          ruoli(id, nome, livello)
        `)
        .order("nome"),
      supabase.from("ruoli").select("id, nome, livello").order("livello", { ascending: false }),
      supabase.from("reparti").select("id, nome").eq("attivo", true).order("nome"),
    ]);

    if (utentiRes.error) {
      console.error("Errore caricamento utenti:", utentiRes.error);
      setUtenti([]);
    } else {
      setUtenti(utentiRes.data || []);
    }

    if (ruoliRes.error) {
      console.error("Errore caricamento ruoli:", ruoliRes.error);
      setRuoli([]);
    } else {
      setRuoli(ruoliRes.data || []);
    }

    if (repartiRes.error) {
      console.error("Errore caricamento reparti:", repartiRes.error);
      setReparti([]);
    } else {
      setReparti(repartiRes.data || []);
    }

    setLoading(false);
  }

  function openCreateModal() {
    setEditingUser(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEditModal(user) {
    setEditingUser(user);
    setForm({
      nome: user.nome || "",
      email: user.email || "",
      password: "",
      telefono: user.telefono || "",
      ruolo_id: user.ruolo_id || "",
      reparto_id: user.reparto_id || "",
      attivo: Boolean(user.attivo),
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingUser(null);
    setForm(emptyForm);
  }

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function callAdminFunction(payload) {
    const { data, error } = await supabase.functions.invoke("admin-manage-user", {
      body: payload,
    });

    if (error) {
      throw new Error(error.message || "Errore funzione admin.");
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  }

  async function handleSave(e) {
    e.preventDefault();

    if (!canManageTeam) {
      alert("Non hai i permessi per gestire gli utenti.");
      return;
    }

    if (!form.nome.trim()) {
      alert("Inserisci il nome dell'utente.");
      return;
    }

    if (!form.email.trim()) {
      alert("Inserisci l'email dell'utente.");
      return;
    }

    if (!editingUser && !form.password.trim()) {
      alert("Inserisci la password iniziale dell'utente.");
      return;
    }

    if (form.password.trim() && form.password.trim().length < 8) {
      alert("La password deve avere almeno 8 caratteri.");
      return;
    }

    setSaving(true);

    try {
      await callAdminFunction({
        action: editingUser ? "update" : "create",
        id: editingUser?.id || null,
        auth_user_id: editingUser?.auth_user_id || null,
        nome: form.nome,
        email: form.email,
        password: form.password,
        telefono: form.telefono,
        ruolo_id: form.ruolo_id || null,
        reparto_id: form.reparto_id || null,
        attivo: form.attivo,
      });

      await loadData();
      closeModal();
    } catch (error) {
      console.error("Errore salvataggio utente:", error);
      alert(error.message || "Errore durante il salvataggio dell'utente.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user) {
    if (!canManageTeam) {
      alert("Non hai i permessi per gestire gli utenti.");
      return;
    }

    if (user.id === profile?.id && user.attivo) {
      alert("Non puoi disattivare il tuo stesso utente.");
      return;
    }

    const action = user.attivo ? "disattivare" : "riattivare";
    const confirmed = window.confirm(`Vuoi ${action} ${user.nome}?`);

    if (!confirmed) return;

    try {
      await callAdminFunction({
        action: "update",
        id: user.id,
        auth_user_id: user.auth_user_id,
        nome: user.nome,
        email: user.email,
        password: "",
        telefono: user.telefono || "",
        ruolo_id: user.ruolo_id || null,
        reparto_id: user.reparto_id || null,
        attivo: !user.attivo,
      });

      await loadData();
    } catch (error) {
      console.error("Errore aggiornamento stato utente:", error);
      alert(error.message || "Errore durante l'aggiornamento dello stato utente.");
    }
  }

  async function deleteUser(user) {
    if (!canManageTeam) {
      alert("Non hai i permessi per eliminare utenti.");
      return;
    }

    if (user.id === profile?.id) {
      alert("Non puoi eliminare il tuo stesso utente.");
      return;
    }

    const confirmed = window.confirm(
      `Vuoi eliminare ${user.nome}?\n\nL'utente verrà eliminato sia dalla tabella utenti sia da Supabase Auth se collegato.`
    );

    if (!confirmed) return;

    try {
      await callAdminFunction({
        action: "delete",
        id: user.id,
        auth_user_id: user.auth_user_id,
      });

      await loadData();
    } catch (error) {
      console.error("Errore eliminazione utente:", error);
      alert(error.message || "Errore durante l'eliminazione dell'utente.");
    }
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

  function isUserOnline(user) {
    if (!user?.attivo || !user?.ultimo_accesso) return false;
    const lastAccess = new Date(user.ultimo_accesso).getTime();
    if (Number.isNaN(lastAccess)) return false;
    return Date.now() - lastAccess <= 15 * 60 * 1000;
  }

  function getInitials(name) {
    if (!name) return "UT";

    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return utenti;

    return utenti.filter((user) => {
      const text = `
        ${user.nome || ""}
        ${user.email || ""}
        ${user.telefono || ""}
        ${user.ruoli?.nome || ""}
        ${user.reparti?.nome || ""}
      `.toLowerCase();

      return text.includes(query);
    });
  }, [utenti, search]);

  return (
    <div className="team-page">
      <div className="page-title-row">
        <div>
          <h1>Team</h1>
          <p>Gestione utenti, password, ruoli, reparti e stato accesso.</p>
        </div>

        {canManageTeam && (
          <button className="primary-action" onClick={openCreateModal}>
            <Plus size={18} />
            Nuovo utente
          </button>
        )}
      </div>

      <div className="team-toolbar">
        <div className="team-search">
          <Search size={18} />
          <input
            placeholder="Cerca nome, email, ruolo o reparto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="team-counter">
          {filteredUsers.length} utenti
        </div>
      </div>

      <div className="panel team-panel">
        {loading ? (
          <p className="table-message">Caricamento utenti...</p>
        ) : filteredUsers.length === 0 ? (
          <p className="table-message">Nessun utente trovato.</p>
        ) : (
          <div className="users-table">
            <div className="users-table-head">
              <span>Utente</span>
              <span>Ruolo</span>
              <span>Reparto</span>
              <span>Telefono</span>
              <span>Ultimo accesso</span>
              <span>Stato</span>
              <span>Azioni</span>
            </div>

            {filteredUsers.map((user) => (
              <div className="users-table-row" key={user.id}>
                <div className="user-cell">
                  <div className="user-avatar">{getInitials(user.nome)}</div>
                  <div>
                    <strong>{user.nome}</strong>
                    <small>{user.email}</small>
                    <span className={`presence-badge ${isUserOnline(user) ? "online" : "offline"}`}>
                      {isUserOnline(user) ? "Online" : "Offline"}
                    </span>
                    {!user.auth_user_id && (
                      <em>Profilo non ancora collegato ad Auth</em>
                    )}
                  </div>
                </div>

                <span>{user.ruoli?.nome || "-"}</span>
                <span>{user.reparti?.nome || "-"}</span>
                <span>{user.telefono || "-"}</span>
                <span>{formatDateTime(user.ultimo_accesso)}</span>

                <span className={`user-status ${user.attivo ? "active" : "inactive"}`}>
                  {user.attivo ? (
                    <>
                      <UserCheck size={15} />
                      Attivo
                    </>
                  ) : (
                    <>
                      <UserX size={15} />
                      Disattivo
                    </>
                  )}
                </span>

                <div className="user-actions">
                  {canManageTeam ? (
                    <>
                      <button
                        title="Modifica"
                        onClick={() => openEditModal(user)}
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        title={user.attivo ? "Disattiva" : "Riattiva"}
                        onClick={() => toggleActive(user)}
                      >
                        {user.attivo ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>

                      <button
                        title="Elimina"
                        className="danger"
                        onClick={() => deleteUser(user)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  ) : (
                    <span className="readonly-label">Sola lettura</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="user-modal">
            <div className="modal-header">
              <div>
                <h2>{editingUser ? "Modifica utente" : "Nuovo utente"}</h2>
                <p>
                  {editingUser
                    ? "Aggiorna dati, ruolo, reparto, stato e password se necessario."
                    : "Crea direttamente un utente con email e password di accesso."}
                </p>
              </div>

              <button className="modal-close" onClick={closeModal} type="button">
                <X size={22} />
              </button>
            </div>

            <form className="user-form" onSubmit={handleSave}>
              <div className="form-group full">
                <label>Nome *</label>
                <input
                  value={form.nome}
                  onChange={(e) => updateForm("nome", e.target.value)}
                  placeholder="Es. Mario Rossi"
                  autoFocus
                />
              </div>

              <div className="form-group full">
                <label>Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateForm("email", e.target.value)}
                  placeholder="nome@progre.it"
                />
              </div>

              <div className="form-group full">
                <label>
                  {editingUser ? "Nuova password" : "Password iniziale *"}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => updateForm("password", e.target.value)}
                  placeholder={
                    editingUser
                      ? "Lascia vuoto per non cambiarla"
                      : "Minimo 8 caratteri"
                  }
                />
                <small className="form-hint">
                  {editingUser
                    ? "Compila questo campo solo se vuoi cambiare la password dell'utente."
                    : "L'utente potrà accedere con questa password."}
                </small>
              </div>

              <div className="form-group">
                <label>Telefono</label>
                <input
                  value={form.telefono}
                  onChange={(e) => updateForm("telefono", e.target.value)}
                  placeholder="Telefono"
                />
              </div>

              <div className="form-group">
                <label>Ruolo</label>
                <select
                  value={form.ruolo_id}
                  onChange={(e) => updateForm("ruolo_id", e.target.value)}
                >
                  <option value="">Seleziona ruolo</option>
                  {ruoli.map((ruolo) => (
                    <option key={ruolo.id} value={ruolo.id}>
                      {ruolo.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Reparto</label>
                <select
                  value={form.reparto_id}
                  onChange={(e) => updateForm("reparto_id", e.target.value)}
                >
                  <option value="">Seleziona reparto</option>
                  {reparti.map((reparto) => (
                    <option key={reparto.id} value={reparto.id}>
                      {reparto.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Stato</label>
                <select
                  value={form.attivo ? "true" : "false"}
                  onChange={(e) => updateForm("attivo", e.target.value === "true")}
                >
                  <option value="true">Attivo</option>
                  <option value="false">Disattivo</option>
                </select>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={closeModal}>
                  Annulla
                </button>

                <button type="submit" className="primary-action" disabled={saving}>
                  <Save size={18} />
                  {saving ? "Salvataggio..." : "Salva utente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Team;

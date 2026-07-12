import { useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const emptyAccess = {
  enabled: false,
  access_level: "read",
  external_role: "beauty",
  external_user_id: "",
  external_beauty_id: "",
  external_agent_id: "",
  allowed_pages: ["dashboard", "aperture", "giornate", "analisi"],
};

const pages = [
  ["dashboard", "Dashboard"],
  ["aperture", "Aperture/Contatti"],
  ["giornate", "Giornate"],
  ["analisi", "Analisi dati"],
  ["prodotti", "Prodotti"],
  ["farmacie", "Farmacie"],
  ["utenti", "Utenti"],
];

export default function PharmacyAccessSettings({ canManage }) {
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyAccess);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  function fullName(user) {
    return `${user?.nome || ""} ${user?.cognome || ""}`.trim();
  }

  async function load() {
    setLoading(true);

    const [usersRes, accessRes, agentsRes] = await Promise.all([
      supabase
        .from("utenti")
        .select("id,auth_user_id,nome,cognome,email,telefono,attivo,ruoli(nome)")
        .order("nome"),
      supabase
        .from("integrazioni_utenti")
        .select("*")
        .eq("modulo", "report_giornate"),
      supabase.functions.invoke("report-giornate-api", {
        body: {
          action: "query",
          table: "agent",
          operation: "select",
          columns: "id,nome,cognome,email,telefono,attivo",
          filters: [],
          modifiers: {
            order: { column: "cognome", ascending: true },
          },
        },
      }),
    ]);

    if (usersRes.error) {
      setLoading(false);
      return alert(usersRes.error.message);
    }

    if (accessRes.error) {
      setLoading(false);
      return alert(accessRes.error.message);
    }

    setUsers(usersRes.data || []);
    setRows(accessRes.data || []);

    if (agentsRes.error || agentsRes.data?.error) {
      console.error(
        "Errore caricamento agenti Gestione Farmacie:",
        agentsRes.data?.error || agentsRes.error
      );
      setAgents([]);
    } else {
      setAgents(agentsRes.data?.data || []);
    }

    setLoading(false);
  }

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId),
    [users, selectedId]
  );

  function chooseUser(id) {
    setSelectedId(id);
    const existing = rows.find((row) => row.utente_id === id);

    setForm(
      existing
        ? {
            enabled: existing.enabled !== false,
            access_level: existing.access_level || "read",
            external_role: existing.external_role || "beauty",
            external_user_id: existing.external_user_id || "",
            external_beauty_id: existing.external_beauty_id || "",
            external_agent_id: existing.external_agent_id || "",
            allowed_pages: Array.isArray(existing.allowed_pages)
              ? existing.allowed_pages
              : emptyAccess.allowed_pages,
          }
        : { ...emptyAccess }
    );
  }

  function togglePage(id) {
    setForm((current) => ({
      ...current,
      allowed_pages: current.allowed_pages.includes(id)
        ? current.allowed_pages.filter((page) => page !== id)
        : [...current.allowed_pages, id],
    }));
  }

  async function ensureExternalProfile() {
    if (!selectedUser || !form.enabled) {
      return {
        external_user_id: form.external_user_id || null,
        external_beauty_id: form.external_beauty_id || null,
        external_agent_id: form.external_agent_id || null,
      };
    }

    if (!["beauty", "agent"].includes(form.external_role)) {
      return {
        external_user_id: form.external_user_id || null,
        external_beauty_id: form.external_beauty_id || null,
        external_agent_id: form.external_agent_id || null,
      };
    }

    const { data, error } = await supabase.functions.invoke(
      "report-giornate-api",
      {
        body: {
          action: "ensure-external-user",
          ruolo: form.external_role,
          nome: selectedUser.nome || "",
          cognome: selectedUser.cognome || "",
          email: selectedUser.email || "",
          telefono: selectedUser.telefono || "",
          external_user_id: form.external_user_id || null,
          external_beauty_id: form.external_beauty_id || null,
          external_agent_id: form.external_agent_id || null,
        },
      }
    );

    if (error) {
      throw new Error(error.message || "Errore creazione profilo Gestione Farmacie.");
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  }

  async function save() {
    if (!canManage || !selectedId || !selectedUser) return;

    if (form.enabled && !selectedUser.email) {
      return alert("L'utente selezionato non ha un indirizzo email.");
    }

    setSaving(true);

    try {
      const external = await ensureExternalProfile();

      const payload = {
        utente_id: selectedId,
        modulo: "report_giornate",
        enabled: form.enabled,
        access_level: form.access_level,
        external_role: form.external_role || null,
        external_user_id:
          external.external_user_id || form.external_user_id || null,
        external_beauty_id:
          external.external_beauty_id || form.external_beauty_id || null,
        external_agent_id:
          external.external_agent_id || form.external_agent_id || null,
        allowed_pages: form.allowed_pages,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("integrazioni_utenti")
        .upsert(payload, { onConflict: "utente_id,modulo" });

      if (error) throw error;

      await load();
      chooseUser(selectedId);
      alert("Accessi Gestione Farmacie aggiornati.");
    } catch (error) {
      alert(error.message || "Errore durante il salvataggio degli accessi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel settings-panel pharmacy-access-settings">
      <div className="panel-header">
        <div>
          <h3>Accessi Gestione Farmacie</h3>
          <p>
            Un unico login per entrambi i sistemi. Qui definisci chi accede e
            quali dati può gestire.
          </p>
        </div>
        <ShieldCheck size={28} />
      </div>

      <div className="pharmacy-access-grid">
        <div className="pharmacy-user-list">
          {users.map((user) => {
            const access = rows.find((row) => row.utente_id === user.id);

            return (
              <button
                key={user.id}
                className={selectedId === user.id ? "active" : ""}
                onClick={() => chooseUser(user.id)}
              >
                <strong>{fullName(user) || user.email}</strong>
                <span>{user.email}</span>
                <small>
                  {access?.enabled
                    ? `Abilitato · ${access.access_level}`
                    : "Non abilitato"}
                </small>
              </button>
            );
          })}
        </div>

        <div className="pharmacy-access-form">
          {loading ? (
            <div className="empty-state">Caricamento...</div>
          ) : !selectedUser ? (
            <div className="empty-state">Seleziona un utente.</div>
          ) : (
            <>
              <h4>{fullName(selectedUser) || selectedUser.email}</h4>

              <label className="check-line">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                Abilita Gestione Farmacie
              </label>

              <label>
                Livello accesso
                <select
                  value={form.access_level}
                  onChange={(event) =>
                    setForm({ ...form, access_level: event.target.value })
                  }
                >
                  <option value="read">Solo lettura</option>
                  <option value="write">Lettura e modifica</option>
                  <option value="admin">Amministratore modulo</option>
                </select>
              </label>

              <label>
                Ruolo nel modulo
                <select
                  value={form.external_role}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      external_role: event.target.value,
                      external_beauty_id:
                        event.target.value === "beauty"
                          ? form.external_beauty_id
                          : "",
                      external_agent_id:
                        event.target.value === "beauty"
                          ? form.external_agent_id
                          : event.target.value === "agent"
                          ? form.external_agent_id
                          : "",
                    })
                  }
                >
                  <option value="beauty">Beauty consultant</option>
                  <option value="agent">Agente</option>
                  <option value="sales_manager">Sales manager</option>
                  <option value="admin">Admin</option>
                </select>
              </label>

              {form.external_role === "beauty" && (
                <label>
                  Agente da associare
                  <select
                    value={form.external_agent_id}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        external_agent_id: event.target.value,
                      })
                    }
                  >
                    <option value="">Nessun agente</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {fullName(agent) || agent.email || agent.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {form.external_role === "agent" && (
                <label>
                  ID agente creato/collegato
                  <input
                    value={form.external_agent_id}
                    readOnly
                    placeholder="Compilato automaticamente al salvataggio"
                  />
                </label>
              )}

              <label>
                ID utente storico report-giornate
                <input
                  value={form.external_user_id}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      external_user_id: event.target.value,
                    })
                  }
                  placeholder="Compilato automaticamente al salvataggio"
                />
              </label>

              {form.external_role === "beauty" && (
                <label>
                  ID beauty consultant
                  <input
                    value={form.external_beauty_id}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        external_beauty_id: event.target.value,
                      })
                    }
                    placeholder="Compilato automaticamente al salvataggio"
                  />
                </label>
              )}

              <div className="checkbox-group">
                <strong>Pagine accessibili</strong>
                {pages.map(([id, label]) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={form.allowed_pages.includes(id)}
                      onChange={() => togglePage(id)}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <button
                className="primary-action"
                disabled={saving || !canManage}
                onClick={save}
              >
                <Save size={18} />
                {saving ? "Salvataggio..." : "Salva accessi"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

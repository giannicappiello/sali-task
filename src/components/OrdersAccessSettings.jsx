import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const MODULE_CODE = "gestione_ordini";

function normalizeAgentCode(value) {
  return String(value || "").trim();
}

function isValidAgentCode(value) {
  return /^602\.\d{5}$/.test(normalizeAgentCode(value));
}

export default function OrdersAccessSettings({ canManage }) {
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const [usersRes, integrationsRes] = await Promise.all([
      supabase
        .from("utenti")
        .select("id,nome,cognome,email,attivo,ruoli(id,nome,livello)")
        .order("nome", { ascending: true }),
      supabase
        .from("integrazioni_utenti")
        .select("id,utente_id,modulo,enabled,codice_agente_mexal")
        .eq("modulo", MODULE_CODE),
    ]);

    if (usersRes.error) console.error("Errore utenti:", usersRes.error);
    if (integrationsRes.error) console.error("Errore accessi ordini:", integrationsRes.error);

    const nextUsers = usersRes.data || [];
    const nextRows = integrationsRes.data || [];
    const nextDrafts = {};

    nextUsers.forEach((user) => {
      const access = nextRows.find((row) => row.utente_id === user.id);
      nextDrafts[user.id] = {
        enabled: access?.enabled === true,
        codice_agente_mexal: access?.codice_agente_mexal || "",
      };
    });

    setUsers(nextUsers);
    setRows(nextRows);
    setDrafts(nextDrafts);
    setLoading(false);
  }

  const enabledCount = useMemo(
    () => Object.values(drafts).filter((item) => item.enabled).length,
    [drafts]
  );

  function updateDraft(userId, field, value) {
    setDrafts((current) => ({
      ...current,
      [userId]: {
        enabled: false,
        codice_agente_mexal: "",
        ...(current[userId] || {}),
        [field]: value,
      },
    }));
  }

  async function saveUser(user) {
    if (!canManage) return alert("Non hai i permessi per modificare gli accessi.");

    const draft = drafts[user.id] || { enabled: false, codice_agente_mexal: "" };
    const code = normalizeAgentCode(draft.codice_agente_mexal);

    if (draft.enabled && !isValidAgentCode(code)) {
      return alert("Inserisci un codice agente Mexal valido nel formato 602.00000.");
    }

    setSavingId(user.id);

    const payload = {
      utente_id: user.id,
      modulo: MODULE_CODE,
      enabled: draft.enabled === true,
      codice_agente_mexal: code || null,
    };

    const existing = rows.find((row) => row.utente_id === user.id);
    const request = existing
      ? supabase.from("integrazioni_utenti").update(payload).eq("id", existing.id)
      : supabase.from("integrazioni_utenti").insert(payload);

    const { error } = await request;
    setSavingId(null);

    if (error) return alert(error.message);

    await loadData();
    alert("Accesso Gestione Ordini salvato.");
  }

  if (loading) {
    return <div className="panel settings-panel"><p>Caricamento accessi ordini...</p></div>;
  }

  return (
    <div className="panel settings-panel">
      <div className="panel-header">
        <div>
          <h3>Accessi Gestione Ordini</h3>
          <p>{enabledCount} utenti abilitati</p>
        </div>
      </div>

      <div className="settings-list">
        {users.map((user) => {
          const draft = drafts[user.id] || { enabled: false, codice_agente_mexal: "" };
          const fullName = `${user.nome || ""} ${user.cognome || ""}`.trim() || user.email || "Utente";
          const valid = !draft.enabled || isValidAgentCode(draft.codice_agente_mexal);

          return (
            <div className="settings-row orders-access-row" key={user.id}>
              <div>
                <strong>{fullName}</strong>
                <span>{user.email || "Email non disponibile"}</span>
                <span>Ruolo: {user.ruoli?.nome || "Nessun ruolo"}</span>
              </div>

              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={!canManage}
                  onChange={(event) => updateDraft(user.id, "enabled", event.target.checked)}
                />
                Abilitato
              </label>

              <label>
                Codice agente Mexal
                <input
                  type="text"
                  value={draft.codice_agente_mexal}
                  disabled={!canManage}
                  placeholder="602.00000"
                  onChange={(event) => updateDraft(user.id, "codice_agente_mexal", event.target.value)}
                  style={{ borderColor: valid ? undefined : "#dc2626" }}
                />
              </label>

              <div className="config-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={!canManage || savingId === user.id}
                  onClick={() => saveUser(user)}
                >
                  <Save size={16} />
                  {savingId === user.id ? "Salvataggio..." : "Salva"}
                </button>
              </div>
            </div>
          );
        })}

        {users.length === 0 && <p>Nessun utente trovato.</p>}
      </div>
    </div>
  );
}

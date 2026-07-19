import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const MODULE_CODE = "gestione_ordini";

const ORDER_ROLES = [
  {
    value: "agente",
    label: "Agente",
    description:
      "Visualizza solo clienti e ordini del proprio codice agente Mexal.",
  },
  {
    value: "area_manager",
    label: "Area Manager",
    description:
      "Visualizza clienti e ordini degli agenti selezionati.",
  },
  {
    value: "backoffice",
    label: "Backoffice",
    description:
      "Visualizza e modifica tutti gli agenti, i clienti, i prodotti e gli ordini.",
  },
];

const cardStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 1.2fr) minmax(160px, 0.8fr) minmax(240px, 1fr) auto",
  gap: "20px",
  alignItems: "start",
  padding: "22px",
  border: "1px solid #e5e7eb",
  borderRadius: "16px",
  background: "#ffffff",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.04)",
};

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  fontWeight: 600,
  color: "#1f2937",
};

const inputStyle = {
  width: "100%",
  minHeight: "42px",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  background: "#ffffff",
  color: "#111827",
};

const mutedStyle = {
  display: "block",
  marginTop: "4px",
  color: "#64748b",
  fontSize: "13px",
  lineHeight: 1.45,
  fontWeight: 400,
};

const saveButtonStyle = {
  minWidth: "118px",
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  border: "none",
  borderRadius: "10px",
  padding: "10px 16px",
  background: "#0f5ea8",
  color: "#ffffff",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function normalizeAgentCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidAgentCode(value) {
  return /^602\.\d{5}$/.test(normalizeAgentCode(value));
}

function normalizeManagedAgents(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,;]+/);

  return [
    ...new Set(
      source
        .map((item) => normalizeAgentCode(item))
        .filter(Boolean)
    ),
  ];
}

function managedAgentsToText(value) {
  return normalizeManagedAgents(value).join("\n");
}

function validateManagedAgents(value) {
  const codes = normalizeManagedAgents(value);

  return {
    codes,
    valid: codes.length > 0 && codes.every(isValidAgentCode),
  };
}

function createEmptyDraft() {
  return {
    enabled: false,
    ruolo_ordini: "agente",
    codice_agente_mexal: "",
    agenti_gestiti: "",
  };
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
        .select("id,auth_user_id,nome,cognome,email,attivo,ruoli(id,nome,livello)")
        .order("nome", { ascending: true }),
      supabase
        .from("integrazioni_utenti")
        .select(
          "id,utente_id,modulo,enabled,codice_agente_mexal,ruolo_ordini,agenti_gestiti"
        )
        .eq("modulo", MODULE_CODE),
    ]);

    if (usersRes.error) {
      console.error("Errore utenti:", usersRes.error);
    }

    if (integrationsRes.error) {
      console.error("Errore accessi ordini:", integrationsRes.error);
    }

    const nextUsers = usersRes.data || [];
    const nextRows = integrationsRes.data || [];
    const nextDrafts = {};

    nextUsers.forEach((user) => {
      const access = nextRows.find((row) => row.utente_id === user.id);

      nextDrafts[user.id] = {
        enabled: access?.enabled === true,
        ruolo_ordini: access?.ruolo_ordini || "agente",
        codice_agente_mexal: access?.codice_agente_mexal || "",
        agenti_gestiti: managedAgentsToText(access?.agenti_gestiti || []),
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
    setDrafts((current) => {
      const existing = current[userId] || createEmptyDraft();
      const next = {
        ...existing,
        [field]: value,
      };

      if (field === "ruolo_ordini") {
        if (value === "agente") {
          next.agenti_gestiti = "";
        }

        if (value === "area_manager") {
          next.codice_agente_mexal = "";
        }

        if (value === "backoffice") {
          next.codice_agente_mexal = "";
          next.agenti_gestiti = "";
        }
      }

      return {
        ...current,
        [userId]: next,
      };
    });
  }

  function getValidation(draft) {
    if (!draft.enabled) {
      return {
        valid: true,
        message: "",
      };
    }

    if (draft.ruolo_ordini === "agente") {
      const code = normalizeAgentCode(draft.codice_agente_mexal);

      return {
        valid: isValidAgentCode(code),
        message: "Inserisci un codice agente Mexal nel formato 602.00000.",
      };
    }

    if (draft.ruolo_ordini === "area_manager") {
      const result = validateManagedAgents(draft.agenti_gestiti);

      return {
        valid: result.valid,
        message:
          "Inserisci almeno un codice agente valido, uno per riga, nel formato 602.00000.",
      };
    }

    return {
      valid: true,
      message: "",
    };
  }

  async function saveUser(user) {
    if (!canManage) {
      alert("Non hai i permessi per modificare gli accessi.");
      return;
    }

    if (!user.auth_user_id) {
      alert("Impossibile salvare l'accesso Ordini: l'utente non è collegato a un account di autenticazione.");
      return;
    }

    const draft = drafts[user.id] || createEmptyDraft();
    const validation = getValidation(draft);

    if (!validation.valid) {
      alert(validation.message);
      return;
    }

    const role = draft.ruolo_ordini || "agente";

    const agentCode =
      draft.enabled && role === "agente"
        ? normalizeAgentCode(draft.codice_agente_mexal)
        : null;

    const managedAgents =
      draft.enabled && role === "area_manager"
        ? normalizeManagedAgents(draft.agenti_gestiti)
        : [];

    setSavingId(user.id);

    const payload = {
      utente_id: user.id,
      modulo: MODULE_CODE,
      enabled: draft.enabled === true,
      ruolo_ordini: role,
      codice_agente_mexal: agentCode,
      agenti_gestiti: managedAgents,
    };

    const existing = rows.find((row) => row.utente_id === user.id);

    const request = existing
      ? supabase
          .from("integrazioni_utenti")
          .update(payload)
          .eq("id", existing.id)
          .eq("utente_id", user.id)
          .select("id,utente_id,enabled,ruolo_ordini")
      : supabase.from("integrazioni_utenti").insert(payload).select("id,utente_id,enabled,ruolo_ordini");

    const { data, error } = await request;

    setSavingId(null);

    if (error || !data?.length || data[0].utente_id !== user.id) {
      console.error("Errore salvataggio accesso ordini:", error);
      alert(error?.message || "Nessun accesso Ordini è stato aggiornato per l'utente selezionato.");
      return;
    }

    await loadData();
    alert("Accesso Gestione Ordini salvato.");
  }

  if (loading) {
    return (
      <div className="panel settings-panel">
        <p>Caricamento accessi ordini...</p>
      </div>
    );
  }

  return (
    <div className="panel settings-panel">
      <div className="panel-header">
        <div>
          <h3>Accessi Gestione Ordini</h3>
          <p>{enabledCount} utenti abilitati</p>
        </div>
      </div>

      <div
        className="settings-list"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {users.map((user) => {
          const draft = drafts[user.id] || createEmptyDraft();
          const fullName =
            `${user.nome || ""} ${user.cognome || ""}`.trim() ||
            user.email ||
            "Utente";

          const validation = getValidation(draft);

          const selectedRole = ORDER_ROLES.find(
            (item) => item.value === draft.ruolo_ordini
          );

          return (
            <div
              key={user.id}
              className="orders-access-card"
              style={cardStyle}
            >
              <div>
                <strong
                  style={{
                    display: "block",
                    fontSize: "16px",
                    color: "#111827",
                    marginBottom: "6px",
                  }}
                >
                  {fullName}
                </strong>

                <span style={mutedStyle}>
                  {user.email || "Email non disponibile"}
                </span>

                <span style={mutedStyle}>
                  Ruolo Workspace: {user.ruoli?.nome || "Nessun ruolo"}
                </span>

                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "14px",
                    fontWeight: 700,
                    color: "#1f2937",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    disabled={!canManage}
                    onChange={(event) =>
                      updateDraft(user.id, "enabled", event.target.checked)
                    }
                  />
                  Abilitato
                </label>
              </div>

              <label style={labelStyle}>
                Profilo Gestione Ordini

                <select
                  value={draft.ruolo_ordini}
                  disabled={!canManage || !draft.enabled}
                  onChange={(event) =>
                    updateDraft(user.id, "ruolo_ordini", event.target.value)
                  }
                  style={inputStyle}
                >
                  {ORDER_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>

                <small style={mutedStyle}>
                  {selectedRole?.description || ""}
                </small>
              </label>

              <div>
                {draft.ruolo_ordini === "agente" && (
                  <label style={labelStyle}>
                    Codice agente Mexal

                    <input
                      type="text"
                      value={draft.codice_agente_mexal}
                      disabled={!canManage || !draft.enabled}
                      placeholder="602.00000"
                      onChange={(event) =>
                        updateDraft(
                          user.id,
                          "codice_agente_mexal",
                          event.target.value
                        )
                      }
                      style={{
                        ...inputStyle,
                        borderColor:
                          draft.enabled && !validation.valid
                            ? "#dc2626"
                            : "#cbd5e1",
                      }}
                    />
                  </label>
                )}

                {draft.ruolo_ordini === "area_manager" && (
                  <label style={labelStyle}>
                    Agenti gestiti

                    <textarea
                      rows="5"
                      value={draft.agenti_gestiti}
                      disabled={!canManage || !draft.enabled}
                      placeholder={"602.00001\n602.00002\n602.00003"}
                      onChange={(event) =>
                        updateDraft(
                          user.id,
                          "agenti_gestiti",
                          event.target.value
                        )
                      }
                      style={{
                        ...inputStyle,
                        minHeight: "120px",
                        resize: "vertical",
                        borderColor:
                          draft.enabled && !validation.valid
                            ? "#dc2626"
                            : "#cbd5e1",
                      }}
                    />

                    <small style={mutedStyle}>
                      Inserisci un codice per riga. Sono accettati anche codici
                      separati da virgola o punto e virgola.
                    </small>
                  </label>
                )}

                {draft.ruolo_ordini === "backoffice" && (
                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <strong
                      style={{
                        display: "block",
                        color: "#111827",
                        marginBottom: "6px",
                      }}
                    >
                      Accesso completo al modulo
                    </strong>

                    <span style={mutedStyle}>
                      Può visualizzare e modificare tutti gli agenti, i clienti,
                      i prodotti e gli ordini.
                    </span>
                  </div>
                )}

                {!validation.valid && draft.enabled && (
                  <div
                    style={{
                      color: "#dc2626",
                      fontSize: "13px",
                      marginTop: "8px",
                    }}
                  >
                    {validation.message}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "flex-start",
                  minWidth: "120px",
                }}
              >
                <button
                  type="button"
                  disabled={
                    !canManage ||
                    savingId === user.id ||
                    (draft.enabled && !validation.valid)
                  }
                  onClick={() => saveUser(user)}
                  style={{
                    ...saveButtonStyle,
                    opacity:
                      !canManage ||
                      savingId === user.id ||
                      (draft.enabled && !validation.valid)
                        ? 0.55
                        : 1,
                    cursor:
                      !canManage ||
                      savingId === user.id ||
                      (draft.enabled && !validation.valid)
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  <Save size={17} />
                  {savingId === user.id ? "Salvataggio..." : "Salva"}
                </button>
              </div>
            </div>
          );
        })}

        {users.length === 0 && <p>Nessun utente trovato.</p>}
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .orders-access-card {
            grid-template-columns: 1fr 1fr !important;
          }
        }

        @media (max-width: 700px) {
          .orders-access-card {
            grid-template-columns: 1fr !important;
          }

          .orders-access-card button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

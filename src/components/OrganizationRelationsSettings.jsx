import { useEffect, useMemo, useState } from "react";
import { Save, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function userName(user) {
  return `${user?.nome || ""} ${user?.cognome || ""}`.trim() || user?.email || "Utente";
}

function agentName(agent) {
  return `${agent?.codice || ""} · ${`${agent?.nome || ""} ${agent?.cognome || ""}`.trim()}`.trim();
}

export default function OrganizationRelationsSettings({ canManage }) {
  const [users, setUsers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [usersResult, agentsResult] = await Promise.all([
      supabase.from("utenti").select("id,nome,cognome,email,attivo,mexal_agente_id").order("nome"),
      supabase.from("mexal_agenti").select("id,codice,nome,cognome,attivo_mexal,workspace_utente_id,responsabile_utente_id").order("cognome"),
    ]);
    if (usersResult.error || agentsResult.error) {
      setMessage(usersResult.error?.message || agentsResult.error?.message || "Caricamento non riuscito.");
      return;
    }
    setUsers(usersResult.data || []);
    setAgents(agentsResult.data || []);
  }

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => `${userName(user)} ${user.email || ""}`.toLowerCase().includes(term));
  }, [search, users]);

  async function linkAgent(user, agentId) {
    setSaving(user.id);
    setMessage("");
    const current = agents.find((agent) => agent.workspace_utente_id === user.id);
    if (current && current.id !== agentId) {
      const result = await supabase.from("mexal_agenti").update({ workspace_utente_id: null }).eq("id", current.id);
      if (result.error) {
        setSaving("");
        return setMessage(result.error.message);
      }
    }
    if (agentId) {
      const result = await supabase.from("mexal_agenti").update({ workspace_utente_id: user.id }).eq("id", agentId);
      if (result.error) {
        setSaving("");
        return setMessage(result.error.message);
      }
    }
    await load();
    setSaving("");
  }

  async function saveManagedAgents(user, selectedIds) {
    setSaving(user.id);
    setMessage("");
    const currentlyManaged = agents.filter((agent) => agent.responsabile_utente_id === user.id);
    const removeIds = currentlyManaged.filter((agent) => !selectedIds.includes(agent.id)).map((agent) => agent.id);
    if (removeIds.length) {
      const result = await supabase.from("mexal_agenti").update({ responsabile_utente_id: null }).in("id", removeIds);
      if (result.error) {
        setSaving("");
        return setMessage(result.error.message);
      }
    }
    if (selectedIds.length) {
      const result = await supabase.from("mexal_agenti").update({ responsabile_utente_id: user.id }).in("id", selectedIds);
      if (result.error) {
        setSaving("");
        return setMessage(result.error.message);
      }
    }
    await load();
    setSaving("");
    setMessage(`Relazioni di ${userName(user)} salvate.`);
  }

  return (
    <div className="panel settings-panel">
      <div className="panel-header">
        <div>
          <h3>Relazioni agenti e responsabili</h3>
          <p>Gli agenti e i relativi codici provengono esclusivamente da Mexal. Tutte le associazioni sono facoltative.</p>
        </div>
      </div>
      <label className="mexal-search-control">
        <Search size={18} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca utente..." />
      </label>
      {message && <p className="muted">{message}</p>}
      <div className="settings-list">
        {filteredUsers.map((user) => {
          const linkedAgent = agents.find((agent) => agent.workspace_utente_id === user.id);
          const managedIds = agents.filter((agent) => agent.responsabile_utente_id === user.id).map((agent) => agent.id);
          return (
            <OrganizationRow
              key={`${user.id}:${managedIds.join(",")}`}
              user={user}
              agents={agents}
              linkedAgentId={linkedAgent?.id || ""}
              initialManagedIds={managedIds}
              disabled={!canManage || saving === user.id}
              onLink={(agentId) => linkAgent(user, agentId)}
              onSave={(ids) => saveManagedAgents(user, ids)}
            />
          );
        })}
      </div>
    </div>
  );
}

function OrganizationRow({ user, agents, linkedAgentId, initialManagedIds, disabled, onLink, onSave }) {
  const [managedIds, setManagedIds] = useState(initialManagedIds);

  function toggle(id) {
    setManagedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  return (
    <div className="settings-row" style={{ alignItems: "start" }}>
      <div>
        <strong>{userName(user)}</strong>
        <span>{user.email || "Email non disponibile"}</span>
        <label>
          Agente importato collegato
          <select disabled={disabled} value={linkedAgentId} onChange={(event) => onLink(event.target.value)}>
            <option value="">Nessun agente</option>
            {agents.filter((agent) => agent.attivo_mexal !== false && (!agent.workspace_utente_id || agent.workspace_utente_id === user.id)).map((agent) => (
              <option key={agent.id} value={agent.id}>{agentName(agent)}</option>
            ))}
          </select>
        </label>
        <div className="checkbox-group scrollable-check-group">
          <strong>Agenti coordinati</strong>
          {agents.filter((agent) => agent.attivo_mexal !== false && agent.workspace_utente_id !== user.id).map((agent) => (
            <label key={agent.id}>
              <input type="checkbox" disabled={disabled} checked={managedIds.includes(agent.id)} onChange={() => toggle(agent.id)} />
              {agentName(agent)}
            </label>
          ))}
          {!agents.length && <p>Sincronizza prima gli agenti da Mexal.</p>}
        </div>
      </div>
      <button type="button" className="primary-action" disabled={disabled} onClick={() => onSave(managedIds)}>
        <Save size={16} /> Salva relazioni
      </button>
    </div>
  );
}

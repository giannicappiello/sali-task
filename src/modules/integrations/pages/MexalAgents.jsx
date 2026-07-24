import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, KeyRound, RefreshCw, Search, ShieldCheck, UserRoundCog } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { getAccessToken } from "../services/mexalSyncService";

async function post(body) {
  const token = await getAccessToken();
  const response = await fetch("/api/mexal/automation", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || raw || `Operazione non riuscita (HTTP ${response.status}).`);
  }
  return payload;
}

export default function MexalAgents() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [users, setUsers] = useState([]);
  const [runs, setRuns] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [agentsResult, usersResult, runsResult] = await Promise.all([
      supabase.from("mexal_agenti").select("*,responsabile:responsabile_utente_id(id,nome,cognome),workspace:workspace_utente_id(id,nome,cognome,email,attivo)").order("cognome").order("nome"),
      supabase.from("utenti").select("id,nome,cognome,email,attivo").eq("attivo", true).order("nome"),
      supabase.from("mexal_sync_runs").select("*").eq("sync_type", "agents").order("started_at", { ascending: false }).limit(20),
    ]);
    setAgents(agentsResult.data || []);
    setUsers(usersResult.data || []);
    setRuns(runsResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeAgentsRun = runs.find((run) => run.status === "running") || null;

  useEffect(() => {
    if (busy !== "sync") return undefined;
    const timer = window.setInterval(async () => {
      const result = await supabase
        .from("mexal_sync_runs")
        .select("*")
        .eq("sync_type", "agents")
        .order("started_at", { ascending: false })
        .limit(20);
      if (!result.error) setRuns(result.data || []);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [busy]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return agents;
    return agents.filter((item) => [item.codice, item.nome, item.cognome, item.email, item.telefono].some((value) => String(value || "").toLowerCase().includes(term)));
  }, [agents, search]);

  async function syncAgents() {
    setBusy("sync");
    setMessage(null);
    try {
      const result = await post({ action: "run_now", syncType: "agents", origin: "integrations" });
      setMessage({ type: "success", text: `Agenti sincronizzati: ${result.letti_mexal || 0}. Inseriti ${result.inseriti || 0}, aggiornati ${result.aggiornati || 0}.` });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  async function stopAgentsSync() {
    if (!activeAgentsRun || !window.confirm("Arrestare la sincronizzazione agenti in corso?")) return;
    setBusy("stop");
    setMessage(null);
    try {
      await post({ action: "stop", runId: activeAgentsRun.id });
      setMessage({ type: "success", text: "Sincronizzazione agenti arrestata." });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  async function setResponsible(agentId, responsabileUtenteId) {
    setBusy(agentId);
    setMessage(null);
    try {
      await post({ action: "agents_access", accessAction: "set_responsible", agentId, responsabileUtenteId: responsabileUtenteId || null });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  async function activate(agent) {
    const password = window.prompt(agent.workspace_utente_id ? "Inserisci la nuova password amministrativa per questo agente:" : "Crea la password iniziale dell'agente (minimo 8 caratteri):");
    if (password == null) return;
    const confirmation = window.prompt("Conferma la password:");
    if (password !== confirmation) return setMessage({ type: "error", text: "Le password non coincidono." });
    setBusy(agent.id);
    setMessage(null);
    try {
      const result = await post({ action: "agents_access", accessAction: "activate", agentId: agent.id, password });
      setAgents((current) => current.map((item) => item.id === agent.id ? { ...item, ...(result.agent || {}), accesso_workspace_attivo: true } : item));
      setMessage({ type: "success", text: "Accesso Workspace attivato. Autorizzazioni e reparti sono gestibili dalla sezione Team." });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  async function disable(agent) {
    if (!window.confirm(`Disattivare l'accesso Workspace di ${agent.nome || ""} ${agent.cognome || ""}?`)) return;
    setBusy(agent.id);
    setMessage(null);
    try {
      await post({ action: "agents_access", accessAction: "disable", agentId: agent.id });
      setAgents((current) => current.map((item) => item.id === agent.id ? { ...item, accesso_workspace_attivo: false } : item));
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  return <div className="mexal-page">
    <button type="button" className="integrations-back-button" onClick={() => navigate("/integrations/mexal")}><ArrowLeft size={18} /> Mexal ERP</button>
    <section className="mexal-hero"><div className="mexal-hero-main"><div className="mexal-logo"><UserRoundCog size={30} /></div><div><div className="mexal-title-line"><h1>Agenti Mexal</h1></div><p>Sincronizzazione Mexal → Workspace, responsabili associati e attivazione degli accessi.</p></div></div></section>
    {message && <div className={`mexal-alert alert-${message.type}`}><span>{message.text}</span><button type="button" onClick={() => setMessage(null)}>×</button></div>}
    <section className="mexal-kpi-grid"><div className="mexal-kpi"><span>Agenti importati</span><strong>{agents.length}</strong></div><div className="mexal-kpi"><span>Accessi attivi</span><strong>{agents.filter((item) => item.accesso_workspace_attivo).length}</strong></div><div className="mexal-kpi"><span>Con responsabile</span><strong>{agents.filter((item) => item.responsabile_utente_id).length}</strong></div><div className="mexal-kpi"><span>Ultima sincronizzazione</span><strong>{runs[0]?.started_at ? new Date(runs[0].started_at).toLocaleString("it-IT") : "Mai"}</strong></div></section>
    <section className="mexal-table-panel mexal-agents-panel"><div className="mexal-section-heading"><div><h3>Elenco agenti</h3><p>Nome, cognome, codice, email e telefono vengono aggiornati da Mexal. Responsabile e accesso restano sotto controllo Workspace.</p></div></div>
      <div className="mexal-toolbar">
        <label className="mexal-search-control"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca in tutti i campi..." /></label>
        <button className="primary-action" type="button" disabled={busy === "sync" || busy === "stop"} onClick={syncAgents}>{busy === "sync" ? <RefreshCw className="spin" size={18} /> : <RefreshCw size={18} />} Sincronizza agenti</button>
        <button className="mexal-danger-action" type="button" disabled={!activeAgentsRun || busy === "stop"} onClick={stopAgentsSync}>{busy === "stop" ? "Arresto..." : "Arresta sincronizzazione"}</button>
      </div>
      {loading ? <p>Caricamento agenti...</p> : <div className="mexal-table-scroll"><table className="mexal-history-table"><thead><tr><th>Codice</th><th>Agente</th><th>Email</th><th>Telefono</th><th>Responsabile associato</th><th>Accesso Workspace</th><th>Ultimo sync</th><th>Azioni</th></tr></thead><tbody>{filtered.length === 0 ? <tr><td colSpan="8">Nessun agente trovato.</td></tr> : filtered.map((agent) => <tr key={agent.id}><td><strong>{agent.codice}</strong></td><td>{`${agent.nome || ""} ${agent.cognome || ""}`.trim() || "—"}</td><td>{agent.email || "—"}</td><td>{agent.telefono || "—"}</td><td><select disabled={busy === agent.id} value={agent.responsabile_utente_id || ""} onChange={(event) => setResponsible(agent.id, event.target.value)}><option value="">Nessun responsabile</option>{users.filter((user) => user.id !== agent.workspace_utente_id).map((user) => <option key={user.id} value={user.id}>{`${user.nome || ""} ${user.cognome || ""}`.trim() || user.email}</option>)}</select></td><td>{agent.accesso_workspace_attivo ? <span className="orders-status inviato-mexal">ATTIVO</span> : <span className="orders-status bozza">NON ATTIVO</span>}</td><td>{agent.ultimo_sync_mexal ? new Date(agent.ultimo_sync_mexal).toLocaleString("it-IT") : "—"}</td><td><div className="mexal-row-actions">{agent.accesso_workspace_attivo ? <><button className="secondary-action" type="button" disabled={busy === agent.id} onClick={() => activate(agent)}><KeyRound size={16} /> Cambia password</button><button className="mexal-danger-action" type="button" disabled={busy === agent.id} onClick={() => disable(agent)}>Disattiva</button></> : <button className="primary-action" type="button" disabled={busy === agent.id || !agent.email} onClick={() => activate(agent)}><ShieldCheck size={16} /> Attiva accesso</button>}</div></td></tr>)}</tbody></table></div>}
    </section>
    <section className="mexal-table-panel"><div className="mexal-section-heading"><div><h3>Storico sincronizzazioni agenti</h3><p>Le esecuzioni manuali e automatiche vengono mantenute in mexal_sync_runs.</p></div></div><table className="mexal-history-table"><thead><tr><th>Inizio</th><th>Fine</th><th>Stato</th><th>Letti</th><th>Inseriti</th><th>Aggiornati</th><th>Errore</th></tr></thead><tbody>{runs.length === 0 ? <tr><td colSpan="7">Nessuna sincronizzazione registrata.</td></tr> : runs.map((run) => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString("it-IT")}</td><td>{run.completed_at ? new Date(run.completed_at).toLocaleString("it-IT") : "—"}</td><td>{run.status}</td><td>{run.processed || 0}</td><td>{run.inserted || 0}</td><td>{run.updated || 0}</td><td>{run.error_message || "—"}</td></tr>)}</tbody></table></section>
  </div>;
}

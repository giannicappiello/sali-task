import { useEffect, useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { supabase as reportSupabase } from "../services/reportSupabase";

const PAGE_SIZE = 250;

function isAdmin(user) {
  return user?.external_role === "admin" || user?.ruolo === "admin";
}

function beautyName(beauty) {
  return `${beauty?.cognome || ""} ${beauty?.nome || ""}`.trim();
}

export default function Clienti({ utente }) {
  const [clients, setClients] = useState([]);
  const [links, setLinks] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
    // Il caricamento viene ripetuto quando cambia l'utente autenticato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utente?.id]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const scopeResult = isAdmin(utente)
        ? { data: null, error: null }
        : await supabase.rpc("visible_mexal_agent_codes");
      if (scopeResult.error) throw scopeResult.error;
      const visibleCodes = scopeResult.data || [];

      if (!isAdmin(utente) && !visibleCodes.length) {
        setClients([]);
        setLinks([]);
        setBeauty([]);
        return;
      }

      let clientQuery = supabase
        .from("ordini_clienti_cache")
        .select("codice_cliente,ragione_sociale,localita,provincia,partita_iva,telefono,email,codice_agente_mexal")
        .eq("attivo_mexal", true)
        .order("ragione_sociale")
        .limit(PAGE_SIZE);
      if (!isAdmin(utente)) clientQuery = clientQuery.in("codice_agente_mexal", visibleCodes);

      const [clientsResult, linksResult, beautyResult] = await Promise.all([
        clientQuery,
        supabase.from("beauty_clienti_mexal").select("*"),
        reportSupabase.from("beauty_consultant").select("id,nome,cognome,email").eq("attivo", true).order("cognome"),
      ]);
      if (clientsResult.error || linksResult.error || beautyResult.error) {
        throw clientsResult.error || linksResult.error || beautyResult.error;
      }
      setClients(clientsResult.data || []);
      setLinks(linksResult.data || []);
      setBeauty(beautyResult.data || []);
    } catch (loadError) {
      setError(loadError.message || "Impossibile caricare i clienti.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((client) => [
      client.codice_cliente,
      client.ragione_sociale,
      client.localita,
      client.provincia,
      client.partita_iva,
      client.codice_agente_mexal,
    ].some((value) => String(value || "").toLowerCase().includes(term)));
  }, [clients, search]);

  function linkFor(code) {
    return links.find((link) => link.codice_cliente === code);
  }

  async function assignBeauty(client, beautyId) {
    setSaving(client.codice_cliente);
    setError("");
    const result = await supabase.from("beauty_clienti_mexal").upsert({
      codice_cliente: client.codice_cliente,
      beauty_external_id: beautyId || null,
      aggiornato_il: new Date().toISOString(),
    }, { onConflict: "codice_cliente" });
    if (result.error) setError(result.error.message);
    else await load();
    setSaving("");
  }

  return (
    <div>
      <div className="pharmacy-module-header">
        <div>
          <h2>Clienti</h2>
          <p>Anagrafica unica importata da Mexal, filtrata automaticamente in base all'utente.</p>
        </div>
        <UsersRound size={28} />
      </div>

      <label className="mexal-search-control" style={{ marginBottom: 18 }}>
        <Search size={18} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca codice, ragione sociale, località, provincia, P. IVA o agente..." />
      </label>

      {error && <div className="orders-alert orders-alert-error">{error}</div>}
      {loading && <p>Caricamento clienti...</p>}

      {!loading && (
        <div className="mexal-table-scroll">
          <table className="mexal-history-table">
            <thead>
              <tr><th>Codice</th><th>Ragione sociale</th><th>Località</th><th>Provincia</th><th>Agente</th><th>Beauty associata</th></tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.codice_cliente}>
                  <td><strong>{client.codice_cliente}</strong></td>
                  <td>{client.ragione_sociale}</td>
                  <td>{client.localita || "—"}</td>
                  <td>{client.provincia || "—"}</td>
                  <td>{client.codice_agente_mexal || "—"}</td>
                  <td>
                    <select
                      value={linkFor(client.codice_cliente)?.beauty_external_id || ""}
                      disabled={!isAdmin(utente) || saving === client.codice_cliente}
                      onChange={(event) => assignBeauty(client, event.target.value)}
                    >
                      <option value="">Nessuna beauty</option>
                      {beauty.map((item) => <option key={item.id} value={item.id}>{beautyName(item) || item.email}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan="6">Nessun cliente disponibile.</td></tr>}
            </tbody>
          </table>
          {clients.length === PAGE_SIZE && <p>Visualizzati i primi {PAGE_SIZE} clienti. Usa la ricerca per restringere l'elenco.</p>}
        </div>
      )}
    </div>
  );
}

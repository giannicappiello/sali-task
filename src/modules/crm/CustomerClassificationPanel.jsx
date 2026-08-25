import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Pencil, RefreshCw, RotateCcw, Search, SlidersHorizontal, UsersRound } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import "./customer-classification.css";

const PAGE_SIZE = 50;
const AREA_OPTIONS = [
  ["conto_terzi", "Conto Terzi"],
  ["b2b", "B2B"],
  ["online", "Online"],
];

function areaLabel(value) {
  return AREA_OPTIONS.find(([area]) => area === value)?.[1] || value || "—";
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("it-IT") : "—";
}

export default function CustomerClassificationPanel() {
  const { isAdminUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState(() => searchParams.get("classification_search") || "");
  const [area, setArea] = useState(() => searchParams.get("classification_area") || "");
  const [agent, setAgent] = useState(() => searchParams.get("classification_agent") || "");
  const [mode, setMode] = useState(() => searchParams.get("classification_mode") || "");
  const [summary, setSummary] = useState({ total: 0, conto_terzi: 0, b2b: 0, online: 0, overrides: 0 });
  const [selected, setSelected] = useState([]);
  const [bulkArea, setBulkArea] = useState("b2b");
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!isAdminUser) return;
    setLoading(true);
    setError("");
    const applyFilters = (source, { targetArea = area, targetMode = mode } = {}) => {
      let filtered = source;
      if (targetArea) filtered = filtered.eq("area_crm", targetArea);
      if (targetMode === "automatico") filtered = filtered.is("area_override", null);
      if (targetMode === "manuale") filtered = filtered.not("area_override", "is", null);
      if (agent.trim()) filtered = filtered.ilike("agente_classificazione", `%${agent.trim().replaceAll(",", " ")}%`);
      if (search.trim()) {
        const term = search.trim().replaceAll(",", " ");
        filtered = filtered.or(`codice_cliente.ilike.%${term}%,ragione_sociale.ilike.%${term}%`);
      }
      return filtered;
    };
    let query = supabase
      .from("crm_customer_classification_catalog")
      .select("codice_cliente,ragione_sociale,codice_agente_mexal,agente_classificazione,area_automatica,area_override,area_crm,origine_classificazione,modalita,classificata_il,override_il,override_note,attivo_mexal", { count: "exact" })
      .order("ragione_sociale")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    query = applyFilters(query);
    const countQuery = (targetArea = area, targetMode = mode) => applyFilters(
      supabase.from("crm_customer_classification_catalog").select("codice_cliente", { count: "exact", head: true }),
      { targetArea, targetMode }
    );
    const [rowsResult, totalResult, ...areaResults] = await Promise.all([
      query,
      countQuery(),
      ...AREA_OPTIONS.map(([value]) => countQuery(value)),
      countQuery(area, "manuale"),
    ]);
    const { data, error: loadError, count } = rowsResult;
    const aggregateError = totalResult.error || areaResults.find((result) => result.error)?.error;
    if (loadError) setError(loadError.message);
    else if (aggregateError) setError(aggregateError.message);
    else {
      setRows(data || []);
      setTotal(count || 0);
      setSummary({
        total: totalResult.count || 0,
        ...Object.fromEntries(AREA_OPTIONS.map(([value], index) => [value, areaResults[index]?.count || 0])),
        overrides: areaResults[AREA_OPTIONS.length]?.count || 0,
      });
      setSelected((current) => current.filter((code) => (data || []).some((row) => row.codice_cliente === code)));
    }
    setLoading(false);
  }, [agent, area, isAdminUser, mode, page, search]);

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const values = { classification_search: search, classification_area: area, classification_agent: agent, classification_mode: mode };
      Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
      return next;
    }, { replace: true });
  }, [agent, area, mode, search, setSearchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const allPageSelected = rows.length > 0 && rows.every((row) => selected.includes(row.codice_cliente));
  const datasetSummary = useMemo(() => AREA_OPTIONS.map(([value, label]) => ({
    value,
    label,
    count: summary[value] || 0,
  })), [summary]);

  function toggle(code) {
    setSelected((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }

  function togglePage() {
    setSelected(allPageSelected ? [] : rows.map((row) => row.codice_cliente));
  }

  async function applyOverride(codes, targetArea, overrideNote = "") {
    if (!codes.length) return;
    setBusy("override");
    setError("");
    const { data, error: updateError } = await supabase.rpc("crm_set_customer_area_override", {
      customer_codes: codes,
      target_area: targetArea,
      note: overrideNote || null,
    });
    if (updateError) setError(updateError.message);
    else {
      setMessage(`${data || codes.length} classificazioni aggiornate manualmente.`);
      setSelected([]);
      setEditing(null);
      setNote("");
      await load();
    }
    setBusy("");
  }

  async function restoreAutomatic(codes) {
    if (!codes.length) return;
    setBusy("restore");
    setError("");
    const { data, error: updateError } = await supabase.rpc("crm_clear_customer_area_override", { customer_codes: codes });
    if (updateError) setError(updateError.message);
    else {
      setMessage(`${data || codes.length} classificazioni ripristinate dalla regola agente.`);
      setSelected([]);
      await load();
    }
    setBusy("");
  }

  if (!isAdminUser) return null;

  return (
    <section className="crm-panel crm-classification" aria-labelledby="crm-classification-title">
      <div className="crm-toolbar">
        <div>
          <span className="crm-eyebrow"><UsersRound size={16} /> Amministrazione CRM</span>
          <h2 id="crm-classification-title">Classificazione clienti CRM</h2>
          <p>Un’unica anagrafica Workspace/Mexal, allocata per agente con override Admin tracciati.</p>
        </div>
        <button className="secondary-action" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={17} />Aggiorna
        </button>
      </div>

      <div className="crm-classification-kpis" aria-label="Riepilogo intero dataset filtrato">
        <button type="button" className="kpi-card" onClick={() => { setArea(""); setPage(0); }}><div><span>Clienti filtrati</span><strong>{summary.total}</strong><p>intero dataset</p></div></button>
        {datasetSummary.map((item) => <button type="button" className="kpi-card" key={item.value} onClick={() => { setArea(item.value); setPage(0); }}><div><span>{item.label}</span><strong>{item.count}</strong><p>apri elenco filtrato</p></div></button>)}
        <button type="button" className="kpi-card" onClick={() => { setMode("manuale"); setPage(0); }}><div><span>Override</span><strong>{summary.overrides}</strong><p>apri override filtrati</p></div></button>
      </div>

      <div className="crm-filters crm-classification-filters">
        <label><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Codice cliente o ragione sociale" /></label>
        <select aria-label="Filtra per area CRM" value={area} onChange={(event) => { setArea(event.target.value); setPage(0); }}><option value="">Tutte le aree</option>{AREA_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <label><SlidersHorizontal size={17} /><input value={agent} onChange={(event) => { setAgent(event.target.value); setPage(0); }} placeholder="Agente" /></label>
        <select aria-label="Filtra classificazione automatica o manuale" value={mode} onChange={(event) => { setMode(event.target.value); setPage(0); }}><option value="">Automatiche e manuali</option><option value="automatico">Automatiche</option><option value="manuale">Override manuali</option></select>
      </div>

      {selected.length ? <div className="crm-selection-toolbar" role="region" aria-label="Azioni massive">
        <span><CheckSquare size={17} />{selected.length} selezionati</span>
        <select aria-label="Nuova area CRM" value={bulkArea} onChange={(event) => setBulkArea(event.target.value)}>{AREA_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <button className="primary-action" type="button" disabled={Boolean(busy)} onClick={() => void applyOverride(selected, bulkArea)}>Modifica area</button>
        <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={() => void restoreAutomatic(selected)}><RotateCcw size={16} />Ripristina automatico</button>
      </div> : null}

      {message ? <div className="crm-message success" role="status"><span>{message}</span><button type="button" onClick={() => setMessage("")}>Chiudi</button></div> : null}
      {error ? <div className="crm-message error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Riprova</button></div> : null}

      <div className="crm-table-wrap">
        <table className="crm-table crm-classification-table">
          <thead><tr><th><input type="checkbox" aria-label="Seleziona la pagina" checked={allPageSelected} onChange={togglePage} /></th><th>Cliente</th><th>Agente</th><th>Area CRM</th><th>Origine</th><th>Ultima classificazione</th><th>Stato</th><th>Azioni</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.codice_cliente}>
            <td><input type="checkbox" aria-label={`Seleziona ${row.ragione_sociale}`} checked={selected.includes(row.codice_cliente)} onChange={() => toggle(row.codice_cliente)} /></td>
            <td><strong>{row.ragione_sociale}</strong><small>{row.codice_cliente}</small></td>
            <td><strong>{row.agente_classificazione || "Nessun agente"}</strong><small>{row.codice_agente_mexal || "—"}</small></td>
            <td><span className={`status-badge crm-area-${row.area_crm}`}>{areaLabel(row.area_crm)}</span>{row.area_override ? <small>Automatico: {areaLabel(row.area_automatica)}</small> : null}</td>
            <td><span className={`crm-status ${row.modalita}`}>{row.modalita === "manuale" ? "Override manuale" : "agent_rule"}</span>{row.override_note ? <small>{row.override_note}</small> : null}</td>
            <td>{formatDateTime(row.classificata_il)}{row.override_il ? <small>Override: {formatDateTime(row.override_il)}</small> : null}</td>
            <td><span className={`status-badge ${row.attivo_mexal ? "success" : "neutral"}`}>{row.attivo_mexal ? "Attivo" : "Non attivo"}</span></td>
            <td><button className="crm-icon-action" type="button" onClick={() => { setEditing(row); setNote(row.override_note || ""); }}><Pencil size={16} />Modifica</button></td>
          </tr>)}</tbody>
        </table>
        {loading ? <div className="crm-loading">Caricamento classificazioni...</div> : null}
        {!loading && !rows.length ? <div className="crm-empty">Nessun cliente corrisponde ai filtri oppure il popolamento iniziale non è ancora stato eseguito.</div> : null}
      </div>

      <div className="crm-pagination">
        <button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Precedente</button>
        <span>Pagina {page + 1} · {total} clienti</span>
        <button type="button" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((value) => value + 1)}>Successiva</button>
      </div>

      {editing ? <div className="crm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
        <form className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="crm-classification-edit-title" onSubmit={(event) => { event.preventDefault(); void applyOverride([editing.codice_cliente], bulkArea, note); }}>
          <div><span className="crm-eyebrow">Override Admin</span><h3 id="crm-classification-edit-title">Modifica {editing.ragione_sociale}</h3><p>La regola automatica resta memorizzata e può essere ripristinata in qualsiasi momento.</p></div>
          <label>Area CRM<select value={bulkArea} onChange={(event) => setBulkArea(event.target.value)}>{AREA_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Nota override<textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Motivazione opzionale" /></label>
          <div className="crm-modal-actions"><button type="button" onClick={() => setEditing(null)}>Annulla</button><button className="crm-primary" disabled={Boolean(busy)}>Salva override</button></div>
        </form>
      </div> : null}
    </section>
  );
}

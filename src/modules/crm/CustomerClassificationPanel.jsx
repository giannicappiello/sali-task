import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Pencil, RefreshCw, RotateCcw, Search, SlidersHorizontal, UsersRound } from "lucide-react";
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
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [agent, setAgent] = useState("");
  const [mode, setMode] = useState("");
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
    let query = supabase
      .from("crm_customer_classification_catalog")
      .select("codice_cliente,ragione_sociale,codice_agente_mexal,agente_classificazione,area_automatica,area_override,area_crm,origine_classificazione,modalita,classificata_il,override_il,override_note,attivo_mexal", { count: "exact" })
      .order("ragione_sociale")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (area) query = query.eq("area_crm", area);
    if (mode === "automatico") query = query.is("area_override", null);
    if (mode === "manuale") query = query.not("area_override", "is", null);
    if (agent.trim()) query = query.ilike("agente_classificazione", `%${agent.trim().replaceAll(",", " ")}%`);
    if (search.trim()) {
      const term = search.trim().replaceAll(",", " ");
      query = query.or(`codice_cliente.ilike.%${term}%,ragione_sociale.ilike.%${term}%`);
    }
    const { data, error: loadError, count } = await query;
    if (loadError) setError(loadError.message);
    else {
      setRows(data || []);
      setTotal(count || 0);
      setSelected((current) => current.filter((code) => (data || []).some((row) => row.codice_cliente === code)));
    }
    setLoading(false);
  }, [agent, area, isAdminUser, mode, page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const allPageSelected = rows.length > 0 && rows.every((row) => selected.includes(row.codice_cliente));
  const pageSummary = useMemo(() => AREA_OPTIONS.map(([value, label]) => ({
    value,
    label,
    count: rows.filter((row) => row.area_crm === value).length,
  })), [rows]);

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

      <div className="crm-classification-kpis" aria-label="Riepilogo pagina corrente">
        <article className="kpi-card"><div><span>Clienti filtrati</span><strong>{total}</strong><p>Pagina {page + 1}</p></div></article>
        {pageSummary.map((item) => <article className="kpi-card" key={item.value}><div><span>{item.label}</span><strong>{item.count}</strong><p>nella pagina corrente</p></div></article>)}
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

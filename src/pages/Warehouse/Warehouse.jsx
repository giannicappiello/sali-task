import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, RefreshCw, Search } from "lucide-react";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { supabase } from "../../lib/supabaseClient";
import { loadWorkspaceWarehouse, warehouseRow, warehouseSummary } from "./warehouseData";
import "./warehouse.css";

const numberFormat = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const costFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const valueFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(value) {
  return value ? new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function stockStatus(row) {
  if (row.available <= 0) return { label: "Non disponibile", tone: "empty" };
  if (row.committed > 0) return { label: "Disponibile con impegni", tone: "committed" };
  return { label: "Disponibile", tone: "available" };
}

export default function Warehouse() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows((await loadWorkspaceWarehouse(supabase)).map(warehouseRow));
    } catch (loadError) {
      setError(loadError?.message || "Magazzino Workspace non disponibile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = useMemo(() => warehouseSummary(rows), [rows]);
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("it-IT");
    return rows.filter((row) => {
      if (text && !`${row.codice_articolo || ""} ${row.descrizione || ""}`.toLocaleLowerCase("it-IT").includes(text)) return false;
      if (filter === "available" && row.available <= 0) return false;
      if (filter === "empty" && row.available > 0) return false;
      if (filter === "committed" && row.committed <= 0) return false;
      if (filter === "unvalued" && row.unitCost > 0) return false;
      return true;
    });
  }, [filter, query, rows]);

  return (
    <ModuleContainerLayout icon={Boxes} eyebrow="Modulo Workspace" title="Magazzino" description="Giacenze, disponibilità e valorizzazione economica registrate nel database Workspace." backFallback="/home">
      <section className="warehouse-actions" aria-label="Azioni magazzino">
        <div><strong>Dati Workspace</strong><span>Ultimo aggiornamento: {formatDate(summary.lastSync)}</span></div>
        <button type="button" onClick={load} disabled={loading}><RefreshCw size={17} className={loading ? "warehouse-spin" : ""} />Aggiorna</button>
      </section>

      <section className="warehouse-kpis" aria-label="Riepilogo magazzino">
        <article><span>Articoli</span><strong>{summary.articles}</strong><small>{summary.availableArticles} disponibili</small></article>
        <article><span>Articoli valorizzati</span><strong>{summary.valuedArticles}</strong><small>{summary.articles - summary.valuedArticles} senza costo</small></article>
        <article><span>Totale magazzino</span><strong>{valueFormat.format(summary.stockValue)}</strong><small>Prezzo unitario × giacenza</small></article>
        <article><span>Valore disponibile</span><strong>{valueFormat.format(summary.availableValue)}</strong><small>Costo ultimo × disponibilità</small></article>
      </section>

      <section className="warehouse-search-card">
        <label><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca per codice o descrizione..." /></label>
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtra stato magazzino">
          <option value="all">Tutti gli articoli</option>
          <option value="available">Disponibili</option>
          <option value="committed">Con impegni</option>
          <option value="empty">Non disponibili</option>
          <option value="unvalued">Costo non valorizzato</option>
        </select>
      </section>

      {error ? <div className="warehouse-message error" role="alert">{error}</div> : null}
      <section className="warehouse-table-card" aria-label="Giacenze Workspace">
        <header><div><strong>Giacenze Workspace</strong><span>{filtered.length} risultati</span></div><small>I valori economici utilizzano il costo ultimo Mexal salvato in Workspace.</small></header>
        {loading ? <div className="warehouse-message">Caricamento giacenze...</div> : null}
        {!loading && !error && filtered.length === 0 ? <div className="warehouse-message">Nessuna giacenza corrisponde ai filtri.</div> : null}
        {!loading && !error && filtered.length > 0 ? <div className="warehouse-table-scroll"><table><thead><tr><th>Articolo</th><th>UDM</th><th>Giacenza</th><th>Impegnato</th><th>Disponibile</th><th>Prezzo unitario<br /><small>(costo ultimo)</small></th><th>Totale</th><th>Totale disponibile</th><th>Stato</th><th>Aggiornato</th></tr></thead><tbody>{filtered.map((row) => { const status = stockStatus(row); return <tr key={row.codice_articolo}><td><strong>{row.codice_articolo}</strong><small>{row.descrizione || "Descrizione non disponibile"}</small></td><td>{row.unita_misura || "—"}</td><td>{numberFormat.format(row.onHand)}</td><td>{numberFormat.format(row.committed)}</td><td><strong>{numberFormat.format(row.available)}</strong></td><td>{row.unitCost > 0 ? costFormat.format(row.unitCost) : <span className="warehouse-missing-cost">Da valorizzare</span>}</td><td><strong>{valueFormat.format(row.stockValue)}</strong></td><td>{valueFormat.format(row.availableValue)}</td><td><span className={`warehouse-status ${status.tone}`}>{status.label}</span></td><td>{formatDate(row.sincronizzato_il)}</td></tr>; })}</tbody></table></div> : null}
      </section>
    </ModuleContainerLayout>
  );
}

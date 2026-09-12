import { useEffect, useMemo, useState } from "react";
import { Database, LoaderCircle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const DATASETS = {
  products: { table: "prodotti", fields: ["codice_mexal","nome","descrizione","categoria_mexal","brand_mexal","giacenza","disponibilita","prezzo"], order: "nome" },
  documents: { table: "documenti_workspace", fields: ["titolo","nome_file","categoria","marca","gamma","prodotto","modificato_il"], order: "modificato_il", descending: true },
  orders: { table: "ordini_testate", fields: ["numero_ordine_visualizzato","data_ordine","ragione_sociale_cliente","stato","totale_documento"], order: "data_ordine", descending: true },
  projects: { table: "v4_progetti", fields: ["titolo","stato","priorita","deadline"], order: "deadline" },
  tasks: { table: "v4_fasi_progetto", fields: ["titolo","stato","priorita","deadline","completata"], order: "deadline" },
};

const LABELS = { codice_mexal:"Codice",nome:"Nome",descrizione:"Descrizione",categoria_mexal:"Categoria",brand_mexal:"Brand",giacenza:"Giacenza",disponibilita:"Disponibilità",prezzo:"Prezzo",titolo:"Titolo",nome_file:"File",categoria:"Categoria",marca:"Marca",gamma:"Gamma",prodotto:"Prodotto",modificato_il:"Modificato",numero_ordine_visualizzato:"Ordine",data_ordine:"Data",ragione_sociale_cliente:"Cliente",stato:"Stato",totale_documento:"Totale",priorita:"Priorità",deadline:"Scadenza",completata:"Completata" };

function safeColumns(block, dataset) {
  const requested = Array.isArray(block.columns) ? block.columns : [];
  const selected = requested.filter((field) => dataset.fields.includes(field));
  return selected.length ? selected : dataset.fields.slice(0, 6);
}

function applyFilters(query, filters, dataset) {
  for (const filter of Array.isArray(filters) ? filters.slice(0, 8) : []) {
    if (!dataset.fields.includes(filter.field)) continue;
    if (filter.operator === "eq") query = query.eq(filter.field, filter.value);
    else if (filter.operator === "neq") query = query.neq(filter.field, filter.value);
    else if (filter.operator === "contains") query = query.ilike(filter.field, `%${String(filter.value).replaceAll("%", "")}%`);
    else if (filter.operator === "gte") query = query.gte(filter.field, filter.value);
    else if (filter.operator === "lte") query = query.lte(filter.field, filter.value);
    else if (filter.operator === "in" && Array.isArray(filter.value)) query = query.in(filter.field, filter.value.slice(0, 50));
  }
  return query;
}

function display(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (typeof value === "number") return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

export default function WorkspaceDataBlock({ block, preview = false }) {
  const dataset = DATASETS[block.dataset];
  const columns = useMemo(() => dataset ? safeColumns(block, dataset) : [], [block, dataset]);
  const [state, setState] = useState({ loading: true, rows: [], count: 0, error: "" });
  useEffect(() => {
    let active = true;
    if (!dataset || preview) return undefined;
    const load = async () => {
      let query = supabase.from(dataset.table).select(columns.join(","), { count: "exact" }).limit(Math.min(Number(block.limit || 20), 100));
      query = applyFilters(query, block.filters, dataset).order(dataset.order, { ascending: dataset.descending !== true, nullsFirst: false });
      const { data, count, error } = await query;
      if (error) throw error;
      if (active) setState({ loading: false, rows: data || [], count: count || 0, error: "" });
    };
    void load().catch((error) => active && setState({ loading: false, rows: [], count: 0, error: error.message }));
    return () => { active = false; };
  }, [block.filters, block.limit, columns, dataset, preview]);
  if (!dataset) return null;
  if (preview) return <div className="workspace-data-placeholder"><Database size={24}/><strong>{block.title || block.dataset}</strong><span>Anteprima dati autorizzati</span></div>;
  if (state.loading) return <div className="workspace-data-placeholder"><LoaderCircle className="workspace-data-spinner"/>Caricamento…</div>;
  if (state.error) return <div className="workspace-data-placeholder error">Dati non disponibili: {state.error}</div>;
  if (block.type === "kpi") {
    const values = state.rows.map((row) => Number(row[block.field])).filter(Number.isFinite);
    const value = block.aggregate === "sum" ? values.reduce((sum, item) => sum + item, 0) : block.aggregate === "average" ? (values.reduce((sum, item) => sum + item, 0) / Math.max(values.length, 1)) : state.count;
    return <section className="workspace-dynamic-kpi"><span>{block.title || "Indicatore"}</span><strong>{display(value)}</strong><small>{block.dataset}</small></section>;
  }
  return <section className="workspace-dynamic-table"><h2>{block.title || "Dati"}</h2><div><table><thead><tr>{columns.map((column) => <th key={column}>{LABELS[column] || column}</th>)}</tr></thead><tbody>{state.rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column}>{display(row[column])}</td>)}</tr>)}</tbody></table></div>{!state.rows.length ? <p>Nessun dato disponibile.</p> : null}</section>;
}

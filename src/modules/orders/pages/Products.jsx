import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";

const columns = [
  ["codice_articolo", "Codice"], ["descrizione", "Prodotto"], ["prezzo_listino", "Listino"],
  ["codice_iva_mexal", "Codice IVA"], ["aliquota_iva", "Aliquota IVA (%)"], ["disponibilita", "Disponibile"],
];
const vatMissing = (product) => !String(product.codice_iva_mexal || "").trim() || !Number.isFinite(Number(product.aliquota_iva));
const money = (value) => Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

export default function Products() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: "descrizione", direction: "asc" });
  const [selected, setSelected] = useState(null);

  useEffect(() => { loadProducts(); }, []);
  async function loadProducts() {
    setLoading(true);
    const { data, error } = await supabase.from("ordini_prodotti_cache").select("*").eq("mostra_in_app", true).limit(5000);
    if (error) console.error("Errore prodotti ordini:", error);
    setRows(data || []); setLoading(false);
  }
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const results = q ? rows.filter((item) => Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(q))) : rows;
    return [...results].sort((a, b) => {
      const av = a[sort.key] ?? ""; const bv = b[sort.key] ?? "";
      const comparison = typeof av === "number" || typeof bv === "number" ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), "it");
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [rows, search, sort]);
  const toggleSort = (key) => setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));

  return <div className="orders-page">
    <div className="orders-toolbar"><div className="orders-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca prodotto, codice IVA o aliquota..." /></div></div>
    <div className="orders-table-wrap"><table className="orders-table orders-products-table"><thead><tr>{columns.map(([key, label]) => <th key={key}><button type="button" onClick={() => toggleSort(key)}>{label}{sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>)}</tr></thead><tbody>
      {filtered.map((item) => <tr key={item.codice_articolo} className="orders-clickable-row" onClick={() => setSelected(item)}>
        <td>{item.codice_articolo}</td><td>{item.descrizione}{vatMissing(item) && <span className="orders-vat-missing">IVA mancante</span>}</td><td>{money(item.prezzo_listino)}</td><td>{item.codice_iva_mexal || "-"}</td><td>{item.aliquota_iva ?? "-"}</td><td>{item.disponibilita ?? "-"}</td>
      </tr>)}
    </tbody></table></div>
    {selected && <section className="orders-panel orders-product-detail"><div><h3>{selected.descrizione}</h3><p>{selected.descrizione_completa || selected.codice_articolo}</p></div><div className="orders-detail-summary"><div><span>Codice IVA</span><strong>{selected.codice_iva_mexal || "-"}</strong></div><div><span>Aliquota IVA (%)</span><strong>{selected.aliquota_iva ?? "-"}</strong></div><div><span>Listino</span><strong>{money(selected.prezzo_listino)}</strong></div></div>{vatMissing(selected) && <span className="orders-vat-missing">IVA mancante</span>}<div className="orders-product-actions">{selected.scheda_tecnica_url && <a href={selected.scheda_tecnica_url} target="_blank" rel="noreferrer"><FileText size={16} />Scheda tecnica</a>}{selected.materiale_pubblicitario_url && <a href={selected.materiale_pubblicitario_url} target="_blank" rel="noreferrer"><Download size={16} />Materiale</a>}</div></section>}
    {loading && <div className="orders-empty">Caricamento prodotti...</div>}{!loading && filtered.length === 0 && <div className="orders-empty">Nessun prodotto con MOSTRA_IN_APP attivo.</div>}
  </div>;
}

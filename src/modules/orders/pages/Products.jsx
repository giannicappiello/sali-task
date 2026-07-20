import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";

export default function Products() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    setLoading(true);
    const { data, error } = await supabase.from("ordini_prodotti_cache").select("*").eq("mostra_in_app", true).order("descrizione").limit(5000);
    if (error) console.error("Errore prodotti ordini:", error);
    setRows(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [rows, search]);

  return (
    <div className="orders-page">
      <div className="orders-toolbar"><div className="orders-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca prodotto per qualsiasi dato..." /></div></div>
      <div className="orders-products-grid">
        {filtered.map((item) => (
          <article className="orders-product-card" key={item.codice_articolo}>
            <div className="orders-product-image">{item.immagine_url ? <img src={item.immagine_url} alt={item.descrizione || item.codice_articolo} /> : <span>Nessuna immagine</span>}</div>
            <div><small>{item.codice_articolo}</small><h3>{item.descrizione}</h3><p>{item.descrizione_completa || ""}</p></div>
            <div className="orders-product-meta"><span>Listino: {Number(item.prezzo_listino || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</span><span>Codice IVA: {item.codice_iva_mexal || item.dati_mexal?.cod_iva || "-"}</span><span>Aliquota IVA: {item.aliquota_iva || "-"}%</span><span>UM: {item.unita_misura || "-"}</span><span>Disponibile: {item.disponibilita ?? "-"}</span></div>
            <div className="orders-product-actions">
              {item.scheda_tecnica_url && <a href={item.scheda_tecnica_url} target="_blank" rel="noreferrer"><FileText size={16} />Scheda tecnica</a>}
              {item.materiale_pubblicitario_url && <a href={item.materiale_pubblicitario_url} target="_blank" rel="noreferrer"><Download size={16} />Materiale</a>}
            </div>
          </article>
        ))}
      </div>
      {loading && <div className="orders-empty">Caricamento prodotti...</div>}
      {!loading && filtered.length === 0 && <div className="orders-empty">Nessun prodotto con MOSTRA_IN_APP attivo.</div>}
    </div>
  );
}

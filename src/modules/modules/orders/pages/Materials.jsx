import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";

export default function Materials() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("tutti");

  useEffect(() => { loadMaterials(); }, []);

  async function loadMaterials() {
    const { data, error } = await supabase.from("ordini_materiali").select("*").eq("attivo", true).order("titolo");
    if (error) console.error("Errore materiali ordini:", error);
    setRows(data || []);
  }

  const categories = useMemo(() => ["tutti", ...new Set(rows.map((item) => item.categoria).filter(Boolean))], [rows]);
  const filtered = useMemo(() => rows.filter((item) => {
    const q = search.trim().toLowerCase();
    const matchesText = !q || Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(q));
    const matchesCategory = category === "tutti" || item.categoria === category;
    return matchesText && matchesCategory;
  }), [rows, search, category]);

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca cataloghi, brochure, video..." /></div>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((item) => <option key={item} value={item}>{item === "tutti" ? "Tutte le categorie" : item}</option>)}</select>
      </div>
      <div className="orders-material-grid">
        {filtered.map((item) => <article className="orders-material-card" key={item.id}><span>{item.categoria || "Materiale"}</span><h3>{item.titolo}</h3><p>{item.descrizione || ""}</p><a href={item.file_url} target="_blank" rel="noreferrer">{item.tipo === "video" ? <ExternalLink size={17} /> : <Download size={17} />}Apri</a></article>)}
      </div>
      {filtered.length === 0 && <div className="orders-empty">Nessun materiale disponibile.</div>}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { FileArchive, Folder, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

export default function Products() {
  const [products, setProducts] = useState([]);
  const [links, setLinks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [phases, setPhases] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [prodRes, linksRes, docsRes, phasesRes] = await Promise.all([
      supabase.from("prodotti").select("*").order("nome").limit(2000),
      supabase.from("v4_progetto_prodotti").select("*,v4_progetti(id,titolo,stato,deadline)").order("created_at", { ascending: false }),
      supabase.from("documenti").select("*").order("created_at", { ascending: false }),
      supabase.from("v4_fasi_progetto").select("*,v4_progetti(id,titolo)").order("updated_at", { ascending: false }).limit(500),
    ]);
    setProducts(prodRes.data || []);
    setLinks(linksRes.data || []);
    setDocuments(docsRes.data || []);
    setPhases(phasesRes.data || []);
    if (!selected && prodRes.data?.[0]) setSelected(prodRes.data[0]);
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return products;
    return products.filter((p) => `${p.nome || ""} ${p.codice || ""} ${p.brand || ""} ${p.categoria || ""} ${p.sottocategoria || ""}`.toLowerCase().includes(text));
  }, [products, query]);

  const productLinks = useMemo(() => links.filter((l) => l.prodotto_id === selected?.id), [links, selected?.id]);
  const productDocs = useMemo(() => documents.filter((d) => d.prodotto_id === selected?.id || d.prodotto === selected?.nome), [documents, selected]);
  const productProjectIds = new Set(productLinks.map((l) => l.progetto_id));
  const productPhases = useMemo(() => phases.filter((f) => productProjectIds.has(f.progetto_id)).slice(0, 30), [phases, productLinks]);

  return (
    <div className="products-page v4-page">
      <div className="page-title-row"><div><h1>Prodotti</h1><p>Archivio prodotti con progetti collegati, documentazione e storico fasi.</p></div></div>
      <div className="v4-toolbar"><div className="task-search"><Search size={18} /><input placeholder="Cerca prodotto, codice, brand..." value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
      <div className="product-layout">
        <div className="panel product-list-panel">
          <div className="panel-header"><h3>Archivio prodotti</h3><span>{filtered.length}</span></div>
          <div className="v4-list compact-list">{filtered.map((p) => <button key={p.id} className={`v4-list-main product-row ${selected?.id === p.id ? "active" : ""}`} onClick={() => setSelected(p)}><strong>{p.nome}</strong><span>{p.codice || "Senza codice"} · {p.brand || "Brand non indicato"}</span><small>{p.categoria || ""} {p.sottocategoria || ""}</small></button>)}</div>
        </div>
        <div className="product-detail-stack">
          {!selected ? <div className="panel"><p className="empty-text">Seleziona un prodotto.</p></div> : <>
            <div className="panel product-hero"><span className={`status-pill ${selected.attivo === false ? "danger" : "done"}`}>{selected.attivo === false ? "Non attivo" : selected.stato || "Attivo"}</span><h2>{selected.nome}</h2><p>{selected.descrizione || selected.note || "Nessuna descrizione prodotto."}</p><div className="mini-meta"><span>Codice: {selected.codice || "-"}</span><span>Brand: {selected.brand || "-"}</span><span>Categoria: {selected.categoria || "-"}</span><span>Sottocategoria: {selected.sottocategoria || "-"}</span></div></div>
            <div className="v4-split equal"><div className="panel"><div className="panel-header"><h3><Folder size={18} /> Progetti collegati</h3></div>{productLinks.length === 0 ? <p className="empty-text">Nessun progetto collegato.</p> : <div className="v4-list">{productLinks.map((link) => <div className="v4-list-row" key={link.id}><div className="v4-list-main"><strong>{link.v4_progetti?.titolo || link.prodotto_nome || "Progetto"}</strong><span>{link.v4_progetti?.stato || "-"}</span><small>Deadline {link.v4_progetti?.deadline || "-"}</small></div></div>)}</div>}</div><div className="panel"><div className="panel-header"><h3><FileArchive size={18} /> Documentazione</h3></div>{productDocs.length === 0 ? <p className="empty-text">Nessun documento collegato.</p> : <div className="v4-list">{productDocs.map((doc) => <a className="v4-list-main doc-link" href={doc.file_url || "#"} target="_blank" rel="noreferrer" key={doc.id}><strong>{doc.titolo}</strong><span>{doc.tipo_documento || doc.tipo || doc.categoria_nome || "Documento"}</span><small>{doc.codice_documento || doc.codice || ""}</small></a>)}</div>}</div></div>
            <div className="panel"><div className="panel-header"><h3>Storico attività prodotto</h3></div>{productPhases.length === 0 ? <p className="empty-text">Nessuna fase collegata tramite progetti prodotto.</p> : <div className="v4-list">{productPhases.map((phase) => <div className="v4-list-row" key={phase.id}><div className="v4-list-main"><strong>{phase.titolo}</strong><span>{phase.v4_progetti?.titolo || "Progetto"}</span><small>{phase.stato || "Da evadere"} · {phase.deadline || "Senza deadline"}</small></div></div>)}</div>}</div>
          </>}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Download, FileArchive, Plus, Save, Search, Upload, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const docTypes = ["Scheda tecnica", "SDS", "Certificazione", "Artwork", "Etichetta", "PDF", "Foto", "Brevetto", "Documentazione regolatoria"];
const emptyDoc = { titolo: "", descrizione: "", tipo: "Scheda tecnica", codice: "", stato: "Bozza", prodotto_id: "", progetto_id: "" };

export default function Documentation() {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [versions, setVersions] = useState([]);
  const [products, setProducts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("Tutti");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyDoc);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (selected?.id) loadVersions(selected.id); }, [selected?.id]);

  async function loadData() {
    const [docsRes, prodRes, projRes] = await Promise.all([
      supabase.from("documenti").select("*").order("updated_at", { ascending: false }),
      supabase.from("prodotti").select("id,nome,codice").order("nome").limit(1000),
      supabase.from("v4_progetti").select("id,titolo").order("created_at", { ascending: false }).limit(500),
    ]);
    setDocuments(docsRes.data || []);
    setProducts(prodRes.data || []);
    setProjects(projRes.data || []);
    if (!selected && docsRes.data?.[0]) setSelected(docsRes.data[0]);
  }

  async function loadVersions(documento_id) {
    const { data } = await supabase.from("documenti_versioni").select("*").eq("documento_id", documento_id).order("created_at", { ascending: false });
    setVersions(data || []);
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return documents.filter((doc) => {
      const docType = doc.tipo_documento || doc.tipo || doc.categoria_nome || doc.categoria;
      if (type !== "Tutti" && docType !== type) return false;
      if (!text) return true;
      return `${doc.titolo || ""} ${doc.descrizione || ""} ${docType || ""} ${doc.codice_documento || ""} ${doc.codice || ""} ${products.find((p) => p.id === doc.prodotto_id)?.nome || ""} ${projects.find((p) => p.id === doc.progetto_id)?.titolo || ""}`.toLowerCase().includes(text);
    });
  }, [documents, query, type]);

  function openNew() {
    setSelected(null);
    setForm(emptyDoc);
    setFile(null);
    setModal(true);
  }

  function openEdit(doc) {
    setSelected(doc);
    setForm({ titolo: doc.titolo || "", descrizione: doc.descrizione || "", tipo: doc.tipo_documento || doc.tipo || doc.categoria_nome || "Scheda tecnica", codice: doc.codice_documento || doc.codice || "", stato: doc.stato || "Bozza", prodotto_id: doc.prodotto_id || "", progetto_id: doc.progetto_id || "" });
    setFile(null);
    setModal(true);
  }

  async function saveDocument(e) {
    e.preventDefault();
    if (!form.titolo.trim()) return alert("Inserisci il titolo del documento.");
    setSaving(true);
    let fileUrl = selected?.file_url || null;
    let storagePath = null;
    if (file) {
      storagePath = `${profile?.id || "user"}/documenti/${Date.now()}-${file.name}`;
      const uploaded = await supabase.storage.from("documenti").upload(storagePath, file, { upsert: true });
      if (uploaded.error) { setSaving(false); return alert(`Errore upload. Verifica bucket Storage "documenti". ${uploaded.error.message}`); }
      const { data } = supabase.storage.from("documenti").getPublicUrl(storagePath);
      fileUrl = data.publicUrl;
    }

    const payload = { titolo: form.titolo.trim(), descrizione: form.descrizione.trim() || null, tipo: form.tipo, tipo_documento: form.tipo, categoria_nome: form.tipo, codice: form.codice.trim() || null, codice_documento: form.codice.trim() || null, stato: form.stato, prodotto_id: form.prodotto_id || null, progetto_id: form.progetto_id || null, file_url: fileUrl, updated_at: new Date().toISOString() };
    if (!selected?.id) payload.creato_da = profile?.id || null;
    const request = selected?.id ? supabase.from("documenti").update(payload).eq("id", selected.id).select().single() : supabase.from("documenti").insert(payload).select().single();
    const { data: saved, error } = await request;
    if (error) { setSaving(false); return alert(error.message); }
    if (file && saved?.id) {
      await supabase.from("documenti_versioni").insert({ documento_id: saved.id, versione: String(versions.length + 1), file_path: storagePath, file_name: file.name, mime_type: file.type, note: "Nuova versione", caricato_da: profile?.id || null, creato_da: profile?.id || null, created_by: profile?.id || null, file_url: fileUrl });
    }
    setSaving(false);
    setModal(false);
    await loadData();
    if (saved) setSelected(saved);
  }

  const counters = useMemo(() => docTypes.map((item) => ({ label: item, count: documents.filter((doc) => (doc.tipo_documento || doc.tipo || doc.categoria_nome || doc.categoria) === item).length })), [documents]);

  return (
    <div className="documentation-page v4-page">
      <div className="page-title-row"><div><h1>Documentazione</h1><p>Schede tecniche, SDS, certificazioni, artwork, etichette, PDF, foto, brevetti e regolatorio.</p></div><button className="primary-action" onClick={openNew}><Plus size={18} />Nuovo documento</button></div>
      <div className="doc-type-grid">{counters.map((item) => <button key={item.label} className={`doc-type-card ${type === item.label ? "active" : ""}`} onClick={() => setType(type === item.label ? "Tutti" : item.label)}><FileArchive size={20} /><strong>{item.count}</strong><span>{item.label}</span></button>)}</div>
      <div className="v4-toolbar"><div className="task-search"><Search size={18} /><input placeholder="Cerca documenti..." value={query} onChange={(e) => setQuery(e.target.value)} /></div><button className={`filter-chip ${type === "Tutti" ? "active" : ""}`} onClick={() => setType("Tutti")}>Tutti</button></div>
      <div className="v4-split docs-split"><div className="panel"><div className="panel-header"><h3>Archivio documenti</h3><span>{filtered.length}</span></div><div className="v4-list">{filtered.map((doc) => <button key={doc.id} className={`v4-list-main doc-row ${selected?.id === doc.id ? "active" : ""}`} onClick={() => setSelected(doc)}><strong>{doc.titolo}</strong><span>{doc.tipo_documento || doc.tipo || doc.categoria_nome || "Documento"} · {doc.stato || "Bozza"}</span><small>{products.find((p) => p.id === doc.prodotto_id)?.nome || ""} {projects.find((p) => p.id === doc.progetto_id)?.titolo ? `· ${projects.find((p) => p.id === doc.progetto_id)?.titolo}` : ""}</small></button>)}</div></div><div className="panel detail-panel">{!selected ? <p className="empty-text">Seleziona un documento.</p> : <><div className="panel-header"><h3>{selected.titolo}</h3><button className="secondary-action" onClick={() => openEdit(selected)}>Modifica</button></div><p className="detail-description">{selected.descrizione || "Nessuna descrizione."}</p><div className="mini-meta"><span>Tipo: {selected.tipo_documento || selected.tipo || selected.categoria_nome || "Documento"}</span><span>Codice: {selected.codice_documento || selected.codice || "-"}</span><span>Prodotto: {products.find((p) => p.id === selected.prodotto_id)?.nome || "-"}</span><span>Progetto: {projects.find((p) => p.id === selected.progetto_id)?.titolo || "-"}</span></div>{selected.file_url && <a className="download-main" href={selected.file_url} target="_blank" rel="noreferrer"><Download size={18} />Apri file</a>}<h4>Versioni</h4>{versions.length === 0 ? <p className="empty-text">Nessuna versione caricata.</p> : <div className="attachments-list">{versions.map((v) => <a key={v.id} href={v.file_url || "#"} target="_blank" rel="noreferrer"><Download size={16} />v{v.versione} · {v.file_name}</a>)}</div>}</>}</div></div>
      {modal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveDocument}><div className="modal-header"><h2>{selected ? "Modifica documento" : "Nuovo documento"}</h2><button type="button" onClick={() => setModal(false)}><X size={20} /></button></div><label>Titolo<input value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /></label><label>Descrizione<textarea rows="4" value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} /></label><div className="form-grid-2"><label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>{docTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Stato<select value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}><option>Bozza</option><option>In revisione</option><option>Approvato</option><option>Archiviato</option></select></label></div><label>Codice<input value={form.codice} onChange={(e) => setForm({ ...form, codice: e.target.value })} /></label><div className="form-grid-2"><label>Prodotto<select value={form.prodotto_id} onChange={(e) => setForm({ ...form, prodotto_id: e.target.value })}><option value="">Nessuno</option>{products.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><label>Progetto<select value={form.progetto_id} onChange={(e) => setForm({ ...form, progetto_id: e.target.value })}><option value="">Nessuno</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.titolo}</option>)}</select></label></div><label className="upload-box"><Upload size={18} />{file ? file.name : "Carica file / nuova versione"}<input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} /></label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva documento"}</button></form></div>}
    </div>
  );
}

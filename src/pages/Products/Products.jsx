import { useEffect, useMemo, useState } from "react";
import { FileArchive, Folder, Plus, Save, Search, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const emptyProduct = {
  nome: "",
  codice: "",
  brand: "",
  categoria: "",
  sottocategoria: "",
  descrizione: "",
  note: "",
  stato: "Attivo",
  attivo: true,
};

function parseStoragePathFromUrl(url, bucket) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const publicMarker = `/object/public/${bucket}/`;
    const signedMarker = `/object/sign/${bucket}/`;
    let path = null;

    if (parsed.pathname.includes(publicMarker)) {
      path = parsed.pathname.split(publicMarker)[1];
    }

    if (!path && parsed.pathname.includes(signedMarker)) {
      path = parsed.pathname.split(signedMarker)[1];
    }

    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

export default function Products() {
  const { profile, hasPermission, isAdmin } = useAuth();
  const canManageProducts = Boolean(hasPermission?.("products.write") || hasPermission?.("projects.write") || isAdmin?.());

  const [products, setProducts] = useState([]);
  const [links, setLinks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [documentVersions, setDocumentVersions] = useState([]);
  const [phases, setPhases] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyProduct);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [prodRes, linksRes, docsRes, versionsRes, phasesRes] = await Promise.all([
      supabase.from("prodotti").select("*").order("nome").limit(5000),
      supabase.from("v4_progetto_prodotti").select("*,v4_progetti(id,titolo,stato,deadline)").order("created_at", { ascending: false }),
      supabase.from("documenti").select("*").order("created_at", { ascending: false }),
      supabase.from("documenti_versioni").select("*").order("created_at", { ascending: false }),
      supabase.from("v4_fasi_progetto").select("*,v4_progetti(id,titolo)").order("updated_at", { ascending: false }).limit(500),
    ]);

    if (prodRes.error) console.error("Prodotti:", prodRes.error.message);
    if (linksRes.error) console.error("Collegamenti prodotti:", linksRes.error.message);
    if (docsRes.error) console.error("Documenti prodotti:", docsRes.error.message);
    if (versionsRes.error) console.error("Versioni documenti prodotti:", versionsRes.error.message);
    if (phasesRes.error) console.error("Fasi prodotti:", phasesRes.error.message);

    const nextProducts = prodRes.data || [];
    setProducts(nextProducts);
    setLinks(linksRes.data || []);
    setDocuments(docsRes.data || []);
    setDocumentVersions(versionsRes.data || []);
    setPhases(phasesRes.data || []);

    setSelected((current) => {
      if (current?.id) return nextProducts.find((item) => item.id === current.id) || null;
      return nextProducts[0] || null;
    });
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

  function openNew() {
    if (!canManageProducts) return alert("Non hai i permessi per creare prodotti.");
    setSelected(null);
    setForm({ ...emptyProduct });
    setModalOpen(true);
  }

  function openEdit(product) {
    if (!product?.id) return;
    setSelected(product);
    setForm({
      nome: product.nome || "",
      codice: product.codice || "",
      brand: product.brand || "",
      categoria: product.categoria || "",
      sottocategoria: product.sottocategoria || "",
      descrizione: product.descrizione || "",
      note: product.note || "",
      stato: product.stato || (product.attivo === false ? "Non attivo" : "Attivo"),
      attivo: product.attivo !== false,
    });
    setModalOpen(true);
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveProduct(e) {
    e.preventDefault();
    if (!canManageProducts) return alert("Non hai i permessi per modificare i prodotti.");
    if (!form.nome.trim()) return alert("Inserisci il nome del prodotto.");

    setSaving(true);
    const payload = {
      nome: form.nome.trim(),
      codice: form.codice.trim() || null,
      brand: form.brand.trim() || null,
      categoria: form.categoria.trim() || null,
      sottocategoria: form.sottocategoria.trim() || null,
      descrizione: form.descrizione.trim() || null,
      note: form.note.trim() || null,
      stato: form.stato || (form.attivo ? "Attivo" : "Non attivo"),
      attivo: Boolean(form.attivo),
      updated_at: new Date().toISOString(),
    };

    
    const request = selected?.id
      ? supabase.from("prodotti").update(payload).eq("id", selected.id).select().single()
      : supabase.from("prodotti").insert(payload).select().single();

    const { data, error } = await request;
    setSaving(false);
    if (error) return alert(error.message);

    setModalOpen(false);
    await loadData();
    if (data?.id) setSelected(data);
  }

  async function removeProductDocuments(product) {
    const docs = documents.filter((doc) => doc.prodotto_id === product.id || doc.prodotto === product.nome);
    const documentIds = docs.map((doc) => doc.id).filter(Boolean);
    const versions = documentVersions.filter((version) => documentIds.includes(version.documento_id));

    const storagePaths = [
      ...docs.map((doc) => doc.file_path || parseStoragePathFromUrl(doc.file_url, "documenti")),
      ...versions.map((version) => version.file_path || parseStoragePathFromUrl(version.file_url, "documenti")),
    ].filter(Boolean);

    const uniquePaths = [...new Set(storagePaths)];
    if (uniquePaths.length) {
      const { error: storageError } = await supabase.storage.from("documenti").remove(uniquePaths);
      if (storageError) throw storageError;
    }

    if (documentIds.length) {
      const deleteVersions = await supabase.from("documenti_versioni").delete().in("documento_id", documentIds);
      if (deleteVersions.error) throw deleteVersions.error;

      const deleteDocs = await supabase.from("documenti").delete().in("id", documentIds);
      if (deleteDocs.error) throw deleteDocs.error;
    }
  }

  async function deleteProduct() {
    if (!selected?.id) return;
    if (!canManageProducts) return alert("Non hai i permessi per eliminare i prodotti.");

    const confirmText = `Eliminare il prodotto "${selected.nome}"?\n\nVerranno eliminati anche documenti/file collegati e tutti i collegamenti del prodotto.`;
    if (!window.confirm(confirmText)) return;

    setDeleting(true);
    try {
      await removeProductDocuments(selected);

      const cleanupRequests = [
        supabase.from("v4_progetto_prodotti").delete().eq("prodotto_id", selected.id),
        supabase.from("v4_fase_prodotti").delete().eq("prodotto_id", selected.id),
        supabase.from("tasks").update({ prodotto_id: null }).eq("prodotto_id", selected.id),
        supabase.from("agenda_reminder").update({ prodotto_id: null }).eq("prodotto_id", selected.id),
      ];

      const cleanupResults = await Promise.all(cleanupRequests);
      const cleanupError = cleanupResults.find((result) => result.error)?.error;
      if (cleanupError) throw cleanupError;

      const { error } = await supabase.from("prodotti").delete().eq("id", selected.id);
      if (error) throw error;

      setSelected(null);
      setModalOpen(false);
      await loadData();
    } catch (error) {
      alert(error.message || "Errore durante l'eliminazione del prodotto.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="products-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Prodotti</h1>
          <p>Archivio prodotti con progetti collegati, documentazione e storico fasi.</p>
        </div>
      </div>

      <div className="v4-toolbar">
        <div className="task-search">
          <Search size={18} />
          <input placeholder="Cerca prodotto, codice, brand..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {canManageProducts && (
          <button className="primary-action" type="button" onClick={openNew}>
            <Plus size={18} /> Nuovo prodotto
          </button>
        )}
      </div>

      <div className="product-layout">
        <div className="panel product-list-panel">
          <div className="panel-header">
            <h3>Archivio prodotti</h3>
            <span>{filtered.length}</span>
          </div>
          <div className="v4-list compact-list">
            {filtered.map((p) => (
              <button key={p.id} className={`v4-list-main product-row ${selected?.id === p.id ? "active" : ""}`} onClick={() => openEdit(p)}>
                <strong>{p.nome}</strong>
                <span>{p.codice || "Senza codice"} · {p.brand || "Brand non indicato"}</span>
                <small>{p.categoria || ""} {p.sottocategoria || ""}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="product-detail-stack">
          {!selected ? (
            <div className="panel"><p className="empty-text">Seleziona un prodotto.</p></div>
          ) : (
            <>
              <div className="panel product-hero">
                <span className={`status-pill ${selected.attivo === false ? "danger" : "done"}`}>{selected.attivo === false ? "Non attivo" : selected.stato || "Attivo"}</span>
                <h2>{selected.nome}</h2>
                <p>{selected.descrizione || selected.note || "Nessuna descrizione prodotto."}</p>
                <div className="mini-meta">
                  <span>Codice: {selected.codice || "-"}</span>
                  <span>Brand: {selected.brand || "-"}</span>
                  <span>Categoria: {selected.categoria || "-"}</span>
                  <span>Sottocategoria: {selected.sottocategoria || "-"}</span>
                </div>
              </div>

              <div className="v4-split equal">
                <div className="panel">
                  <div className="panel-header"><h3><Folder size={18} /> Progetti collegati</h3></div>
                  {productLinks.length === 0 ? <p className="empty-text">Nessun progetto collegato.</p> : (
                    <div className="v4-list">
                      {productLinks.map((link) => (
                        <div className="v4-list-row" key={link.id}>
                          <div className="v4-list-main">
                            <strong>{link.v4_progetti?.titolo || link.prodotto_nome || "Progetto"}</strong>
                            <span>{link.v4_progetti?.stato || "-"}</span>
                            <small>Deadline {link.v4_progetti?.deadline || "-"}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="panel">
                  <div className="panel-header"><h3><FileArchive size={18} /> Documentazione</h3></div>
                  {productDocs.length === 0 ? <p className="empty-text">Nessun documento collegato.</p> : (
                    <div className="v4-list">
                      {productDocs.map((doc) => (
                        <a className="v4-list-main doc-link" href={doc.file_url || "#"} target="_blank" rel="noreferrer" key={doc.id}>
                          <strong>{doc.titolo}</strong>
                          <span>{doc.tipo_documento || doc.tipo || doc.categoria_nome || "Documento"}</span>
                          <small>{doc.codice_documento || doc.codice || ""}</small>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><h3>Storico attività prodotto</h3></div>
                {productPhases.length === 0 ? <p className="empty-text">Nessuna fase collegata tramite progetti prodotto.</p> : (
                  <div className="v4-list">
                    {productPhases.map((phase) => (
                      <div className="v4-list-row" key={phase.id}>
                        <div className="v4-list-main">
                          <strong>{phase.titolo}</strong>
                          <span>{phase.v4_progetti?.titolo || "Progetto"}</span>
                          <small>{phase.stato || "Da evadere"} · {phase.deadline || "Senza deadline"}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="modal-backdrop">
          <form className="modal-card v4-modal" onSubmit={saveProduct}>
            <div className="modal-header">
              <div>
                <h2>{selected?.id ? "Modifica prodotto" : "Nuovo prodotto"}</h2>
                <p>{selected?.id ? "Aggiorna dati prodotto o elimina prodotto e collegamenti." : "Inserisci un nuovo prodotto in archivio."}</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)}><X size={20} /></button>
            </div>

            <label>Nome *<input value={form.nome} onChange={(e) => updateForm("nome", e.target.value)} autoFocus /></label>
            <div className="form-grid-2">
              <label>Codice<input value={form.codice} onChange={(e) => updateForm("codice", e.target.value)} /></label>
              <label>Brand<input value={form.brand} onChange={(e) => updateForm("brand", e.target.value)} /></label>
              <label>Categoria<input value={form.categoria} onChange={(e) => updateForm("categoria", e.target.value)} /></label>
              <label>Sottocategoria<input value={form.sottocategoria} onChange={(e) => updateForm("sottocategoria", e.target.value)} /></label>
              <label>Stato<input value={form.stato} onChange={(e) => updateForm("stato", e.target.value)} /></label>
              <label>Attivo<select value={form.attivo ? "true" : "false"} onChange={(e) => updateForm("attivo", e.target.value === "true")}><option value="true">Sì</option><option value="false">No</option></select></label>
            </div>
            <label>Descrizione<textarea rows="4" value={form.descrizione} onChange={(e) => updateForm("descrizione", e.target.value)} /></label>
            <label>Note<textarea rows="3" value={form.note} onChange={(e) => updateForm("note", e.target.value)} /></label>

            <div className="dashboard-message-actions">
              {selected?.id && canManageProducts && (
                <button type="button" className="secondary-action danger" onClick={deleteProduct} disabled={deleting}>
                  <Trash2 size={18} /> {deleting ? "Eliminazione..." : "Elimina prodotto"}
                </button>
              )}
              <button type="button" className="secondary-action" onClick={() => setModalOpen(false)}>Annulla</button>
              <button type="submit" className="primary-action" disabled={saving}><Save size={18} /> {saving ? "Salvataggio..." : "Salva prodotto"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

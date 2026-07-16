import { useEffect, useMemo, useState } from "react";
import {
  FileArchive,
  Folder,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
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

  const canManageProducts = Boolean(
    hasPermission?.("products.write") ||
      hasPermission?.("projects.write") ||
      isAdmin?.()
  );

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

  const [ordersAccessLoading, setOrdersAccessLoading] = useState(true);
  const [canSyncMexal, setCanSyncMexal] = useState(false);

  const [syncingTest, setSyncingTest] = useState(false);
  const [syncingReal, setSyncingReal] = useState(false);
  const [syncTestPassed, setSyncTestPassed] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadMexalSyncAccess();
  }, [profile?.id]);

  async function loadMexalSyncAccess() {
    setOrdersAccessLoading(true);

    if (!profile?.id) {
      setCanSyncMexal(false);
      setOrdersAccessLoading(false);
      return;
    }

    if (isAdmin?.()) {
      setCanSyncMexal(true);
      setOrdersAccessLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("integrazioni_utenti")
      .select("enabled,ruolo_ordini")
      .eq("utente_id", profile.id)
      .eq("modulo", "gestione_ordini")
      .maybeSingle();

    if (error) {
      console.error("Errore verifica accesso sincronizzazione Mexal:", error);
      setCanSyncMexal(false);
      setOrdersAccessLoading(false);
      return;
    }

    setCanSyncMexal(
      data?.enabled === true && data?.ruolo_ordini === "backoffice"
    );

    setOrdersAccessLoading(false);
  }

  async function loadData() {
    const [
      prodRes,
      linksRes,
      docsRes,
      versionsRes,
      phasesRes,
    ] = await Promise.all([
      supabase.from("prodotti").select("*").order("nome").limit(5000),
      supabase
        .from("v4_progetto_prodotti")
        .select("*,v4_progetti(id,titolo,stato,deadline)")
        .order("created_at", { ascending: false }),
      supabase
        .from("documenti")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("documenti_versioni")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("v4_fasi_progetto")
        .select("*,v4_progetti(id,titolo)")
        .order("updated_at", { ascending: false })
        .limit(500),
    ]);

    if (prodRes.error) {
      console.error("Prodotti:", prodRes.error.message);
    }

    if (linksRes.error) {
      console.error("Collegamenti prodotti:", linksRes.error.message);
    }

    if (docsRes.error) {
      console.error("Documenti prodotti:", docsRes.error.message);
    }

    if (versionsRes.error) {
      console.error("Versioni documenti prodotti:", versionsRes.error.message);
    }

    if (phasesRes.error) {
      console.error("Fasi prodotti:", phasesRes.error.message);
    }

    const nextProducts = prodRes.data || [];

    setProducts(nextProducts);
    setLinks(linksRes.data || []);
    setDocuments(docsRes.data || []);
    setDocumentVersions(versionsRes.data || []);
    setPhases(phasesRes.data || []);

    setSelected((current) => {
      if (current?.id) {
        return (
          nextProducts.find((item) => item.id === current.id) || null
        );
      }

      return nextProducts[0] || null;
    });
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();

    if (!text) return products;

    return products.filter((product) =>
      [
        product.nome,
        product.codice,
        product.codice_mexal,
        product.brand,
        product.brand_mexal,
        product.categoria,
        product.categoria_mexal,
        product.sottocategoria,
        product.sottocategoria_mexal,
        product.linea_mexal,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(text)
    );
  }, [products, query]);

  const productLinks = useMemo(
    () => links.filter((link) => link.prodotto_id === selected?.id),
    [links, selected?.id]
  );

  const productDocs = useMemo(
    () =>
      documents.filter(
        (document) =>
          document.prodotto_id === selected?.id ||
          document.prodotto === selected?.nome
      ),
    [documents, selected]
  );

  const productProjectIds = useMemo(
    () => new Set(productLinks.map((link) => link.progetto_id)),
    [productLinks]
  );

  const productPhases = useMemo(
    () =>
      phases
        .filter((phase) => productProjectIds.has(phase.progetto_id))
        .slice(0, 30),
    [phases, productProjectIds]
  );

  function openNew() {
    if (!canManageProducts) {
      alert("Non hai i permessi per creare prodotti.");
      return;
    }

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
      stato:
        product.stato ||
        (product.attivo === false ? "Non attivo" : "Attivo"),
      attivo: product.attivo !== false,
    });

    setModalOpen(true);
  }

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveProduct(event) {
    event.preventDefault();

    if (!canManageProducts) {
      alert("Non hai i permessi per modificare i prodotti.");
      return;
    }

    if (!form.nome.trim()) {
      alert("Inserisci il nome del prodotto.");
      return;
    }

    setSaving(true);

    const payload = {
      nome: form.nome.trim(),
      codice: form.codice.trim() || null,
      brand: form.brand.trim() || null,
      categoria: form.categoria.trim() || null,
      sottocategoria: form.sottocategoria.trim() || null,
      descrizione: form.descrizione.trim() || null,
      note: form.note.trim() || null,
      stato:
        form.stato || (form.attivo ? "Attivo" : "Non attivo"),
      attivo: Boolean(form.attivo),
      updated_at: new Date().toISOString(),
    };

    const request = selected?.id
      ? supabase
          .from("prodotti")
          .update(payload)
          .eq("id", selected.id)
          .select()
          .single()
      : supabase
          .from("prodotti")
          .insert(payload)
          .select()
          .single();

    const { data, error } = await request;

    setSaving(false);

    if (error) {
      alert(error.message);
      return;
    }

    setModalOpen(false);
    await loadData();

    if (data?.id) {
      setSelected(data);
    }
  }

  async function removeProductDocuments(product) {
    const docs = documents.filter(
      (document) =>
        document.prodotto_id === product.id ||
        document.prodotto === product.nome
    );

    const documentIds = docs
      .map((document) => document.id)
      .filter(Boolean);

    const versions = documentVersions.filter((version) =>
      documentIds.includes(version.documento_id)
    );

    const storagePaths = [
      ...docs.map(
        (document) =>
          document.file_path ||
          parseStoragePathFromUrl(document.file_url, "documenti")
      ),
      ...versions.map(
        (version) =>
          version.file_path ||
          parseStoragePathFromUrl(version.file_url, "documenti")
      ),
    ].filter(Boolean);

    const uniquePaths = [...new Set(storagePaths)];

    if (uniquePaths.length) {
      const { error: storageError } = await supabase.storage
        .from("documenti")
        .remove(uniquePaths);

      if (storageError) throw storageError;
    }

    if (documentIds.length) {
      const deleteVersions = await supabase
        .from("documenti_versioni")
        .delete()
        .in("documento_id", documentIds);

      if (deleteVersions.error) throw deleteVersions.error;

      const deleteDocs = await supabase
        .from("documenti")
        .delete()
        .in("id", documentIds);

      if (deleteDocs.error) throw deleteDocs.error;
    }
  }

  async function deleteProduct() {
    if (!selected?.id) return;

    if (!canManageProducts) {
      alert("Non hai i permessi per eliminare i prodotti.");
      return;
    }

    const confirmText =
      `Eliminare il prodotto "${selected.nome}"?\n\n` +
      "Verranno eliminati anche documenti/file collegati e tutti i collegamenti del prodotto.";

    if (!window.confirm(confirmText)) return;

    setDeleting(true);

    try {
      await removeProductDocuments(selected);

      const cleanupRequests = [
        supabase
          .from("v4_progetto_prodotti")
          .delete()
          .eq("prodotto_id", selected.id),
        supabase
          .from("v4_fase_prodotti")
          .delete()
          .eq("prodotto_id", selected.id),
        supabase
          .from("tasks")
          .update({ prodotto_id: null })
          .eq("prodotto_id", selected.id),
        supabase
          .from("agenda_reminder")
          .update({ prodotto_id: null })
          .eq("prodotto_id", selected.id),
      ];

      const cleanupResults = await Promise.all(cleanupRequests);
      const cleanupError = cleanupResults.find(
        (result) => result.error
      )?.error;

      if (cleanupError) throw cleanupError;

      const { error } = await supabase
        .from("prodotti")
        .delete()
        .eq("id", selected.id);

      if (error) throw error;

      setSelected(null);
      setModalOpen(false);
      await loadData();
    } catch (error) {
      alert(
        error.message ||
          "Errore durante l'eliminazione del prodotto."
      );
    } finally {
      setDeleting(false);
    }
  }

  async function runMexalSync({ dryRun, downloadImages, maxArticles }) {
    if (!canSyncMexal) {
      alert(
        "La sincronizzazione Mexal è riservata ad amministratori e backoffice ordini."
      );
      return null;
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
    }

    const response = await fetch("/api/mexal/sync-products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        dryRun,
        downloadImages,
        maxArticles,
      }),
    });

    const text = await response.text();
    let data;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || "Risposta API non valida." };
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
          data?.details ||
          `Errore API Vercel (${response.status}).`
      );
    }

    return data;
  }

  async function testMexalSync() {
    setSyncingTest(true);
    setSyncResult(null);
    setSyncTestPassed(false);

    try {
      const result = await runMexalSync({
        dryRun: true,
        downloadImages: false,
        maxArticles: 10,
      });

      setSyncResult(result);

      const passed =
        result &&
        !result.error &&
        Number(result.letti_mexal || 0) >= 0 &&
        Array.isArray(result.errori);

      setSyncTestPassed(Boolean(passed));

      if (passed) {
        alert("Test Mexal completato correttamente.");
      } else {
        alert("Il test Mexal non ha restituito un risultato valido.");
      }
    } catch (error) {
      console.error("Test sincronizzazione Mexal:", error);
      setSyncResult({
        error: error.message || "Errore durante il test Mexal.",
      });
      alert(error.message || "Errore durante il test Mexal.");
    } finally {
      setSyncingTest(false);
    }
  }

  async function executeRealMexalSync() {
    if (!syncTestPassed) {
      alert("Esegui prima il test Mexal.");
      return;
    }

    alert(
      "Il collegamento Vercel → Mexal è stato verificato. " +
        "La sincronizzazione completa di database e immagini verrà attivata nel passaggio successivo."
    );
  }

  return (
    <div className="products-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Prodotti</h1>
          <p>
            Archivio unico prodotti con dati Workspace e
            sincronizzazione Mexal.
          </p>
        </div>
      </div>

      <div className="v4-toolbar">
        <div className="task-search">
          <Search size={18} />
          <input
            placeholder="Cerca prodotto, codice, brand, categoria..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {!ordersAccessLoading && canSyncMexal && (
            <>
              <button
                className="secondary-action"
                type="button"
                onClick={testMexalSync}
                disabled={syncingTest || syncingReal}
              >
                <RefreshCw
                  size={18}
                  className={syncingTest ? "spin" : ""}
                />
                {syncingTest ? "Test in corso..." : "Test Mexal"}
              </button>

              <button
                className="primary-action"
                type="button"
                onClick={executeRealMexalSync}
                disabled={
                  !syncTestPassed ||
                  syncingTest ||
                  syncingReal
                }
                title={
                  syncTestPassed
                    ? "Sincronizza i primi 50 articoli"
                    : "Esegui prima il test Mexal"
                }
              >
                <RefreshCw
                  size={18}
                  className={syncingReal ? "spin" : ""}
                />
                {syncingReal
                  ? "Sincronizzazione..."
                  : "Sincronizza Mexal"}
              </button>
            </>
          )}

          {canManageProducts && (
            <button
              className="primary-action"
              type="button"
              onClick={openNew}
            >
              <Plus size={18} />
              Nuovo prodotto
            </button>
          )}
        </div>
      </div>

      {syncResult && (
        <div
          className="panel"
          style={{
            marginBottom: "18px",
            border:
              syncResult.error
                ? "1px solid #fecaca"
                : "1px solid #bfdbfe",
            background:
              syncResult.error ? "#fef2f2" : "#eff6ff",
          }}
        >
          <div className="panel-header">
            <h3>Risultato sincronizzazione Mexal</h3>
            <button
              type="button"
              onClick={() => setSyncResult(null)}
              aria-label="Chiudi risultato"
            >
              <X size={18} />
            </button>
          </div>

          {syncResult.error ? (
            <p style={{ color: "#b91c1c" }}>
              {syncResult.error}
            </p>
          ) : (
            <div className="mini-meta">
              <span>
                Letti da Mexal: {syncResult.letti_mexal ?? 0}
              </span>
              <span>
                Selezionati: {syncResult.selezionati ?? 0}
              </span>
              <span>
                Inseriti: {syncResult.inseriti ?? 0}
              </span>
              <span>
                Aggiornati: {syncResult.aggiornati ?? 0}
              </span>
              <span>
                Immagini: {syncResult.immagini_salvate ?? 0}
              </span>
              <span>
                Errori: {syncResult.errori?.length ?? 0}
              </span>
              <span>
                Modalità:{" "}
                {syncResult.dry_run ? "Test" : "Reale"}
              </span>
            </div>
          )}

          {Array.isArray(syncResult.errori) &&
            syncResult.errori.length > 0 && (
              <div
                style={{
                  marginTop: "14px",
                  maxHeight: "220px",
                  overflow: "auto",
                }}
              >
                {syncResult.errori.map((item, index) => (
                  <div
                    key={`${item.codice}-${index}`}
                    style={{
                      padding: "8px 0",
                      borderTop: "1px solid #e5e7eb",
                    }}
                  >
                    <strong>{item.codice}</strong>
                    <div>{item.errore}</div>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      <div className="product-layout">
        <div className="panel product-list-panel">
          <div className="panel-header">
            <h3>Archivio prodotti</h3>
            <span>{filtered.length}</span>
          </div>

          <div className="v4-list compact-list">
            {filtered.map((product) => (
              <button
                key={product.id}
                className={`v4-list-main product-row ${
                  selected?.id === product.id ? "active" : ""
                }`}
                onClick={() => openEdit(product)}
              >
                <strong>{product.nome}</strong>

                <span>
                  {product.codice_mexal ||
                    product.codice ||
                    "Senza codice"}{" "}
                  ·{" "}
                  {product.brand_mexal ||
                    product.brand ||
                    "Brand non indicato"}
                </span>

                <small>
                  {product.linea_mexal || ""}
                  {product.linea_mexal ? " · " : ""}
                  {product.categoria_mexal ||
                    product.categoria ||
                    ""}
                  {(product.sottocategoria_mexal ||
                    product.sottocategoria) &&
                    ` · ${
                      product.sottocategoria_mexal ||
                      product.sottocategoria
                    }`}
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="product-detail-stack">
          {!selected ? (
            <div className="panel">
              <p className="empty-text">
                Seleziona un prodotto.
              </p>
            </div>
          ) : (
            <>
              <div className="panel product-hero">
                <span
                  className={`status-pill ${
                    selected.attivo === false ? "danger" : "done"
                  }`}
                >
                  {selected.attivo === false
                    ? "Non attivo"
                    : selected.stato || "Attivo"}
                </span>

                <h2>{selected.nome}</h2>

                <p>
                  {selected.descrizione ||
                    selected.note ||
                    "Nessuna descrizione prodotto."}
                </p>

                {(selected.immagine_catalogo_url ||
                  selected.immagine_url ||
                  selected.icona_url) && (
                  <img
                    src={
                      selected.immagine_catalogo_url ||
                      selected.immagine_url ||
                      selected.icona_url
                    }
                    alt={selected.nome}
                    style={{
                      width: "100%",
                      maxWidth: "320px",
                      maxHeight: "280px",
                      objectFit: "contain",
                      borderRadius: "14px",
                      border: "1px solid #e5e7eb",
                      background: "#ffffff",
                      margin: "14px 0",
                    }}
                  />
                )}

                <div className="mini-meta">
                  <span>
                    Codice:{" "}
                    {selected.codice_mexal ||
                      selected.codice ||
                      "-"}
                  </span>

                  <span>
                    Brand:{" "}
                    {selected.brand_mexal ||
                      selected.brand ||
                      "-"}
                  </span>

                  <span>
                    Linea: {selected.linea_mexal || "-"}
                  </span>

                  <span>
                    Categoria:{" "}
                    {selected.categoria_mexal ||
                      selected.categoria ||
                      "-"}
                  </span>

                  <span>
                    Sottocategoria:{" "}
                    {selected.sottocategoria_mexal ||
                      selected.sottocategoria ||
                      "-"}
                  </span>

                  <span>EAN: {selected.ean || "-"}</span>

                  <span>
                    Prezzo listino:{" "}
                    {selected.prezzo_listino != null
                      ? Number(
                          selected.prezzo_listino
                        ).toLocaleString("it-IT", {
                          style: "currency",
                          currency: "EUR",
                        })
                      : "-"}
                  </span>

                  <span>
                    Giacenza: {selected.giacenza ?? "-"}
                  </span>

                  <span>
                    Disponibilità:{" "}
                    {selected.disponibilita ?? "-"}
                  </span>

                  <span>
                    Sincronizzato Mexal:{" "}
                    {selected.sincronizzato_mexal
                      ? "Sì"
                      : "No"}
                  </span>

                  <span>
                    Ultimo sync:{" "}
                    {selected.ultimo_sync_mexal
                      ? new Date(
                          selected.ultimo_sync_mexal
                        ).toLocaleString("it-IT")
                      : "-"}
                  </span>
                </div>
              </div>

              <div className="v4-split equal">
                <div className="panel">
                  <div className="panel-header">
                    <h3>
                      <Folder size={18} />
                      Progetti collegati
                    </h3>
                  </div>

                  {productLinks.length === 0 ? (
                    <p className="empty-text">
                      Nessun progetto collegato.
                    </p>
                  ) : (
                    <div className="v4-list">
                      {productLinks.map((link) => (
                        <div
                          className="v4-list-row"
                          key={link.id}
                        >
                          <div className="v4-list-main">
                            <strong>
                              {link.v4_progetti?.titolo ||
                                link.prodotto_nome ||
                                "Progetto"}
                            </strong>
                            <span>
                              {link.v4_progetti?.stato || "-"}
                            </span>
                            <small>
                              Deadline{" "}
                              {link.v4_progetti?.deadline || "-"}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <h3>
                      <FileArchive size={18} />
                      Documentazione
                    </h3>
                  </div>

                  {productDocs.length === 0 ? (
                    <p className="empty-text">
                      Nessun documento collegato.
                    </p>
                  ) : (
                    <div className="v4-list">
                      {productDocs.map((document) => (
                        <a
                          className="v4-list-main doc-link"
                          href={document.file_url || "#"}
                          target="_blank"
                          rel="noreferrer"
                          key={document.id}
                        >
                          <strong>{document.titolo}</strong>
                          <span>
                            {document.tipo_documento ||
                              document.tipo ||
                              document.categoria_nome ||
                              "Documento"}
                          </span>
                          <small>
                            {document.codice_documento ||
                              document.codice ||
                              ""}
                          </small>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h3>Storico attività prodotto</h3>
                </div>

                {productPhases.length === 0 ? (
                  <p className="empty-text">
                    Nessuna fase collegata tramite progetti
                    prodotto.
                  </p>
                ) : (
                  <div className="v4-list">
                    {productPhases.map((phase) => (
                      <div
                        className="v4-list-row"
                        key={phase.id}
                      >
                        <div className="v4-list-main">
                          <strong>{phase.titolo}</strong>
                          <span>
                            {phase.v4_progetti?.titolo ||
                              "Progetto"}
                          </span>
                          <small>
                            {phase.stato || "Da evadere"} ·{" "}
                            {phase.deadline ||
                              "Senza deadline"}
                          </small>
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
          <form
            className="modal-card v4-modal"
            onSubmit={saveProduct}
          >
            <div className="modal-header">
              <div>
                <h2>
                  {selected?.id
                    ? "Modifica prodotto"
                    : "Nuovo prodotto"}
                </h2>

                <p>
                  {selected?.id
                    ? "Aggiorna dati prodotto o elimina prodotto e collegamenti."
                    : "Inserisci un nuovo prodotto in archivio."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <label>
              Nome *
              <input
                value={form.nome}
                onChange={(event) =>
                  updateForm("nome", event.target.value)
                }
                autoFocus
              />
            </label>

            <div className="form-grid-2">
              <label>
                Codice
                <input
                  value={form.codice}
                  onChange={(event) =>
                    updateForm("codice", event.target.value)
                  }
                />
              </label>

              <label>
                Brand
                <input
                  value={form.brand}
                  onChange={(event) =>
                    updateForm("brand", event.target.value)
                  }
                />
              </label>

              <label>
                Categoria
                <input
                  value={form.categoria}
                  onChange={(event) =>
                    updateForm(
                      "categoria",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Sottocategoria
                <input
                  value={form.sottocategoria}
                  onChange={(event) =>
                    updateForm(
                      "sottocategoria",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Stato
                <input
                  value={form.stato}
                  onChange={(event) =>
                    updateForm("stato", event.target.value)
                  }
                />
              </label>

              <label>
                Attivo
                <select
                  value={form.attivo ? "true" : "false"}
                  onChange={(event) =>
                    updateForm(
                      "attivo",
                      event.target.value === "true"
                    )
                  }
                >
                  <option value="true">Sì</option>
                  <option value="false">No</option>
                </select>
              </label>
            </div>

            <label>
              Descrizione
              <textarea
                rows="4"
                value={form.descrizione}
                onChange={(event) =>
                  updateForm(
                    "descrizione",
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Note
              <textarea
                rows="3"
                value={form.note}
                onChange={(event) =>
                  updateForm("note", event.target.value)
                }
              />
            </label>

            <div className="dashboard-message-actions">
              {selected?.id && canManageProducts && (
                <button
                  type="button"
                  className="secondary-action danger"
                  onClick={deleteProduct}
                  disabled={deleting}
                >
                  <Trash2 size={18} />
                  {deleting
                    ? "Eliminazione..."
                    : "Elimina prodotto"}
                </button>
              )}

              <button
                type="button"
                className="secondary-action"
                onClick={() => setModalOpen(false)}
              >
                Annulla
              </button>

              <button
                type="submit"
                className="primary-action"
                disabled={saving}
              >
                <Save size={18} />
                {saving
                  ? "Salvataggio..."
                  : "Salva prodotto"}
              </button>
            </div>
          </form>
        </div>
      )}

      <style>{`
        .spin {
          animation: product-sync-spin 1s linear infinite;
        }

        @keyframes product-sync-spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

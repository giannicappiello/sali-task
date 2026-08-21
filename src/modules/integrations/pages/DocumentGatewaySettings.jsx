import { useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../contexts/AuthContext";
import "../../../pages/Documentation/Documentation.css";

async function documentApi(action, extra = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch("/api/mexal/automation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    },
    body: JSON.stringify({ action: `document_${action}`, ...extra }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Errore ${response.status}`);
  return body;
}

const emptySection = {
  nome: "",
  cartella_nas: "",
  descrizione: "",
  ordinamento: 0,
  attiva: true,
};
const sameId = (left, right) =>
  String(left ?? "").trim() === String(right ?? "").trim();

export default function DocumentGatewaySettings() {
  const { hasPermission } = useAuth();
  const canConfigure = hasPermission("integrations.configure");
  const [sections, setSections] = useState([]),
    [documents, setDocuments] = useState([]),
    [products, setProducts] = useState([]),
    [productCategories, setProductCategories] = useState([]),
    [editor, setEditor] = useState(null),
    [documentEditor, setDocumentEditor] = useState(null);
  const [syncConfig, setSyncConfig] = useState(null),
    [syncRuns, setSyncRuns] = useState([]),
    [savingAutomatic, setSavingAutomatic] = useState(false),
    [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(true),
    [syncing, setSyncing] = useState(false),
    [query, setQuery] = useState(""),
    [onlyUnlinked, setOnlyUnlinked] = useState(false),
    [message, setMessage] = useState(null);
  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [result, productResult, categoryResult] = await Promise.all([
        documentApi("admin_list"),
        supabase
          .from("prodotti")
          .select("id,nome,codice,codice_mexal,json_mexal,brand_mexal,linea_mexal")
          .eq("attivo_mexal", true)
          .eq("mostra_in_app", true)
          .order("nome")
          .limit(5000),
        supabase
          .from("mexal_categorie_prodotti")
          .select("nome,numero_prodotti")
          .eq("attiva", true)
          .order("nome"),
      ]);
      if (productResult.error) throw productResult.error;
      if (categoryResult.error) throw categoryResult.error;
      setSections(result.sections || []);
      setDocuments(result.documents || []);
      setProducts(productResult.data || []);
      setProductCategories(categoryResult.data || []);
      setSyncConfig(result.syncConfig || null);
      setSyncRuns(result.syncRuns || []);
      setSyncing(
        (result.syncRuns || []).some((run) =>
          ["in_coda", "in_esecuzione"].includes(run.stato),
        ),
      );
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!syncing) return undefined;
    const timer = window.setInterval(() => load(true), 3000);
    return () => window.clearInterval(timer);
  }, [syncing]);
  const visibleDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it");
    return documents.filter(
      (item) =>
        (!onlyUnlinked ||
          (!item.prodotto_id && !(item.categorie_prodotto || []).length)) &&
        (!needle ||
          [item.titolo, item.nome_file, item.percorso]
            .join(" ")
            .toLocaleLowerCase("it")
            .includes(needle)),
    );
  }, [documents, query, onlyUnlinked]);
  async function toggleAutomatic() {
    setSavingAutomatic(true);
    try {
      const result = await documentApi("sync_config_save", {
        enabled: !syncConfig?.automatica_attiva,
      });
      setSyncConfig(result.config);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSavingAutomatic(false);
    }
  }
  async function stopSync() {
    setStopping(true);
    try {
      await documentApi("sync_stop");
      setMessage({
        type: "success",
        text: "Arresto richiesto. La sincronizzazione si fermerà al termine del blocco in corso.",
      });
      await load(true);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setStopping(false);
    }
  }
  async function synchronize() {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await documentApi("sync");
      await load();
      setMessage({
        type: "success",
        text: `${result.count} file indicizzati. ${result.removed || 0} file non più presenti rimossi dall'indice.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSyncing(false);
    }
  }
  async function saveSection(event) {
    event.preventDefault();
    try {
      await documentApi("section_save", { section: editor });
      setEditor(null);
      await load();
      setMessage({
        type: "success",
        text: "Sezione salvata. Esegui la sincronizzazione per applicare la cartella ai documenti.",
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }
  async function deleteSection(section) {
    if (
      !(await window.workspaceConfirm(
        `Eliminare la sezione “${section.nome}”? I file sul NAS non verranno cancellati.`,
      ))
    )
      return;
    try {
      await documentApi("section_delete", { id: section.id });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }
  async function saveDocument(event) {
    event.preventDefault();
    try {
      const currentProduct = products.find(
        (item) => sameId(item.id, documentEditor.prodotto_id),
      );
      const code = String(
        documentEditor.product_code ??
          currentProduct?.codice_mexal ??
          currentProduct?.codice ??
          "",
      )
        .trim()
        .toUpperCase();
      const product = code
        ? products.find(
            (item) =>
              String(item.codice_mexal || item.codice || "")
                .trim()
                .toUpperCase() === code,
          )
        : null;
      if (code && !product)
        throw new Error("Seleziona un prodotto valido dall'elenco Workspace.");
      await documentApi("update", {
        id: documentEditor.id,
        changes: {
          titolo: documentEditor.titolo.trim(),
          sezione_id: documentEditor.sezione_id || null,
          marca: documentEditor.marca.trim() || null,
          gamma: documentEditor.gamma.trim() || null,
          prodotto_id: product?.id || null,
          prodotto: product?.nome || null,
          categorie_prodotto: documentEditor.categorie_prodotto || [],
          brand_prodotti: documentEditor.brand_prodotti || [],
          linee_prodotto: documentEditor.linee_prodotto || [],
          parole_chiave: documentEditor.keywords
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      setDocumentEditor(null);
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }
  function toggleDocumentCategory(name) {
    const selected = documentEditor.categorie_prodotto || [];
    setDocumentEditor({
      ...documentEditor,
      categorie_prodotto: selected.includes(name)
        ? selected.filter((value) => value !== name)
        : [...selected, name],
    });
  }
  const productBrands = useMemo(() => [...new Set(products.map((item) => String(item.brand_mexal || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")), [products]);
  const productLines = useMemo(() => [...new Set(products.map((item) => String(item.linea_mexal || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")), [products]);
  function toggleDocumentGroup(field, name) { const selected = documentEditor[field] || []; setDocumentEditor({ ...documentEditor, [field]: selected.includes(name) ? selected.filter((value) => value !== name) : [...selected, name] }); }
  return (
    <div className="integrations-page document-integration-page">
      {message && (
        <div className={`document-integration-message ${message.type}`}>
          {message.text}
        </div>
      )}
      <section className="mexal-settings-panel">
        <div className="mexal-section-heading">
          <div>
            <h3>Sincronizzazione documentale</h3>
            <p>
              Il cron Aruba controlla la pianificazione ogni 10 minuti.
              L'esecuzione automatica è indipendente dalle sincronizzazioni
              Mexal.
            </p>
          </div>
          <div className="document-sync-actions">
            {canConfigure && <label className="mexal-toggle-row">
              <input
                type="checkbox"
                checked={syncConfig?.automatica_attiva === true}
                disabled={savingAutomatic}
                onChange={toggleAutomatic}
              />
              <span>
                <strong>Sincronizzazione automatica</strong>
                <small>
                  {syncConfig?.automatica_attiva ? "Attiva" : "Disattiva"}
                </small>
              </span>
            </label>}
            {syncing ? (
              <button
                type="button"
                className="danger-action"
                onClick={stopSync}
                disabled={stopping}
              >
                {stopping ? "Arresto..." : "Arresta sincronizzazione"}
              </button>
            ) : (
              <button
                type="button"
                className="primary-action"
                onClick={synchronize}
              >
                <RefreshCw size={17} /> Avvia manualmente
              </button>
            )}
          </div>
        </div>
        <div className="document-sync-stats">
          <div>
            <span>Ultima esecuzione</span>
            <strong>
              {syncConfig?.ultima_esecuzione_il
                ? new Date(syncConfig.ultima_esecuzione_il).toLocaleString(
                    "it-IT",
                  )
                : "Mai"}
            </strong>
          </div>
          <div>
            <span>Prossima esecuzione</span>
            <strong>
              {syncConfig?.automatica_attiva &&
              syncConfig?.prossima_esecuzione_il
                ? new Date(syncConfig.prossima_esecuzione_il).toLocaleString(
                    "it-IT",
                  )
                : "Non programmata"}
            </strong>
          </div>
          <div>
            <span>Stato</span>
            <strong>{syncConfig?.ultimo_stato || "Mai eseguita"}</strong>
          </div>
          <div>
            <span>File indicizzati</span>
            <strong>{documents.length}</strong>
          </div>
        </div>
        {syncConfig?.ultimo_errore && (
          <div className="document-integration-message error">
            {syncConfig.ultimo_errore}
          </div>
        )}
        <div className="mexal-history-table-wrap">
          <table className="mexal-history-table">
            <thead>
              <tr>
                <th>Avvio</th>
                <th>Origine</th>
                <th>Stato</th>
                <th>Avanzamento</th>
                <th>Rimossi</th>
                <th>Durata</th>
                <th>Errore</th>
              </tr>
            </thead>
            <tbody>
              {syncRuns.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.iniziata_il).toLocaleString("it-IT")}</td>
                  <td>{run.origine}</td>
                  <td>
                    <span
                      className={`mexal-rule-status ${run.stato === "completata" ? "is-active" : run.stato === "errore" ? "is-inactive" : ""}`}
                    >
                      {run.stato}
                    </span>
                  </td>
                  <td>
                    {run.file_elaborati} / {run.file_totali || "—"}
                  </td>
                  <td>{run.file_rimossi}</td>
                  <td>
                    {run.completata_il
                      ? `${Math.max(0, Math.round((new Date(run.completata_il) - new Date(run.iniziata_il)) / 1000))} s`
                      : "In corso"}
                  </td>
                  <td>{run.errore || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!syncRuns.length && (
            <div className="mexal-empty-state">
              Nessuna sincronizzazione documentale registrata.
            </div>
          )}
        </div>
      </section>
      <section className="mexal-settings-panel">
        <div className="mexal-section-heading">
          <div>
            <h3>Sezioni documentali</h3>
            <p>
              Il percorso è relativo alla cartella condivisa WorkspaceDocumenti.
              Esempio: <strong>Cataloghi</strong> oppure{" "}
              <strong>Video/Presentazioni</strong>.
            </p>
          </div>
          {canConfigure && <button
            type="button"
            className="orders-primary"
            onClick={() =>
              setEditor({
                ...emptySection,
                ordinamento: (sections.length + 1) * 10,
              })
            }
          >
            <Plus size={17} /> Nuova sezione
          </button>}
        </div>
        <div className="document-section-admin-grid">
          {sections.map((section) => (
            <article className="document-section-admin-card" key={section.id}>
              {canConfigure && <div>
                <strong>{section.nome}</strong>
                <small>Cartella NAS: {section.cartella_nas}</small>
                <p>{section.descrizione || "Nessuna descrizione"}</p>
              </div>}
              <div>
                <button type="button" onClick={() => setEditor({ ...section })}>
                  <Pencil size={16} /> Modifica
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => deleteSection(section)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="mexal-settings-panel">
        <div className="mexal-section-heading">
          <div>
            <h3>Documenti indicizzati</h3>
            <p>Classifica i singoli file e verifica la cartella rilevata.</p>
          </div>
          <div className="document-list-controls">
            <label className="mexal-toggle-row document-unlinked-filter">
              <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} />
              <span><strong>Solo non associati</strong><small>Senza prodotto o categoria</small></span>
            </label>
            <label className="documentation-search document-admin-search">
              <Search size={17} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca file..." />
            </label>
          </div>
        </div>
        <div className="mexal-history-table-wrap">
          <table className="mexal-history-table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Percorso NAS</th>
                <th>Sezione</th>
                <th>Dimensione</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((document) => (
                <tr key={document.id}>
                  <td>
                    <strong>{document.titolo}</strong>
                  </td>
                  <td>
                    <small>{document.percorso}</small>
                  </td>
                  <td>
                    {sections.find(
                      (section) => section.id === document.sezione_id,
                    )?.nome || (
                      <span className="document-unassigned">Non assegnato</span>
                    )}
                  </td>
                  <td>
                    {(document.dimensione / 1048576).toLocaleString("it-IT", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    MB
                  </td>
                  <td>
                    {canConfigure && <button
                      type="button"
                      onClick={() =>
                        setDocumentEditor((() => {
                          const linkedProduct = products.find((product) =>
                            sameId(product.id, document.prodotto_id),
                          );
                          return {
                            ...document,
                            product_code:
                              linkedProduct?.codice_mexal ||
                              linkedProduct?.codice ||
                              "",
                            keywords: (document.parole_chiave || []).join(", "),
                          };
                        })())
                      }
                    >
                      <Pencil size={16} />
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !visibleDocuments.length && (
            <div className="mexal-empty-state">
              Nessun documento indicizzato.
            </div>
          )}
        </div>
      </section>
      {editor && (
        <div className="documentation-modal">
          <form className="documentation-editor panel" onSubmit={saveSection}>
            <header>
              <h3>{editor.id ? "Modifica sezione" : "Nuova sezione"}</h3>
              <button type="button" data-shortcut-close onClick={() => setEditor(null)}>
                <X />
              </button>
            </header>
            <label>
              Nome visualizzato
              <input
                required
                value={editor.nome}
                onChange={(e) => setEditor({ ...editor, nome: e.target.value })}
              />
            </label>
            <label>
              Cartella NAS
              <input
                required
                value={editor.cartella_nas}
                onChange={(e) =>
                  setEditor({ ...editor, cartella_nas: e.target.value })
                }
                placeholder="es. Schede Tecniche"
              />
            </label>
            <label>
              Descrizione
              <input
                value={editor.descrizione || ""}
                onChange={(e) =>
                  setEditor({ ...editor, descrizione: e.target.value })
                }
              />
            </label>
            <label>
              Ordine
              <input
                type="number"
                value={editor.ordinamento}
                onChange={(e) =>
                  setEditor({ ...editor, ordinamento: Number(e.target.value) })
                }
              />
            </label>
            <footer>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setEditor(null)}
              >
                Annulla
              </button>
              <button type="submit" className="primary-action">
                Salva
              </button>
            </footer>
          </form>
        </div>
      )}
      {documentEditor && (
        <div className="documentation-modal">
          <form className="documentation-editor panel" onSubmit={saveDocument}>
            <header>
              <h3>Classifica documento</h3>
              <button type="button" data-shortcut-close onClick={() => setDocumentEditor(null)}>
                <X />
              </button>
            </header>
            <label>
              Titolo
              <input
                required
                value={documentEditor.titolo}
                onChange={(e) =>
                  setDocumentEditor({
                    ...documentEditor,
                    titolo: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Sezione
              <select
                value={documentEditor.sezione_id || ""}
                onChange={(e) =>
                  setDocumentEditor({
                    ...documentEditor,
                    sezione_id: e.target.value,
                  })
                }
              >
                <option value="">Non assegnato</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prodotto Workspace
              <input
                list="workspace-document-products"
                value={documentEditor.product_code}
                onChange={(e) =>
                  setDocumentEditor({
                    ...documentEditor,
                    product_code: e.target.value,
                  })
                }
                placeholder="Digita codice o seleziona dall'elenco"
              />
              <datalist id="workspace-document-products">
                {products.map((product) => {
                  const code = product.codice_mexal || product.codice;
                  return (
                    <option key={product.id} value={code}>
                      {product.nome}
                    </option>
                  );
                })}
              </datalist>
            </label>
            <div className="documentation-form-grid">
              <label>
                Marca
                <input
                  value={documentEditor.marca || ""}
                  onChange={(e) =>
                    setDocumentEditor({
                      ...documentEditor,
                      marca: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Gamma
                <input
                  value={documentEditor.gamma || ""}
                  onChange={(e) =>
                    setDocumentEditor({
                      ...documentEditor,
                      gamma: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <label>
              Parole chiave
              <input
                value={documentEditor.keywords}
                onChange={(e) =>
                  setDocumentEditor({
                    ...documentEditor,
                    keywords: e.target.value,
                  })
                }
              />
            </label>
            {[["Categorie prodotto", "categorie_prodotto", productCategories.map((item) => ({ name: item.nome, count: item.numero_prodotti }))], ["Brand", "brand_prodotti", productBrands.map((name) => ({ name }))], ["Linea", "linee_prodotto", productLines.map((name) => ({ name }))]].map(([title, field, options]) => (
              <section className="documentation-link-section" key={field}>
                <div><strong>{title}</strong><small>Selezione multipla: il documento sarà collegato a tutti i prodotti corrispondenti.</small></div>
                <div className="documentation-category-list">
                  {options.map((option) => <label key={option.name} className="documentation-category-option"><input type="checkbox" checked={(documentEditor[field] || []).includes(option.name)} onChange={() => field === "categorie_prodotto" ? toggleDocumentCategory(option.name) : toggleDocumentGroup(field, option.name)} /><span>{option.name}{option.count != null ? ` (${option.count})` : ""}</span></label>)}
                </div>
                {!options.length && <div className="documentation-product-empty">Nessun valore disponibile. Sincronizza prima prodotti e categorie da Mexal ERP.</div>}
                <small className="documentation-category-summary">{(documentEditor[field] || []).length} selezionati</small>
              </section>
            ))}
            <footer>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setDocumentEditor(null)}
              >
                Annulla
              </button>
              <button type="submit" className="primary-action">
                Salva
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

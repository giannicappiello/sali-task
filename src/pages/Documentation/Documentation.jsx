import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Film,
  FolderOpen,
  Image,
  Library,
  Link2,
  Pencil,
  Search,
  Unlink,
  X,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  MANUALS_SECTION_FOLDER,
  scopeDocumentLibrary,
} from "./documentSectionScope";
import "./Documentation.css";
import "./DocumentationSections.css";

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


const sectionIcon = (name) =>
  /video/i.test(name)
    ? Film
    : /catalog/i.test(name)
      ? BookOpen
      : /schede|tecnic/i.test(name)
        ? FileText
        : FolderOpen;
function formatSize(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** index).toLocaleString("it-IT", { maximumFractionDigits: 1 })} ${units[index]}`;
}
const sameId = (left, right) =>
  String(left ?? "").trim() === String(right ?? "").trim();
const associationValues = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
const hasDocumentAssociation = (document) =>
  Boolean(
    document.prodotto_id ||
      associationValues(document.categorie_prodotto).length ||
      associationValues(document.brand_prodotti).length ||
      associationValues(document.linee_prodotto).length,
  );

function DocumentThumbnail({ document, url }) {
  if (!url)
    return (
      <span className={`documentation-file-icon ${document.mime_group}`}>
        {document.mime_group === "video" ? (
          <Film size={26} />
        ) : document.mime_group === "immagine" ? (
          <Image size={26} />
        ) : (
          <FileText size={26} />
        )}
      </span>
    );
  if (document.mime_group === "immagine")
    return (
      <img
        className="documentation-thumbnail"
        src={url}
        alt=""
        loading="lazy"
      />
    );
  if (document.mime_group === "video")
    return (
      <video
        className="documentation-thumbnail"
        src={url}
        muted
        preload="metadata"
      />
    );
  return (
    <iframe
      className="documentation-thumbnail documentation-pdf-thumbnail"
      src={`${url}#page=1&toolbar=0&navpanes=0`}
      title=""
      tabIndex="-1"
    />
  );
}

export default function Documentation({
  includeSectionFolder = null,
  excludeSectionFolder = MANUALS_SECTION_FOLDER,
  title = "Documenti",
  description = "Consulta schede tecniche, cataloghi e video aziendali.",
  searchPlaceholder = "Ricerca rapida in tutti i documenti...",
}) {
  const singleSectionMode = Boolean(includeSectionFolder);
  const [documents, setDocuments] = useState([]),
    [sections, setSections] = useState([]),
    [selectedSection, setSelectedSection] = useState(null);
  const [query, setQuery] = useState(""),
    [onlyUnlinked, setOnlyUnlinked] = useState(false),
    [preview, setPreview] = useState(null),
    [thumbnailUrls, setThumbnailUrls] = useState({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false),
    [products, setProducts] = useState([]),
    [linkEditor, setLinkEditor] = useState(null),
    [savingLink, setSavingLink] = useState(false);

  useEffect(() => {
    documentApi("list")
      .then(async (result) => {
        const scoped = scopeDocumentLibrary(
          result.sections || [],
          result.documents || [],
          {
            includeFolder: includeSectionFolder,
            excludeFolder: includeSectionFolder ? null : excludeSectionFolder,
          },
        );
        setDocuments(scoped.documents);
        setSections(scoped.sections);
        if (singleSectionMode) setSelectedSection(scoped.sections[0] || null);
        setIsAdmin(result.isAdmin === true);
        if (result.isAdmin === true) {
          const { data, error: productsError } = await supabase
            .from("prodotti")
            .select("id,nome,codice,codice_mexal,categoria_mexal,brand_mexal,linea_mexal")
            .eq("attivo_mexal", true)
            .eq("mostra_in_app", true)
            .order("nome")
            .limit(5000);
          if (productsError) throw productsError;
          setProducts(data || []);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [excludeSectionFolder, includeSectionFolder, singleSectionMode]);

  const counts = useMemo(
    () =>
      new Map(
        sections.map((section) => [
          section.id,
          documents.filter((item) => item.sezione_id === section.id).length,
        ]),
      ),
    [sections, documents],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it");
    return documents.filter(
      (item) =>
        (!selectedSection || item.sezione_id === selectedSection.id) &&
        (!onlyUnlinked || !hasDocumentAssociation(item)) &&
        (!needle ||
          [
            item.titolo,
            item.nome_file,
            item.marca,
            item.gamma,
            item.prodotto,
            ...associationValues(item.categorie_prodotto),
            ...associationValues(item.brand_prodotti),
            ...associationValues(item.linee_prodotto),
            ...(item.parole_chiave || []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("it")
            .includes(needle)),
    );
  }, [documents, selectedSection, query, onlyUnlinked]);
  const visibleIds = visible
    .slice(0, 100)
    .map((item) => item.id)
    .join(",");
  useEffect(() => {
    if ((!selectedSection && !query && !onlyUnlinked) || !visibleIds) return;
    documentApi("urls", { ids: visibleIds.split(",") })
      .then((result) => setThumbnailUrls(result.urls || {}))
      .catch(() => {});
  }, [selectedSection, query, onlyUnlinked, visibleIds]);

  function associationDetails(document) {
    const details = [];
    if (document.prodotto_id) {
      const linkedProduct = products.find((product) =>
        sameId(product.id, document.prodotto_id),
      );
      const productLabel = linkedProduct
        ? [
            linkedProduct.codice_mexal || linkedProduct.codice,
            linkedProduct.nome,
          ]
            .filter(Boolean)
            .join(" · ")
        : document.prodotto || "Prodotto collegato";
      details.push(productLabel);
    }
    const groups = [
      ["Categorie", associationValues(document.categorie_prodotto)],
      ["Brand", associationValues(document.brand_prodotti)],
      ["Linee", associationValues(document.linee_prodotto)],
    ];
    groups.forEach(([label, values]) => {
      if (values.length) details.push(`${label}: ${values.join(", ")}`);
    });
    return details.join(" · ");
  }

  async function openDocument(document) {
    try {
      const { url } = await documentApi("url", { id: document.id });
      setPreview({ ...document, url });
    } catch (err) {
      setError(err.message);
    }
  }
  function editProductLink(document) {
    const linked = products.find(
      (product) => sameId(product.id, document.prodotto_id),
    );
    setLinkEditor({
      ...document,
      prodotto_id: document.prodotto_id || "",
      categorie_prodotto: document.categorie_prodotto || [],
      brand_prodotti: document.brand_prodotti || [],
      linee_prodotto: document.linee_prodotto || [],
      product_query: linked
        ? `${linked.codice_mexal || linked.codice || ""} ${linked.nome || ""}`.trim()
        : "",
      category_query: "",
    });
  }
  const matchingProducts = useMemo(() => {
    const needle = String(linkEditor?.product_query || "")
      .trim()
      .toLocaleLowerCase("it");
    const rows = needle
      ? products.filter((product) =>
          [product.codice_mexal, product.codice, product.nome]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("it")
            .includes(needle),
        )
      : products;
    return rows.slice(0, 150);
  }, [products, linkEditor?.product_query]);
  const productCategories = useMemo(
    () =>
      [
        ...new Set(
          products
            .map((product) => String(product.categoria_mexal || "").trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, "it", { numeric: true })),
    [products],
  );
  const matchingCategories = useMemo(() => {
    const needle = String(linkEditor?.category_query || "")
      .trim()
      .toLocaleLowerCase("it");
    return productCategories.filter(
      (category) =>
        !needle || category.toLocaleLowerCase("it").includes(needle),
    );
  }, [productCategories, linkEditor?.category_query]);
  function toggleCategory(category) {
    const selected = linkEditor.categorie_prodotto || [];
    setLinkEditor({
      ...linkEditor,
      categorie_prodotto: selected.includes(category)
        ? selected.filter((value) => value !== category)
        : [...selected, category],
    });
  }
  const productBrands = useMemo(() => [...new Set(products.map((item) => String(item.brand_mexal || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")), [products]);
  const productLines = useMemo(() => [...new Set(products.map((item) => String(item.linea_mexal || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")), [products]);
  function toggleGroup(field, value) { const selected = linkEditor[field] || []; setLinkEditor({ ...linkEditor, [field]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value] }); }
  async function saveProductLink(event) {
    event.preventDefault();
    setSavingLink(true);
    setError("");
    try {
      const product = products.find(
        (item) => sameId(item.id, linkEditor.prodotto_id),
      );
      if (linkEditor.prodotto_id && !product) {
        throw new Error("Il prodotto selezionato non è più disponibile. Selezionalo nuovamente dall'elenco.");
      }
      const result = await documentApi("update", {
        id: linkEditor.id,
        changes: {
          prodotto_id: product?.id || null,
          prodotto: product?.nome || null,
          categorie_prodotto: linkEditor.categorie_prodotto || [],
          brand_prodotti: linkEditor.brand_prodotti || [],
          linee_prodotto: linkEditor.linee_prodotto || [],
        },
      });
      setDocuments((current) =>
        current.map((item) =>
          item.id === result.document.id ? result.document : item,
        ),
      );
      setLinkEditor(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingLink(false);
    }
  }

  return (
    <div className="documentation-page v4-page">
      <div className="documentation-hero">
        <div className="documentation-heading">
          <Library size={30} />
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
        {!singleSectionMode && <Link className="documentation-private-link" to="/documentation/private"><FileText size={18}/>Documenti Private</Link>}
      </div>
      <div className="documentation-material-toolbar">
        <label className="documentation-search documentation-global-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        <label className="documentation-unlinked-filter">
          <input
            type="checkbox"
            checked={onlyUnlinked}
            onChange={(event) => setOnlyUnlinked(event.target.checked)}
          />
          <Unlink size={17} />
          <span>Solo non associati</span>
        </label>
      </div>
      {error && <div className="documentation-error">{error}</div>}
      {!singleSectionMode && !selectedSection && !query && !onlyUnlinked && (
        <div className="documentation-sections">
          {sections.map((section) => {
            const Icon = sectionIcon(section.nome);
            return (
              <button
                type="button"
                className="documentation-section-card panel"
                key={section.id}
                onClick={() => setSelectedSection(section)}
              >
                <span>
                  <Icon size={30} />
                </span>
                <div>
                  <strong>{section.nome}</strong>
                  <p>{section.descrizione || "Apri la raccolta documentale"}</p>
                  <small>{counts.get(section.id) || 0} documenti</small>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {(singleSectionMode || selectedSection || query || onlyUnlinked) && (
        <>
          <div className="documentation-list-heading">
            {selectedSection && !singleSectionMode ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setSelectedSection(null);
                  setQuery("");
                  setOnlyUnlinked(false);
                }}
              >
                <ArrowLeft size={17} /> Tutte le sezioni
              </button>
            ) : (
              <span />
            )}
            <strong>
              {(singleSectionMode ? title : selectedSection?.nome) ||
                (onlyUnlinked
                  ? "Materiali non associati"
                  : "Risultati della ricerca")} ·{" "}
              {visible.length}
            </strong>
          </div>
          <div className="documentation-grid">
            {visible.map((document) => {
              const associated = hasDocumentAssociation(document);
              const association = associationDetails(document);
              return (
              <article className="documentation-card panel" key={document.id}>
                <button
                  type="button"
                  className="documentation-card-main"
                  onClick={() => openDocument(document)}
                >
                  <DocumentThumbnail
                    document={document}
                    url={thumbnailUrls[document.id]}
                  />
                  <span className="documentation-card-copy">
                    <strong>{document.titolo}</strong>
                    <small>{formatSize(document.dimensione)}</small>
                    <span>
                      {[document.marca, document.gamma, document.prodotto]
                        .filter(Boolean)
                        .join(" · ") || document.nome_file}
                    </span>
                    {associated && (
                      <span
                        className="documentation-link-status is-linked"
                        title={association}
                      >
                        <small>{association}</small>
                      </span>
                    )}
                  </span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className="documentation-edit"
                    onClick={() => editProductLink(document)}
                    title="Collega a un prodotto Workspace"
                    aria-label={`Collega ${document.titolo} a un prodotto`}
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </article>
              );
            })}
          </div>
          {!loading && !visible.length && (
            <div className="documentation-empty panel">
              <FolderOpen size={42} />
              <h3>Nessun documento</h3>
              <p>
                La cartella non contiene documenti compatibili oppure la ricerca
                non ha prodotto risultati.
              </p>
            </div>
          )}
        </>
      )}
      {loading && (
        <div className="documentation-empty panel">Caricamento archivio...</div>
      )}
      {preview && (
        <div className="documentation-modal" role="dialog" aria-modal="true">
          <div className="documentation-viewer panel">
            <header>
              <div>
                <strong>{preview.titolo}</strong>
                <small>{preview.nome_file}</small>
              </div>
              <button type="button" data-shortcut-close onClick={() => setPreview(null)}>
                <X />
              </button>
            </header>
            <div className="documentation-viewer-body">
              {preview.mime_group === "video" ? (
                <video src={preview.url} controls autoPlay />
              ) : preview.mime_group === "immagine" ? (
                <img src={preview.url} alt={preview.titolo} />
              ) : (
                <iframe src={preview.url} title={preview.titolo} />
              )}
            </div>
            <footer>
              <a
                className="primary-action"
                href={preview.url}
                target="_blank"
                rel="noreferrer"
              >
                Apri / scarica
              </a>
            </footer>
          </div>
        </div>
      )}
      {linkEditor && (
        <div className="documentation-modal" role="dialog" aria-modal="true">
          <form
            className="documentation-editor documentation-link-editor panel"
            onSubmit={saveProductLink}
          >
            <header>
              <div>
                <h3>Collega documento ai prodotti</h3>
                <small>{linkEditor.titolo}</small>
              </div>
              <button type="button" data-shortcut-close onClick={() => setLinkEditor(null)}>
                <X />
              </button>
            </header>
            <section className="documentation-link-section">
              <div>
                <strong>Prodotto singolo</strong>
                <small>Collegamento diretto facoltativo</small>
              </div>
              <label>
                Ricerca prodotto
                <input
                  autoFocus
                  value={linkEditor.product_query}
                  onChange={(event) =>
                    setLinkEditor({
                      ...linkEditor,
                      product_query: event.target.value,
                    })
                  }
                  placeholder="Digita codice Mexal o descrizione prodotto"
                />
              </label>
              <label>
                Prodotto Workspace
                <select
                  size={Math.min(7, Math.max(3, matchingProducts.length + 1))}
                  value={linkEditor.prodotto_id}
                  onChange={(event) => {
                    const prodottoId = event.target.value;
                    const selectedProduct = products.find((product) =>
                      sameId(product.id, prodottoId),
                    );
                    setLinkEditor({
                      ...linkEditor,
                      prodotto_id: prodottoId,
                      product_query: selectedProduct
                        ? `${selectedProduct.codice_mexal || selectedProduct.codice || ""} ${selectedProduct.nome || ""}`.trim()
                        : linkEditor.product_query,
                    });
                  }}
                >
                  <option value="">Nessun prodotto selezionato</option>
                  {matchingProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {[product.codice_mexal || product.codice, product.nome]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
              {!matchingProducts.length && (
                <div className="documentation-product-empty">
                  Nessun prodotto corrispondente.
                </div>
              )}
              <button
                type="button"
                className="documentation-inline-unlink"
                onClick={() =>
                  setLinkEditor({
                    ...linkEditor,
                    prodotto_id: "",
                    product_query: "",
                  })
                }
              >
                <Unlink size={15} /> Rimuovi prodotto singolo
              </button>
            </section>
            <section className="documentation-link-section">
              <div>
                <strong>Categorie prodotto</strong>
                <small>
                  Il documento comparirà su tutti i prodotti delle categorie
                  selezionate
                </small>
              </div>
              <label>
                Ricerca categoria
                <input
                  value={linkEditor.category_query}
                  onChange={(event) =>
                    setLinkEditor({
                      ...linkEditor,
                      category_query: event.target.value,
                    })
                  }
                  placeholder="Digita il nome della categoria"
                />
              </label>
              <div className="documentation-category-list">
                {matchingCategories.map((category) => (
                  <label
                    key={category}
                    className="documentation-category-option"
                  >
                    <input
                      type="checkbox"
                      checked={(linkEditor.categorie_prodotto || []).includes(
                        category,
                      )}
                      onChange={() => toggleCategory(category)}
                    />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
              {!matchingCategories.length && (
                <div className="documentation-product-empty">
                  Nessuna categoria corrispondente.
                </div>
              )}
              <small className="documentation-category-summary">
                {(linkEditor.categorie_prodotto || []).length} categorie
                selezionate
              </small>
            </section>
            {[["Brand", "brand_prodotti", productBrands], ["Linea", "linee_prodotto", productLines]].map(([title, field, options]) => (
              <section className="documentation-link-section" key={field}>
                <div><strong>{title}</strong><small>Il documento comparirà su tutti i prodotti corrispondenti.</small></div>
                <div className="documentation-category-list">
                  {options.map((value) => <label key={value} className="documentation-category-option"><input type="checkbox" checked={(linkEditor[field] || []).includes(value)} onChange={() => toggleGroup(field, value)} /><span>{value}</span></label>)}
                </div>
                {!options.length && <div className="documentation-product-empty">Nessun valore disponibile.</div>}
                <small className="documentation-category-summary">{(linkEditor[field] || []).length} selezionati</small>
              </section>
            ))}
            <footer>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setLinkEditor(null)}
              >
                Annulla
              </button>
              <button
                type="submit"
                className="primary-action"
                disabled={savingLink}
              >
                <Link2 size={16} />{" "}
                {savingLink ? "Salvataggio..." : "Salva collegamenti"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

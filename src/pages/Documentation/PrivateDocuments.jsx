import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Boxes, Download, File, FileLock2, FilePlus2, FlaskConical, Folder, PackageCheck, RefreshCw, Search, Shapes, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import "./PrivateDocuments.css";
import "./PrivateDocumentsActions.css";
import "./PrivateDocumentsNasPicker.css";
import PrivateDocumentsUnassociated from "./PrivateDocumentsUnassociated";
import ProductSpecification from "./ProductSpecification";
import { documentsOnlyArticle, filterDocumentArticles, readCachedArticle, cacheArticle } from "./private-documents-catalogue";
import { archiveDocuments, createDocumentArchive } from "./private-documents-zip";

async function workspaceAction(token, action, extra = {}) {
  const response = await fetch("/api/workspace/documents", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}
async function documentRequest(session, path, options = {}) {
  const input = options.body instanceof FormData ? Object.fromEntries(options.body) : options.body;
  return workspaceAction(session.accessToken, "private_documents", { path, input });
}
const size = (bytes) => `${(Number(bytes || 0) / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 2 })} MB`;
const date = (value) => value ? new Date(value).toLocaleDateString("it-IT") : "—";

const ARTICLE_SECTIONS = [
  { id: "finished", title: "Prodotti finiti", description: "Articoli finiti e confezionati.", icon: PackageCheck },
  { id: "bulk", title: "Bulk / semilavorati", description: "Bulk e articoli intermedi di produzione.", icon: FlaskConical },
  { id: "raw", title: "Materie prime", description: "Materie prime impiegate nelle formule.", icon: Boxes },
  { id: "other", title: "Altro", description: "Articoli non compresi nelle altre tipologie.", icon: Shapes },
];


function articleSection(article) {
  const type = String(article?.articleType || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (type.includes("bulk") || type.includes("semilavor")) return "bulk";
  if (type.includes("mater") || type.includes("raw")) return "raw";
  if (type.includes("prodotto") || type.includes("finished") || type.includes("finito")) return "finished";
  return "other";
}

function DocumentList({ documents, onDownload, emptyText = "Nessun documento associato." }) {
  return <div className="private-document-list">{documents.map((document) => <article key={`${document.externalId}-${document.associationType}-${document.lotCode}`}><FileLock2/><div><strong>{document.title}</strong><span>{document.type} · Rev. {document.revision} · {document.associationType}{document.lotCode ? ` · Lotto ${document.lotCode}` : ""}</span><small>{document.originalFileName} · {size(document.sizeBytes)} · caricato il {date(document.uploadedAt)}</small></div><button onClick={() => onDownload(document)}><Download size={17}/>Scarica</button></article>)}{!documents.length && <p>{emptyText}</p>}</div>;
}

function DownloadAll({ documents, fileName, session }) {
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  async function downloadAll() {
    setError(""); setProgress("Preparazione ZIP…");
    try {
      const bytes = await createDocumentArchive(documents, path => documentRequest(session, path), (done, total) => setProgress(`Scaricamento ${done}/${total}…`));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const link = document.createElement("a"); link.href = url; link.download = fileName.replace(/[\\/:*?"<>|]/g, "_") + ".zip";
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) { setError(cause.message); }
    finally { setProgress(""); }
  }
  return <div className="private-download-all"><button type="button" disabled={!documents.length || Boolean(progress)} onClick={downloadAll}><Download size={16}/>{progress || "Scarica tutti"}</button>{error && <small role="alert">{error}</small>}</div>;
}

function LotDocumentLinks({ title, documents, onDownload }) {
  if (!documents.length) return null;
  return <div className="private-lot-document-group"><strong>{title}</strong><ul>{documents.map(document => <li key={document.externalId}><a href="#documento" onClick={event => { event.preventDefault(); onDownload(document); }}><FileLock2 size={15}/><span>{document.originalFileName || document.title}</span></a></li>)}</ul></div>;
}

function LotsWithDocuments({ selected, session, onDownload }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const articleCode = selected.article.articleCode;
  useEffect(() => {
    let active = true;
    documentRequest(session, `lots/documents?${new URLSearchParams({ articleCode, all: "true" })}`)
      .then(data => { if (active) setResult(data); })
      .catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [articleCode, session]);
  const bundles = new Map((result?.lots || []).map(lot => [lot.lotCode.toUpperCase(), lot]));
  const sortedLots = [...(selected.lots || [])].sort((left, right) => String(right.lotCode).localeCompare(String(left.lotCode), "it", { numeric: true }));
  return <section className="private-document-section"><h3>Lotti disponibili</h3><div className="private-genealogy-wrap private-lots-wrap"><table><thead><tr><th>Lotto</th><th>Tipo</th><th>Quantità disponibile</th><th>OP</th><th>Documenti disponibili</th></tr></thead><tbody>{sortedLots.map(row => {
    const bundle = bundles.get(row.lotCode.toUpperCase());
    const materials = (bundle?.materials || []).filter(material => material.documents.length);
    const hasDocuments = bundle && (bundle.general.length || bundle.specific.length || materials.length);
    return <tr key={row.lotCode}><td><strong>{row.lotCode}</strong></td><td>{row.lotType}</td><td>{row.quantity == null ? "—" : Number(row.quantity).toLocaleString("it-IT")} {row.unitOfMeasure}</td><td>{row.productionOrderNumber || "—"}</td><td className="private-lot-documents-cell">{error ? <span role="alert">{error}</span> : !bundle ? <span>{result ? "Nessun documento disponibile." : "Caricamento documenti…"}</span> : <>
      <DownloadAll documents={archiveDocuments(bundle)} fileName={articleCode + "_" + row.lotCode} session={session}/>
      <LotDocumentLinks title="Generali articolo" documents={bundle.general} onDownload={onDownload}/>
      <LotDocumentLinks title="Specifici del lotto" documents={bundle.specific} onDownload={onDownload}/>
      {materials.map(material => <LotDocumentLinks key={material.articleCode + "-" + material.lotCode} title={material.articleCode + " · Lotto " + material.lotCode} documents={material.documents} onDownload={onDownload}/>)}
      {!hasDocuments && <span>Nessun documento disponibile.</span>}
      {!bundle.materials.length && <small>Scarichi MP non disponibili per questo lotto.</small>}
    </>}</td></tr>;
  })}</tbody></table>{!selected.lots?.length && <p>Nessun lotto associato.</p>}</div></section>;
}

export default function PrivateDocuments() {
  const { session: authSession } = useAuth();
  const accessToken = authSession?.access_token;
  const [documentSession, setDocumentSession] = useState(null), [canUpload, setCanUpload] = useState(false), [customerScoped, setCustomerScoped] = useState(false);
  const [catalog, setCatalog] = useState([]), [articles, setArticles] = useState([]), [selected, setSelected] = useState(null);
  const [activeSection, setActiveSection] = useState("finished");
  const [archiveVersion, setArchiveVersion] = useState(0);
  const [synchronizing, setSynchronizing] = useState(false), [nasSync, setNasSync] = useState(null);
  const [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState(""), [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false), [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState("");
  const [uploadLot, setUploadLot] = useState(null);
  const [nasListing, setNasListing] = useState(null), [nasPath, setNasPath] = useState(""), [nasLoading, setNasLoading] = useState(false);
  const detailSequence = useRef(0);
  const detailCache = useRef(new Map());
  const documentSessionRef = useRef(null);
  const activeSearchRef = useRef("");
  const specificationOwnerId = authSession?.user?.id || "";
  const specificationDraftStore = useMemo(() => ({ ownerId: specificationOwnerId, customerScoped, items: new Map() }), [specificationOwnerId, customerScoped]);
  const specificationDrafts = specificationDraftStore.items;
  useEffect(() => {
    function warnUnsaved(event) {
      if (!specificationDrafts.size) return;
      event.preventDefault(); event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  }, [specificationDrafts]);
  const unassociatedActive = activeSection === "unassociated" && documentSession && !customerScoped;
  const requestNas = useCallback(async (path, options) => {
    const session = { accessToken };
    return documentRequest(session, path, options);
  }, [accessToken]);

  const establishSession = useCallback(async () => {
    const view = { ...await workspaceAction(accessToken, "private_documents_session"), accessToken }; documentSessionRef.current = view; setDocumentSession(view); setCustomerScoped(view.customerScoped === true);
    if (view.customerScoped === true) setCanUpload(false);
    else workspaceAction(accessToken, "private_documents_session", { upload: true }).then(() => setCanUpload(true)).catch(() => setCanUpload(false));
    return view;
  }, [accessToken]);
  const loadSearch = useCallback((search) => {
    setArticles(filterDocumentArticles(catalog, search));
  }, [catalog]);
  const loadCatalog = useCallback(async () => {
    if (!accessToken) return; setLoading(true); setError("");
    try {
      if (documentSessionRef.current?.accessToken !== accessToken) detailCache.current.clear();
      const [, receivedCatalog] = await Promise.all([
        documentSessionRef.current?.accessToken === accessToken ? Promise.resolve() : establishSession(),
        documentRequest({ accessToken }, "articles"),
      ]);
      const completeCatalog = receivedCatalog.sort((left, right) => String(left.articleCode).localeCompare(String(right.articleCode), "it", { numeric: true }));
      setCatalog(completeCatalog);      setArticles(filterDocumentArticles(completeCatalog, activeSearchRef.current));
    } catch (loadError) { setError(loadError.message); } finally { setLoading(false); }
  }, [accessToken, establishSession]);
  useEffect(() => { if (!accessToken) return undefined; const pending = window.setTimeout(() => void loadCatalog(), 0); return () => window.clearTimeout(pending); }, [accessToken, loadCatalog]);
  useEffect(() => {
    const search = query.trim();
    if (search === appliedQuery) return undefined;
    const pending = window.setTimeout(() => {
      activeSearchRef.current = search; setAppliedQuery(search); detailSequence.current++; setDetailLoading(false); setSelected(null);
      if (search) void loadSearch(search); else setArticles(catalog);
    }, 250);
    return () => window.clearTimeout(pending);
  }, [appliedQuery, catalog, loadSearch, query]);

  async function applySearch(event) { event?.preventDefault(); const search = query.trim(); activeSearchRef.current = search; detailSequence.current++; setDetailLoading(false); setSelected(null);  setAppliedQuery(search); if (!search) { setArticles(catalog); return; } await loadSearch(search); }
  async function refreshArchive() {
    detailCache.current.clear(); setArchiveVersion(version => version + 1);
    activeSearchRef.current = ""; setAppliedQuery(""); setQuery(""); detailSequence.current++; setDetailLoading(false); setSelected(null);
    await loadCatalog();
  }
  async function synchronizeDocuments() {
    if (synchronizing) return;
    setSynchronizing(true); setError("");
    try {
      setNasSync(await requestNas("nas/sync", { method: "POST" }, true));
      await refreshArchive();
    } catch (cause) { setError(cause.message); }
    finally { setSynchronizing(false); }
  }

  async function openArticle(article) {
    const sequence = ++detailSequence.current;
    setError("");
    const cached = readCachedArticle(detailCache.current, article.articleId);
    if (cached) { setSelected(cached); setDetailLoading(false); return; }
    setDetailLoading(true);
    try {
      const data = await documentRequest(documentSession || await establishSession(), `articles/${encodeURIComponent(article.articleId)}`);
      if (sequence !== detailSequence.current) return;

      cacheArticle(detailCache.current, article.articleId, data); setSelected(data);
    } catch (cause) { if (sequence === detailSequence.current) setError(cause.message); }
    finally { if (sequence === detailSequence.current) setDetailLoading(false); }
  }
  async function download(document) {
    setError("");
    // Reserve the tab while the click still carries browser user activation.
    const fileWindow = window.open("", "_blank");
    if (fileWindow) fileWindow.opener = null;
    try {
      const context = document.downloadContext ? `?${new URLSearchParams(document.downloadContext)}` : "";
      const { url } = await documentRequest(documentSession || await establishSession(), `documents/${document.externalId}${context}`);
      if (!fileWindow) throw new Error("Consenti l’apertura di nuove schede per visualizzare il documento.");
      fileWindow.location.replace(url);
    } catch (cause) { fileWindow?.close(); setError(cause.message); }
  }
  async function browseNas(directory = null) { setNasLoading(true); setError(""); try { const uploadSession = { accessToken }; setNasListing(await documentRequest(uploadSession, (directory === null ? `nas?articleCode=${encodeURIComponent(selected.article.articleCode)}` : `nas?directory=${encodeURIComponent(directory)}`))); } catch (cause) { setError(cause.message); } finally { setNasLoading(false); } }
  function openDocumentLink(lot = null) { setUploadLot(lot); setNasPath(""); setNasListing(null); setUploadError(""); setUploadOpen(true); void browseNas(); }
  async function upload(event) {
    event.preventDefault();
    // React azzera currentTarget quando il gestore asincrono cede il controllo:
    // acquisire il FormData prima del primo await evita il submit silenzioso.
    const formData = new FormData(event.currentTarget);
    setError(""); setUploadError("");
    if (!nasPath) { setUploadError("Selezionare un documento esistente dal NAS."); return; }
    setUploading(true);
    try {
      const uploadSession = { accessToken };
      await documentRequest(uploadSession, "documents/reference", { method: "POST", body: formData });
      setUploadOpen(false);
      setArchiveVersion(version => version + 1);
      detailCache.current.clear();
      await openArticle(selected.article);
      await loadCatalog();
    } catch (cause) {
      setUploadError(cause.message);
      setError(cause.message);
    } finally {
      setUploading(false);
    }
  }

  const lotOptions = useMemo(() => (selected?.lots || []).map((row) => ({ type: row.lotType, lot: row.lotCode, orderId: row.productionOrderId || "", stockId: row.stockLotId || "" })), [selected]);
  const sectionCounts = useMemo(() => catalog.reduce((counts, article) => {
    counts[articleSection(article)] += 1;
    return counts;
  }, { finished: 0, bulk: 0, raw: 0, other: 0 }), [catalog]);
  const filteredArticles = useMemo(() => appliedQuery ? articles : articles.filter((article) => articleSection(article) === activeSection), [activeSection, appliedQuery, articles]);
  const activeSectionInfo = ARTICLE_SECTIONS.find((section) => section.id === activeSection) || ARTICLE_SECTIONS[0];

  return <div className="private-documents-page">
    <header className="private-documents-hero"><div className="private-documents-icon"><FileLock2 /></div><div><span>DOCUMENTI PRIVATE</span><h1>Articoli, lotti e certificati</h1><p>Archivio protetto sul NAS con genealogia dei lotti ricostruita dagli scarichi SL.</p></div><div className="private-documents-security"><ShieldCheck size={18}/><span>Accesso tracciato</span></div></header>
    {error && <div className="private-documents-error">{error}<button onClick={() => setError("")}><X size={16}/></button></div>}
    <div className="private-document-sections" role="tablist" aria-label="Tipologie articolo">{ARTICLE_SECTIONS.map((section) => { const Icon = section.icon; const active = !appliedQuery && activeSection === section.id; return <button key={section.id} type="button" role="tab" aria-selected={active} className={active ? "active" : ""} onClick={() => { activeSearchRef.current = ""; setActiveSection(section.id); setQuery(""); setAppliedQuery(""); setArticles(catalog); detailSequence.current++; setDetailLoading(false); setSelected(null);  }}><span className="private-document-section-icon"><Icon size={22}/></span><span><strong>{section.title}</strong><small>{section.description}</small></span><b>{sectionCounts[section.id]}</b></button>; })}{documentSession && !customerScoped && <button type="button" role="tab" aria-selected={Boolean(unassociatedActive)} className={unassociatedActive ? "active" : ""} onClick={() => { setActiveSection("unassociated"); setQuery(""); setAppliedQuery(""); activeSearchRef.current = ""; detailSequence.current++; setDetailLoading(false); setSelected(null); }}><span className="private-document-section-icon"><Folder size={22}/></span><span><strong>Documenti non associati</strong><small>File NAS da verificare e collegare.</small></span></button>}</div>
    <form className="private-documents-toolbar" onSubmit={applySearch}>
      <label><Search size={19}/><input value={query} disabled={unassociatedActive} onChange={(event) => { activeSearchRef.current = event.target.value.trim(); setQuery(event.target.value); }} placeholder="Ricerca rapida in tutti gli articoli, lotti e documenti…"/></label>
      <button type="submit" disabled={unassociatedActive}><Search size={17}/>Cerca</button>
      <button type="button" className="secondary-action" disabled={loading || synchronizing} onClick={refreshArchive}><RefreshCw size={17}/>Aggiorna archivio</button>
      {documentSession && !customerScoped && canUpload && <button type="button" className="private-sync-action" disabled={synchronizing} onClick={synchronizeDocuments}><RefreshCw size={17}/>{synchronizing ? "Sincronizzazione in corso…" : "Sincronizza documenti"}</button>}
    </form>
    {nasSync && <small className="private-documents-sync" role="status">{nasSync.associated} nuovi collegamenti · {nasSync.unassociated.length} documenti non associati{nasSync.warnings.length ? " · Verifica parziale: consulta i documenti non associati" : ""}</small>}
    {unassociatedActive ? <PrivateDocumentsUnassociated request={requestNas} refreshKey={`${nasSync?.scannedAt}-${archiveVersion}`}/> : <>
    <div className="private-documents-master-detail">
      <section className="private-article-list-panel"><header><h2>{appliedQuery ? `Risultati per “${appliedQuery}”` : activeSectionInfo.title}</h2><span>{filteredArticles.length}</span></header>{loading ? <div className="private-documents-loading">Caricamento archivio…</div> : <div className="private-article-list">{filteredArticles.map((article) => <button key={article.articleId} type="button" onClick={() => openArticle(article)} className={selected?.article?.articleId === article.articleId ? "active" : ""}><span>{article.articleType}</span><strong>{article.articleCode}</strong><p>{article.description}</p><small>{article.documentCount} documenti · {article.lotCount} lotti</small></button>)}</div>}{!loading && !filteredArticles.length && <p className="private-panel-empty">{appliedQuery ? "Nessun articolo corrisponde alla ricerca globale." : "Nessun articolo disponibile in questa tipologia."}</p>}</section>
      <section className="private-article-detail-panel">{detailLoading ? <div className="private-documents-loading">Caricamento lotti e documenti…</div> : !selected ? <div className="private-panel-empty"><FileLock2 size={32}/><h2>Seleziona un articolo</h2><p>I lotti e i documenti disponibili compariranno qui.</p></div> : <>
      <div className="private-detail-heading"><div><span>{selected.article.articleType}</span><h2>{selected.article.articleCode} · {selected.article.description}</h2><p>{selected.article.customers?.join(", ") || "Nessun cliente collegato"}</p></div>{!customerScoped && canUpload && <button className="primary-action" onClick={() => openDocumentLink()}><FilePlus2 size={18}/>Associa documento</button>}</div>
      {articleSection(selected.article) === "finished" && <ProductSpecification key={`${authSession?.user?.id}-${customerScoped}-${selected.article.articleCode}`} article={selected.article} canEdit={canUpload && !customerScoped} request={requestNas} drafts={specificationDrafts}/>}
      {(!customerScoped || documentsOnlyArticle(selected.article)) && <section className="private-document-section"><header className="private-document-section-heading"><h3>{documentsOnlyArticle(selected.article) ? "Documenti associati" : "Documenti generali e di produzione"}</h3><DownloadAll documents={selected.documents} fileName={selected.article.articleCode} session={documentSession}/></header><DocumentList documents={selected.documents} onDownload={download}/></section>}
      {!documentsOnlyArticle(selected.article) && <LotsWithDocuments key={selected.article.articleCode + "-" + archiveVersion} selected={selected} session={documentSession} onDownload={download}/>}
    </>}</section></div>
    </>}
    {uploadOpen && selected && canUpload && !customerScoped && <div className="private-upload-modal"><form onSubmit={upload}><header><div><h3>Associa documento NAS esistente</h3><p>{selected.article.articleCode}{uploadLot ? ` · Lotto ${uploadLot.lotCode}` : ""}</p></div><button type="button" disabled={uploading} onClick={() => setUploadOpen(false)}><X/></button></header><input type="hidden" name="articleId" value={selected.article.articleId}/><input type="hidden" name="nasPath" value={nasPath}/><section className="private-nas-picker"><header><div><strong>Documento selezionato</strong><small>{nasPath||nasListing?.directory||"Nessun documento selezionato"}</small></div>{nasListing?.parentPath!==null&&nasListing&&<button type="button" onClick={()=>browseNas(nasListing.parentPath||"")}><ArrowLeft size={15}/> Su</button>}</header>{nasListing?.notice && <p role="status">{nasListing.notice}</p>}{nasLoading?<p>Caricamento cartelle NAS…</p>:<div className="private-nas-entries">{(nasListing?.directories||[]).map((item)=><button type="button" key={item.relativePath} onClick={()=>browseNas(item.relativePath)}><Folder size={17}/><span>{item.name}</span></button>)}{(nasListing?.files||[]).map((item)=><button type="button" className={nasPath===item.relativePath?"selected":""} key={item.relativePath} onClick={()=>setNasPath(item.relativePath)}><File size={17}/><span>{item.name}</span><small>{size(item.sizeBytes)}</small></button>)}</div>}<small>Il file resta nella posizione attuale: viene registrato soltanto il collegamento nel database.</small></section><label>Associazione<select defaultValue={uploadLot ? `${uploadLot.lotType}|${uploadLot.lotCode}|${uploadLot.productionOrderId || ""}|${uploadLot.stockLotId || ""}` : "Articolo|||"} onChange={(event) => { const [type, lot, orderId, stockId] = event.target.value.split("|"); const form = event.currentTarget.form; form.associationType.value = type; form.lotCode.value = lot || ""; form.productionOrderId.value = orderId || ""; form.stockLotId.value = stockId || ""; }}><option value="Articolo|||">Documento generale articolo</option>{lotOptions.map((row) => <option key={`${row.type}-${row.lot}-${row.orderId}-${row.stockId}`} value={`${row.type}|${row.lot}|${row.orderId}|${row.stockId}`}>{row.type} · {row.lot}</option>)}</select></label><input type="hidden" name="associationType" defaultValue={uploadLot?.lotType || "Articolo"}/><input type="hidden" name="lotCode" defaultValue={uploadLot?.lotCode || ""}/><input type="hidden" name="productionOrderId" defaultValue={uploadLot?.productionOrderId || ""}/><input type="hidden" name="stockLotId" defaultValue={uploadLot?.stockLotId || ""}/><div className="private-form-grid"><label>Tipo<select name="documentType"><option value="Coa">CoA</option><option value="Sds">SDS</option><option value="SchedaTecnica">Scheda tecnica</option><option value="DichiarazioneConformita">Dichiarazione conformità</option><option value="Specifica">Specifica</option><option value="Altro">Altro</option></select></label><label>Revisione<input name="revision" defaultValue="1"/></label></div><label>Titolo<input name="title" required/></label><div className="private-form-grid"><label>Lingua<input name="language" defaultValue="IT"/></label><label>Valido fino al<input name="validUntil" type="date"/></label></div><label>Note<textarea name="notes" rows="3"/></label>{uploadError && <div className="private-upload-error" role="alert">{uploadError}</div>}<footer><button type="button" disabled={uploading} onClick={() => setUploadOpen(false)}>Annulla</button><button className="primary-action" type="submit" disabled={uploading}><FilePlus2 size={17}/>{uploading ? "Associazione…" : "Associa documento"}</button></footer></form></div>}
  </div>;
}

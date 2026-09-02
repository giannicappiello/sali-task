import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Boxes, ClipboardCheck, Download, File, FileLock2, FilePlus2, FlaskConical, Folder, PackageCheck, RefreshCw, Search, Shapes, ShieldCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { productionCoaWorkspacePath } from "./private-documents-navigation";
import "./PrivateDocuments.css";
import "./PrivateDocumentsActions.css";
import "./PrivateDocumentsNasPicker.css";

async function workspaceAction(token, action, extra = {}) {
  const response = await fetch("/api/mexal/automation", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}
async function mesRequest(session, path, options = {}) {
  const response = await fetch(new URL(path, session.endpoint), { ...options, headers: { Authorization: `Bearer ${session.token}`, ...(options.headers || {}) } });
  if (options.raw) return response;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.detail || `Archivio documentale non disponibile (${response.status}).`);
  return payload;
}
const size = (bytes) => `${(Number(bytes || 0) / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 2 })} MB`;
const date = (value) => value ? new Date(value).toLocaleDateString("it-IT") : "—";
const sameId = (left, right) => Number(left || 0) > 0 && Number(left) === Number(right);
const documentsForLot = (documents, lot) => (documents || []).filter((document) =>
  document.associationType === "Articolo" ||
  (document.lotCode && document.lotCode.toLowerCase() === lot.lotCode.toLowerCase()) ||
  sameId(document.stockLotId, lot.stockLotId) || sameId(document.productionOrderId, lot.productionOrderId) ||
  sameId(document.productionId, lot.productionId));

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

export default function PrivateDocuments() {
  const { session: authSession } = useAuth();
  const navigate = useNavigate();
  const accessToken = authSession?.access_token;
  const [mesSession, setMesSession] = useState(null), [canUpload, setCanUpload] = useState(false), [customerScoped, setCustomerScoped] = useState(false);
  const [articles, setArticles] = useState([]), [selected, setSelected] = useState(null), [selectedLot, setSelectedLot] = useState(null);
  const [activeSection, setActiveSection] = useState("finished");
  const [query, setQuery] = useState(""), [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false), [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false), [syncInfo, setSyncInfo] = useState(null);
  const [uploadLot, setUploadLot] = useState(null);
  const [nasListing, setNasListing] = useState(null), [nasPath, setNasPath] = useState(""), [nasLoading, setNasLoading] = useState(false);
  const searchSequence = useRef(0);

  const establishSession = useCallback(async () => {
    const view = await workspaceAction(accessToken, "private_documents_session"); setMesSession(view); setCustomerScoped(view.customerScoped === true);
    workspaceAction(accessToken, "private_documents_session", { upload: true }).then(() => setCanUpload(true)).catch(() => setCanUpload(false));
    return view;
  }, [accessToken]);
  const load = useCallback(async (search = "") => {
    if (!accessToken) return; const sequence = ++searchSequence.current; setLoading(true); setError("");
    try { const active = mesSession || await establishSession(); const result = await mesRequest(active, `articles?search=${encodeURIComponent(search.trim())}`) || []; if (sequence === searchSequence.current) setArticles(result); workspaceAction(accessToken, "private_documents_sync").then(setSyncInfo).catch(() => {}); }
    catch (loadError) { if (sequence === searchSequence.current) setError(loadError.message); } finally { if (sequence === searchSequence.current) setLoading(false); }
  }, [accessToken, establishSession, mesSession]);
  useEffect(() => { if (!accessToken) return undefined; const pending = window.setTimeout(() => load(query), 250); return () => window.clearTimeout(pending); }, [accessToken, load, query]);

  async function openArticle(article) { setDetailLoading(true); setError(""); setSelectedLot(null); try { setSelected(await mesRequest(mesSession || await establishSession(), `articles/${article.articleId}`)); } catch (cause) { setError(cause.message); } finally { setDetailLoading(false); } }
  async function download(document) { setError(""); try { const response = await mesRequest(mesSession || await establishSession(), `documents/${document.externalId}`, { raw: true }); if (!response.ok) throw new Error("Documento non disponibile o non autorizzato."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = document.originalFileName || "documento"; anchor.click(); URL.revokeObjectURL(url); } catch (cause) { setError(cause.message); } }
  async function browseNas(directory = "") { setNasLoading(true); setError(""); try { const uploadSession = await workspaceAction(accessToken, "private_documents_session", { upload: true }); setNasListing(await mesRequest(uploadSession, `nas?directory=${encodeURIComponent(directory)}`)); } catch (cause) { setError(cause.message); } finally { setNasLoading(false); } }
  function openDocumentLink(lot = null) { setUploadLot(lot); setNasPath(""); setNasListing(null); setUploadOpen(true); void browseNas(""); }
  async function upload(event) { event.preventDefault(); setError(""); if (!nasPath) { setError("Selezionare un documento esistente dal NAS."); return; } try { const uploadSession = await workspaceAction(accessToken, "private_documents_session", { upload: true }); await mesRequest(uploadSession, "documents/reference", { method: "POST", body: new FormData(event.currentTarget) }); setUploadOpen(false); await workspaceAction(accessToken, "private_documents_sync"); await openArticle(selected.article); } catch (cause) { setError(cause.message); } }
  function openCoa(lot) { const path = productionCoaWorkspacePath({ productionId: lot.productionId, articleCode: selected?.article?.articleCode, lotCode: lot.lotCode, productionOrderId: lot.productionOrderId }); if (!path) { setError("Produzione non identificata: non è possibile compilare il CoA per questo lotto."); return; } setError(""); navigate(path); }

  const lotOptions = useMemo(() => (selected?.lots || []).map((row) => ({ type: row.lotType, lot: row.lotCode, orderId: row.productionOrderId || "", stockId: row.stockLotId || "" })), [selected]);
  const lotDocuments = useMemo(() => selectedLot ? documentsForLot(selected?.documents, selectedLot) : [], [selected, selectedLot]);
  const sectionCounts = useMemo(() => articles.reduce((counts, article) => {
    counts[articleSection(article)] += 1;
    return counts;
  }, { finished: 0, bulk: 0, raw: 0, other: 0 }), [articles]);
  const filteredArticles = useMemo(() => articles.filter((article) => articleSection(article) === activeSection), [activeSection, articles]);
  const activeSectionInfo = ARTICLE_SECTIONS.find((section) => section.id === activeSection) || ARTICLE_SECTIONS[0];

  return <div className="private-documents-page">
    <header className="private-documents-hero"><div className="private-documents-icon"><FileLock2 /></div><div><span>DOCUMENTI PRIVATE</span><h1>Articoli, lotti e certificati</h1><p>Archivio protetto sul NAS con genealogia dei lotti ricostruita dagli scarichi SL.</p></div><div className="private-documents-security"><ShieldCheck size={18}/><span>Accesso tracciato</span></div></header>
    {error && <div className="private-documents-error">{error}<button onClick={() => setError("")}><X size={16}/></button></div>}
    <div className="private-document-sections" role="tablist" aria-label="Tipologie articolo">{ARTICLE_SECTIONS.map((section) => { const Icon = section.icon; const active = activeSection === section.id; return <button key={section.id} type="button" role="tab" aria-selected={active} className={active ? "active" : ""} onClick={() => { setActiveSection(section.id); setSelected(null); setSelectedLot(null); }}><span className="private-document-section-icon"><Icon size={22}/></span><span><strong>{section.title}</strong><small>{section.description}</small></span><b>{sectionCounts[section.id]}</b></button>; })}</div>
    <div className="private-documents-toolbar"><label><Search size={19}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Cerca in ${activeSectionInfo.title.toLowerCase()}…`}/></label><button onClick={() => load(query)}><Search size={17}/>Cerca</button><button className="secondary-action" onClick={() => load(query)}><RefreshCw size={17}/>Aggiorna</button></div>
    {syncInfo && <small className="private-documents-sync">Traccia Workspace aggiornata: {syncInfo.documents} documenti · {syncInfo.slRows} righe SL</small>}
    <div className="private-documents-master-detail">
      <section className="private-article-list-panel"><header><h2>{activeSectionInfo.title}</h2><span>{filteredArticles.length}</span></header>{loading ? <div className="private-documents-loading">Caricamento archivio…</div> : <div className="private-article-list">{filteredArticles.map((article) => <button key={article.articleId} type="button" onClick={() => openArticle(article)} className={selected?.article?.articleId === article.articleId ? "active" : ""}><span>{article.articleType}</span><strong>{article.articleCode}</strong><p>{article.description}</p><small>{article.documentCount} documenti · {article.lotCount} lotti</small></button>)}</div>}{!loading && !filteredArticles.length && <p className="private-panel-empty">Nessun articolo disponibile in questa tipologia.</p>}</section>
      <section className="private-article-detail-panel">{detailLoading ? <div className="private-documents-loading">Caricamento lotti e documenti…</div> : !selected ? <div className="private-panel-empty"><FileLock2 size={32}/><h2>Seleziona un articolo</h2><p>I lotti e i documenti disponibili compariranno qui.</p></div> : selectedLot ? <>
      <div className="private-detail-heading"><button onClick={() => setSelectedLot(null)}><ArrowLeft size={18}/>Torna ai lotti</button><div><span>{selected.article.articleCode} · {selectedLot.lotType}</span><h2>Lotto {selectedLot.lotCode}</h2><p>{selected.article.description}</p></div></div>
      <section className="private-document-section"><h3>Documenti disponibili per il lotto</h3><DocumentList documents={lotDocuments} onDownload={download} emptyText="Nessun documento disponibile per questo lotto."/></section>
    </> : <>
      <div className="private-detail-heading"><div><span>{selected.article.articleType}</span><h2>{selected.article.articleCode} · {selected.article.description}</h2><p>{selected.article.customers?.join(", ") || "Nessun cliente collegato"}</p></div>{canUpload && <button className="primary-action" onClick={() => openDocumentLink()}><FilePlus2 size={18}/>Associa documento</button>}</div>
      {!customerScoped && <section className="private-document-section"><h3>Documenti generali e di produzione</h3><DocumentList documents={selected.documents} onDownload={download}/></section>}
      <section className="private-document-section"><h3>Lotti disponibili</h3><div className="private-genealogy-wrap"><table><thead><tr><th>Lotto</th><th>Tipo</th><th>Quantità disponibile</th><th>Origine</th><th>OP</th><th>Magazzino / ubicazione</th><th>Azioni</th></tr></thead><tbody>{(selected.lots || []).map((row) => <tr key={`${row.lotType}-${row.lotCode}`}><td><strong>{row.lotCode}</strong></td><td>{row.lotType}</td><td>{Number(row.quantity).toLocaleString("it-IT")} {row.unitOfMeasure}</td><td>{row.source}</td><td>{row.productionOrderNumber || "—"}</td><td>{row.location || "—"}</td><td><div className="private-lot-actions"><button type="button" onClick={() => setSelectedLot(row)}><FileLock2 size={15}/>Apri lotto</button>{canUpload && <button type="button" onClick={() => openDocumentLink(row)}><FilePlus2 size={15}/>Associa documento</button>}{!customerScoped && ["LottoProdotto", "LottoBulk"].includes(row.lotType) && (Number(row.productionId) > 0 ? <button type="button" onClick={() => openCoa(row)}><ClipboardCheck size={15}/>Emetti CoA</button> : <button type="button" disabled title="Il lotto non è collegato in modo univoco a una produzione MES"><ClipboardCheck size={15}/>Produzione non identificata</button>)}</div></td></tr>)}</tbody></table>{!(selected.lots || []).length && <p>Nessun lotto associato.</p>}</div></section>
      {!customerScoped && <section className="private-document-section"><h3>Genealogia lotti e scarichi SL</h3><div className="private-genealogy-wrap"><table><thead><tr><th>OP / OCT / RdP</th><th>Lotto prodotto</th><th>Materia prima</th><th>Lotto utilizzato</th><th>Quantità</th><th>Documento SL</th></tr></thead><tbody>{selected.genealogy.map((row) => <tr key={row.mesId}><td><strong>{row.productionOrderNumber}</strong><small>{row.octReference} · {row.rdpReference}</small></td><td>{row.productArticleCode}<small>{row.destinationLot}</small></td><td>{row.rawMaterialArticleCode}<small>{row.rawMaterialDescription}</small></td><td>{row.sourceLot}</td><td>{Number(row.quantity).toLocaleString("it-IT")} {row.unitOfMeasure}</td><td>{row.slDocument || "—"}</td></tr>)}</tbody></table></div></section>}
    </>}</section></div>
    {uploadOpen && selected && <div className="private-upload-modal"><form onSubmit={upload}><header><div><h3>Associa documento NAS esistente</h3><p>{selected.article.articleCode}{uploadLot ? ` · Lotto ${uploadLot.lotCode}` : ""}</p></div><button type="button" onClick={() => setUploadOpen(false)}><X/></button></header><input type="hidden" name="articleId" value={selected.article.articleId}/><input type="hidden" name="nasPath" value={nasPath}/><section className="private-nas-picker"><header><div><strong>Documento selezionato</strong><small>{nasPath||"Nessun documento selezionato"}</small></div>{nasListing?.parentPath!==null&&nasListing&&<button type="button" onClick={()=>browseNas(nasListing.parentPath||"")}><ArrowLeft size={15}/> Su</button>}</header>{nasLoading?<p>Caricamento cartelle NAS…</p>:<div className="private-nas-entries">{(nasListing?.directories||[]).map((item)=><button type="button" key={item.relativePath} onClick={()=>browseNas(item.relativePath)}><Folder size={17}/><span>{item.name}</span></button>)}{(nasListing?.files||[]).map((item)=><button type="button" className={nasPath===item.relativePath?"selected":""} key={item.relativePath} onClick={()=>setNasPath(item.relativePath)}><File size={17}/><span>{item.name}</span><small>{size(item.sizeBytes)}</small></button>)}</div>}<small>Il file resta nella posizione attuale: viene registrato soltanto il collegamento nel database.</small></section><label>Associazione<select defaultValue={uploadLot ? `${uploadLot.lotType}|${uploadLot.lotCode}|${uploadLot.productionOrderId || ""}|${uploadLot.stockLotId || ""}` : "Articolo|||"} onChange={(event) => { const [type, lot, orderId, stockId] = event.target.value.split("|"); const form = event.currentTarget.form; form.associationType.value = type; form.lotCode.value = lot || ""; form.productionOrderId.value = orderId || ""; form.stockLotId.value = stockId || ""; }}><option value="Articolo|||">Documento generale articolo</option>{lotOptions.map((row) => <option key={`${row.type}-${row.lot}-${row.orderId}-${row.stockId}`} value={`${row.type}|${row.lot}|${row.orderId}|${row.stockId}`}>{row.type} · {row.lot}</option>)}</select></label><input type="hidden" name="associationType" defaultValue={uploadLot?.lotType || "Articolo"}/><input type="hidden" name="lotCode" defaultValue={uploadLot?.lotCode || ""}/><input type="hidden" name="productionOrderId" defaultValue={uploadLot?.productionOrderId || ""}/><input type="hidden" name="stockLotId" defaultValue={uploadLot?.stockLotId || ""}/><div className="private-form-grid"><label>Tipo<select name="documentType"><option value="Coa">CoA</option><option value="Sds">SDS</option><option value="SchedaTecnica">Scheda tecnica</option><option value="DichiarazioneConformita">Dichiarazione conformità</option><option value="Specifica">Specifica</option><option value="Altro">Altro</option></select></label><label>Revisione<input name="revision" defaultValue="1"/></label></div><label>Titolo<input name="title" required/></label><div className="private-form-grid"><label>Lingua<input name="language" defaultValue="IT"/></label><label>Valido fino al<input name="validUntil" type="date"/></label></div><label>Note<textarea name="notes" rows="3"/></label><footer><button type="button" onClick={() => setUploadOpen(false)}>Annulla</button><button className="primary-action" type="submit"><FilePlus2 size={17}/>Associa documento</button></footer></form></div>}
  </div>;
}

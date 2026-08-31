import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FileLock2, FileUp, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import "./PrivateDocuments.css";

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
  if (!response.ok) throw new Error(payload.error || `Archivio documentale non disponibile (${response.status}).`);
  return payload;
}
const size = (bytes) => `${(Number(bytes || 0) / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 2 })} MB`;
const date = (value) => value ? new Date(value).toLocaleDateString("it-IT") : "—";

export default function PrivateDocuments() {
  const { session: authSession } = useAuth();
  const accessToken = authSession?.access_token;
  const [mesSession, setMesSession] = useState(null), [canUpload, setCanUpload] = useState(false);
  const [articles, setArticles] = useState([]), [selected, setSelected] = useState(null);
  const [query, setQuery] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false), [syncInfo, setSyncInfo] = useState(null);

  const establishSession = useCallback(async () => {
    const view = await workspaceAction(accessToken, "private_documents_session"); setMesSession(view);
    workspaceAction(accessToken, "private_documents_session", { upload: true }).then(() => setCanUpload(true)).catch(() => setCanUpload(false));
    return view;
  }, [accessToken]);
  const load = useCallback(async (search = "") => {
    if (!accessToken) return; setLoading(true); setError("");
    try { const active = mesSession || await establishSession(); setArticles(await mesRequest(active, `articles?search=${encodeURIComponent(search.trim())}`) || []); workspaceAction(accessToken, "private_documents_sync").then(setSyncInfo).catch(() => {}); }
    catch (loadError) { setError(loadError.message); } finally { setLoading(false); }
  }, [accessToken, establishSession, mesSession]);
  useEffect(() => { const pending = window.setTimeout(() => load(""), 0); return () => window.clearTimeout(pending); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openArticle(article) { setLoading(true); setError(""); try { setSelected(await mesRequest(mesSession || await establishSession(), `articles/${article.articleId}`)); } catch (cause) { setError(cause.message); } finally { setLoading(false); } }
  async function download(document) { setError(""); try { const response = await mesRequest(mesSession || await establishSession(), `documents/${document.externalId}`, { raw: true }); if (!response.ok) throw new Error("Documento non disponibile o non autorizzato."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = document.originalFileName || "documento"; anchor.click(); URL.revokeObjectURL(url); } catch (cause) { setError(cause.message); } }
  async function upload(event) { event.preventDefault(); setError(""); try { const uploadSession = await workspaceAction(accessToken, "private_documents_session", { upload: true }); await mesRequest(uploadSession, "documents", { method: "POST", body: new FormData(event.currentTarget) }); setUploadOpen(false); await workspaceAction(accessToken, "private_documents_sync"); await openArticle(selected.article); } catch (cause) { setError(cause.message); } }

  const lotOptions = useMemo(() => { if (!selected) return []; const id = selected.article.articleId; const rows = []; selected.genealogy.forEach((row) => { if (row.productArticleId === id) rows.push({ type: row.destinationLotType === "Bulk" ? "LottoBulk" : "LottoProdotto", lot: row.destinationLot, orderId: row.productionOrderId, stockId: "" }); if (row.rawMaterialArticleId === id) rows.push({ type: "LottoMateriaPrima", lot: row.sourceLot, orderId: "", stockId: row.sourceStockLotId }); }); return [...new Map(rows.map((row) => [`${row.type}:${row.lot}:${row.orderId}:${row.stockId}`, row])).values()]; }, [selected]);

  return <div className="private-documents-page">
    <header className="private-documents-hero"><div className="private-documents-icon"><FileLock2 /></div><div><span>DOCUMENTI PRIVATE</span><h1>Articoli, lotti e certificati</h1><p>Archivio protetto sul NAS con genealogia dei lotti ricostruita dagli scarichi SL.</p></div><div className="private-documents-security"><ShieldCheck size={18}/><span>Accesso tracciato</span></div></header>
    {error && <div className="private-documents-error">{error}<button onClick={() => setError("")}><X size={16}/></button></div>}
    {!selected ? <><div className="private-documents-toolbar"><label><Search size={19}/><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && load(query)} placeholder="Cerca articolo, descrizione o codice…"/></label><button onClick={() => load(query)}><Search size={17}/>Cerca</button><button className="secondary-action" onClick={() => load(query)}><RefreshCw size={17}/>Aggiorna</button></div>{syncInfo && <small className="private-documents-sync">Traccia Workspace aggiornata: {syncInfo.documents} documenti · {syncInfo.slRows} righe SL</small>}{loading ? <div className="private-documents-loading">Caricamento archivio…</div> : <div className="private-article-grid">{articles.map((article) => <button key={article.articleId} onClick={() => openArticle(article)} className="private-article-card"><span>{article.articleType}</span><strong>{article.articleCode}</strong><p>{article.description}</p><small>{article.customers?.length ? `Clienti: ${article.customers.join(", ")}` : "Nessun cliente collegato"}</small><div><b>{article.documentCount} documenti</b><b>{article.lotCount} lotti</b></div></button>)}</div>}{!loading && !articles.length && <div className="private-documents-loading">Nessun articolo trovato nel perimetro autorizzato.</div>}</> : <>
      <div className="private-detail-heading"><button onClick={() => setSelected(null)}><ArrowLeft size={18}/>Torna agli articoli</button><div><span>{selected.article.articleType}</span><h2>{selected.article.articleCode} · {selected.article.description}</h2><p>{selected.article.customers?.join(", ") || "Nessun cliente collegato"}</p></div>{canUpload && <button className="primary-action" onClick={() => setUploadOpen(true)}><FileUp size={18}/>Carica documento</button>}</div>
      <section className="private-document-section"><h3>Documenti disponibili</h3><div className="private-document-list">{selected.documents.map((document) => <article key={`${document.externalId}-${document.associationType}-${document.lotCode}`}><FileLock2/><div><strong>{document.title}</strong><span>{document.type} · Rev. {document.revision} · {document.associationType}{document.lotCode ? ` · Lotto ${document.lotCode}` : ""}</span><small>{document.originalFileName} · {size(document.sizeBytes)} · caricato il {date(document.uploadedAt)}</small></div><button onClick={() => download(document)}><Download size={17}/>Scarica</button></article>)}{!selected.documents.length && <p>Nessun documento associato.</p>}</div></section>
      <section className="private-document-section"><h3>Genealogia lotti e scarichi SL</h3><div className="private-genealogy-wrap"><table><thead><tr><th>OP / OCT / RdP</th><th>Lotto prodotto</th><th>Materia prima</th><th>Lotto utilizzato</th><th>Quantità</th><th>Documento SL</th></tr></thead><tbody>{selected.genealogy.map((row) => <tr key={row.mesId}><td><strong>{row.productionOrderNumber}</strong><small>{row.octReference} · {row.rdpReference}</small></td><td>{row.productArticleCode}<small>{row.destinationLot}</small></td><td>{row.rawMaterialArticleCode}<small>{row.rawMaterialDescription}</small></td><td>{row.sourceLot}</td><td>{Number(row.quantity).toLocaleString("it-IT")} {row.unitOfMeasure}</td><td>{row.slDocument || "—"}</td></tr>)}</tbody></table></div></section>
    </>}
    {uploadOpen && selected && <div className="private-upload-modal"><form onSubmit={upload}><header><div><h3>Carica sul NAS</h3><p>{selected.article.articleCode}</p></div><button type="button" onClick={() => setUploadOpen(false)}><X/></button></header><input type="hidden" name="articleId" value={selected.article.articleId}/><label>File<input required type="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"/></label><label>Associazione<select onChange={(event) => { const [type, lot, orderId, stockId] = event.target.value.split("|"); const form = event.currentTarget.form; form.associationType.value = type; form.lotCode.value = lot || ""; form.productionOrderId.value = orderId || ""; form.stockLotId.value = stockId || ""; }}><option value="Articolo|||">Documento generale articolo</option>{lotOptions.map((row) => <option key={`${row.type}-${row.lot}-${row.orderId}-${row.stockId}`} value={`${row.type}|${row.lot}|${row.orderId}|${row.stockId}`}>{row.type} · {row.lot}</option>)}</select></label><input type="hidden" name="associationType" defaultValue="Articolo"/><input type="hidden" name="lotCode"/><input type="hidden" name="productionOrderId"/><input type="hidden" name="stockLotId"/><div className="private-form-grid"><label>Tipo<select name="documentType"><option value="Coa">CoA</option><option value="Sds">SDS</option><option value="SchedaTecnica">Scheda tecnica</option><option value="DichiarazioneConformita">Dichiarazione conformità</option><option value="Specifica">Specifica</option><option value="Altro">Altro</option></select></label><label>Revisione<input name="revision" defaultValue="1"/></label></div><label>Titolo<input name="title" required/></label><div className="private-form-grid"><label>Lingua<input name="language" defaultValue="IT"/></label><label>Valido fino al<input name="validUntil" type="date"/></label></div><label>Note<textarea name="notes" rows="3"/></label><footer><button type="button" onClick={() => setUploadOpen(false)}>Annulla</button><button className="primary-action" type="submit"><FileUp size={17}/>Carica documento</button></footer></form></div>}
  </div>;
}

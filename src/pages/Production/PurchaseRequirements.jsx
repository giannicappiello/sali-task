import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, FilePlus2, Info, RefreshCw, Search, ShoppingCart, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { createPfPreviewPdfFiles } from "../../modules/orders/services/pfPreviewPdf.js";

async function callPurchasing(accessToken, action, extra = {}) {
  const response = await fetch("/api/mexal/automation", { method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || payload.message || "Operazione acquisti non riuscita.");
  return payload;
}

const quantity = (value) => new Intl.NumberFormat("it-IT", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(value) || 0);
const date = (value) => value ? new Intl.DateTimeFormat("it-IT").format(new Date(value)) : "Da definire";
const monthTitle = (value) => value ? new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date(value)).replace(/^./, (letter) => letter.toUpperCase()) : "Data da definire";
const monthId = (value) => value ? `fabbisogni-${String(value).slice(0, 7)}` : "fabbisogni-senza-data";
const statusLabel = (status) => ({ ORDER_LATE: "Ordine in ritardo", TO_ORDER: "Da ordinare", COVERED_BY_ARRIVALS: "Coperto da consegne", COVERED_BY_STOCK: "Coperto da giacenza" }[status] || status);
const typeLabel = (value) => ({ Packaging: "Packaging", MateriaPrima: "Materia prima", Accessorio: "Accessorio" }[value] || value);
const searchText = (row) => [row.articleCode, row.description, typeLabel(row.articleType), row.requiredAt, row.orderBy,
  row.unitOfMeasure, row.pfDocuments, row.supplierOrders, row.supplierName, row.octReferences,
  row.productionOrders, statusLabel(row.status)].join(" ").toLocaleLowerCase("it-IT");
const ButtonInfo = ({ text }) => <span className="purchase-button-info" title={text} aria-hidden="true"><Info size={13}/></span>;

export default function PurchaseRequirements() {
  const { session, hasPermission } = useAuth();
  const accessToken = session?.access_token;
  const canManage = hasPermission?.("purchases.manage");
  const [data, setData] = useState({ requirements: [], suppliers: [], saliDiIschiaProposals: [] });
  const [selected, setSelected] = useState(new Set());
  const [supplierByMonth, setSupplierByMonth] = useState({});
  const [searchByMonth, setSearchByMonth] = useState({});
  const [pfPreview, setPfPreview] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [onlyToOrder, setOnlyToOrder] = useState(false);
  const [summaryFilter, setSummaryFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError("");
    try { setData(await callPurchasing(accessToken, "workspacemes_v4_purchasing_list")); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [accessToken]);
  useEffect(() => {
    if (!accessToken) return undefined;
    let active = true;
    callPurchasing(accessToken, "workspacemes_v4_purchasing_list")
      .then((payload) => { if (active) setData(payload); })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  const rows = useMemo(() => data.requirements.filter((row) => {
    if (summaryFilter === "to_order" && row.quantityToOrder <= 0) return false;
    if (summaryFilter === "covered_arrivals" && row.status !== "COVERED_BY_ARRIVALS") return false;
    return !onlyToOrder || row.quantityToOrder > 0;
  }), [data.requirements, onlyToOrder, summaryFilter]);
  const groups = useMemo(() => Object.values(rows.reduce((result, row) => {
    const key = String(row.month || "");
    result[key] ||= { key, month: row.month, rows: [] };
    result[key].rows.push(row);
    return result;
  }, {})).sort((a, b) => String(a.month).localeCompare(String(b.month))), [rows]);

  function toggle(row) { setSelected((current) => { const next = new Set(current); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; }); }
  function toggleGroup(group) {
    const ids = group.rows.filter((row) => row.quantityToOrder > 0).map((row) => row.key);
    setSelected((current) => { const next = new Set(current); ids.every((id) => next.has(id)) ? ids.forEach((id) => next.delete(id)) : ids.forEach((id) => next.add(id)); return next; });
  }
  const selectedRows = (group) => group.rows.filter((row) => row.quantityToOrder > 0 && selected.has(row.key));
  function applySummaryFilter(filter) {
    setSummaryFilter(filter);
    setOnlyToOrder(filter === "to_order");
  }

  async function run(purchasingAction, extra = {}, successReload = true) {
    setBusy(purchasingAction); setError(""); setMessage("");
    try {
      const result = await callPurchasing(accessToken, "workspacemes_v4_purchasing_action", { purchasingAction, ...extra });
      setMessage(result.message || "Operazione completata.");
      if (successReload) await load();
      return true;
    } catch (actionError) { setError(actionError.message); return false; }
    finally { setBusy(""); }
  }

  function closePfPreview() {
    pfPreview?.files?.forEach((file) => URL.revokeObjectURL(file.url));
    setPfPreview(null); setPreviewIndex(0);
  }

  async function preparePfPreview(request) {
    setBusy("PREVIEW_PF"); setError(""); setMessage("");
    try {
      const plan = await callPurchasing(accessToken, "workspacemes_v4_purchasing_action", { purchasingAction: "PREVIEW_PF", ...request });
      const files = (await createPfPreviewPdfFiles(plan.documents)).map((file) => ({ ...file,
        url: URL.createObjectURL(new Blob([file.data], { type: "application/pdf" })) }));
      setPreviewIndex(0); setPfPreview({ ...plan, files, request });
    } catch (previewError) { setError(previewError.message); }
    finally { setBusy(""); }
  }

  async function confirmPfPreview() {
    if (!pfPreview) return;
    setBusy("CONFIRM_PF_PREVIEW"); setError(""); setMessage("");
    try {
      const result = await callPurchasing(accessToken, "workspacemes_v4_purchasing_action", {
        purchasingAction: "CONFIRM_PF_PREVIEW", ...pfPreview.request, previewHash: pfPreview.previewHash,
      });
      const emittedKeys = new Set(pfPreview.documents.flatMap((document) => document.lines.map((line) => line.key)));
      setSelected((current) => new Set([...current].filter((key) => !emittedKeys.has(key))));
      setMessage(result.message || "PF emessi in Mexal."); closePfPreview(); await load();
    } catch (confirmError) { closePfPreview(); setError(confirmError.message); }
    finally { setBusy(""); }
  }

  const toOrder = data.requirements.filter((row) => row.quantityToOrder > 0);
  const latestSaliProposal = data.saliDiIschiaProposals?.[0] || null;
  return <div className="production-page purchase-requirements-page">
    <div className="purchase-command-row">
      <div className="purchase-calculation-note"><strong>Come viene calcolato.</strong><span>Workspace applica i criteri MES ai dati certificati: giacenze disponibili dei magazzini 1 e 8, domande degli OP nuovi o pianificati e quantità residue degli ordini fornitore. Gli arrivi coprono soltanto necessità successive alla loro data.</span></div>
      <div className="purchase-command-bar">
        <button type="button" className="secondary-action" disabled={!canManage || Boolean(busy)} onClick={() => run("IMPORT_SUPPLIER_ORDERS")} title="Importa dal MES gli ordini fornitore aggiornati"><RefreshCw size={16}/>Importa ordini fornitore<ButtonInfo text="Aggiorna nel Workspace gli ordini fornitore presenti nel MES."/></button>
        <button type="button" className="secondary-action" disabled={!canManage || Boolean(busy)} onClick={() => run("GENERATE_SALI_DI_ISCHIA")} title="Calcola la proposta di riassortimento Sali di Ischia"><ShoppingCart size={16}/>Genera proposta Sali di Ischia<ButtonInfo text="Calcola una proposta dai consumi, dalle giacenze e dai tempi di consegna configurati."/></button>
        <button type="button" className="primary-action" disabled={Boolean(busy)} onClick={load} title="Ricalcola tutti i fabbisogni visualizzati"><RefreshCw className={loading ? "rdp-spin" : ""} size={16}/>Ricalcola lista<ButtonInfo text="Rilegge i dati certificati del MES e aggiorna fabbisogni e coperture."/></button>
      </div>
    </div>
    {message && <div className="purchase-feedback success" role="status"><CheckCircle2 size={18}/><span>{message}</span><button onClick={() => setMessage("")} aria-label="Chiudi"><X size={16}/></button></div>}
    {error && <div className="purchase-feedback error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Chiudi"><X size={16}/></button></div>}
    {latestSaliProposal && <section className="purchase-sali-proposal" aria-label="Ultima proposta Sali di Ischia">
      <header><div><span>Riassortimento Workspace</span><h2>Proposta Sali di Ischia del {date(latestSaliProposal.proposal_date)}</h2></div><strong>{latestSaliProposal.status}</strong></header>
      <p>Calcolo autonomo Workspace su vendite sincronizzate MEXAL, giacenza del magazzino {latestSaliProposal.warehouse_number} e lead time configurati.</p>
      <div>{(latestSaliProposal.lines || []).map((line) => <article key={line.id}><div><strong>{line.article_code}</strong><small>{line.description}</small></div><span>{quantity(line.proposed_quantity)} {line.unit_of_measure}</span><small>Giacenza {quantity(line.available_stock)} · consumo stimato {quantity(line.estimated_monthly_consumption)}/mese · {line.lead_time_days} gg</small></article>)}</div>
    </section>}
    {loading ? <div className="production-loading">Calcolo dei fabbisogni in corso…</div> : <>
      <div className="purchase-summary" aria-label="Filtri riepilogo fabbisogni"><button type="button" className={summaryFilter === "to_order" ? "active" : ""} aria-pressed={summaryFilter === "to_order"} onClick={() => applySummaryFilter("to_order")} title="Mostra i materiali con quantità da ordinare"><span>Articoli da approvvigionare<ButtonInfo text="Mostra i fabbisogni con quantità da ordinare maggiore di zero dopo giacenze e arrivi previsti."/></span><strong className="danger">{toOrder.length}</strong></button><button type="button" className={summaryFilter === "covered_arrivals" ? "active" : ""} aria-pressed={summaryFilter === "covered_arrivals"} onClick={() => applySummaryFilter("covered_arrivals")} title="Mostra i materiali coperti da consegne previste"><span>Articoli coperti da arrivi<ButtonInfo text="Mostra i fabbisogni coperti, alla data necessaria, dalle consegne fornitore già previste."/></span><strong>{data.requirements.filter((row) => row.status === "COVERED_BY_ARRIVALS").length}</strong></button><button type="button" className={summaryFilter === "all" ? "active" : ""} aria-pressed={summaryFilter === "all"} onClick={() => applySummaryFilter("all")} title="Mostra tutti i fabbisogni"><span>Fabbisogni totali<ButtonInfo text="Mostra tutte le righe materiale richieste dalle produzioni nuove o pianificate."/></span><strong>{data.requirements.length}</strong></button></div>
      <section className="purchase-toolbar"><div><strong>Suddivisione mensile</strong><span>I materiali sono raggruppati per data di necessità.</span></div><label><input type="checkbox" checked={onlyToOrder} onChange={(event) => { setOnlyToOrder(event.target.checked); setSummaryFilter(event.target.checked ? "to_order" : "all"); }}/>Mostra solo da ordinare</label></section>
      <nav className="purchase-month-index" aria-label="Vai al mese">{groups.map((group) => <a key={group.key} href={`#${monthId(group.month)}`}><span>{monthTitle(group.month)}</span><strong>{group.rows.length}</strong></a>)}</nav>
      <div className="purchase-months">{groups.map((group) => {
        const query = String(searchByMonth[group.key] || "").trim().toLocaleLowerCase("it-IT");
        const visibleRows = query ? group.rows.filter((row) => searchText(row).includes(query)) : group.rows;
        const groupToOrder = visibleRows.filter((row) => row.quantityToOrder > 0);
        const allSelected = groupToOrder.length > 0 && groupToOrder.every((row) => selected.has(row.key));
        const supplierId = supplierByMonth[group.key] || "";
        const selectedForGroup = selectedRows(group);
        return <section className="purchase-month-card" id={monthId(group.month)} key={group.key}>
          <header><div><span>Fabbisogni del mese</span><h2>{monthTitle(group.month)}</h2></div><div><b>{group.rows.filter((row) => row.quantityToOrder > 0).length}</b> da ordinare · <b>{group.rows.filter((row) => row.quantityToOrder <= 0).length}</b> coperti</div></header>
          <div className="purchase-month-actions">
            <button type="button" className="secondary-action" disabled={!groupToOrder.length} onClick={() => toggleGroup({ ...group, rows: visibleRows })} title="Seleziona o deseleziona i materiali ordinabili visibili">{allSelected ? "Deseleziona visibili" : "Seleziona da ordinare"}<ButtonInfo text="Applica la selezione alle sole righe visibili che hanno una quantità da ordinare."/></button>
            <select aria-label={`Fornitore PF ${monthTitle(group.month)}`} value={supplierId} onChange={(event) => setSupplierByMonth((current) => ({ ...current, [group.key]: event.target.value }))}><option value="">Seleziona fornitore PF…</option>{data.suppliers.map((item) => <option value={item.id} key={item.id}>{item.ragioneSociale} ({item.codiceMexal})</option>)}</select>
            <label className="purchase-quick-search"><Search size={16} aria-hidden="true"/><input type="search" value={searchByMonth[group.key] || ""} onChange={(event) => setSearchByMonth((current) => ({ ...current, [group.key]: event.target.value }))} placeholder="Ricerca rapida totale" aria-label={`Ricerca rapida nei fabbisogni di ${monthTitle(group.month)}`}/></label>
            <button type="button" className="secondary-action" disabled={!canManage || !supplierId || !selectedForGroup.length || Boolean(busy)} onClick={() => preparePfPreview({ mode: "manual", supplierId: Number(supplierId), month: group.month, selectedKeys: selectedForGroup.map((row) => row.key) })} title="Prepara manualmente un PF per il fornitore scelto">Prepara PF Mexal<ButtonInfo text="Genera l’anteprima PDF del PF manuale usando gli articoli selezionati e il fornitore indicato."/></button>
            <button type="button" className="primary-action" disabled={!canManage || !selectedForGroup.length || Boolean(busy)} onClick={() => preparePfPreview({ mode: "automatic", selectedKeys: selectedForGroup.map((row) => row.key) })} title="Genera l’anteprima dei PF automatici per i soli articoli selezionati"><FilePlus2 size={16}/>{busy === "PREVIEW_PF" ? "Anteprima…" : "Genera PF da selezionati"}<ButtonInfo text="Prepara i PDF dei PF automatici entro 60 giorni soltanto per gli articoli selezionati; l’emissione richiede conferma."/></button>
            <button type="button" className="secondary-action" disabled={!canManage || Boolean(busy) || !toOrder.length} onClick={() => preparePfPreview({ mode: "automatic" })} title="Genera l’anteprima dei PF necessari entro 60 giorni da oggi"><FilePlus2 size={16}/>Genera PF automatico<ButtonInfo text="Prepara i PDF di tutti i PF automatici evitando duplicati; l’emissione richiede conferma."/></button>
          </div>
          <div className="purchase-table-wrap" data-column-controls="off"><table><colgroup><col className="purchase-select-column"/><col className="purchase-material-column"/><col className="purchase-type-column"/><col className="purchase-required-column"/><col className="purchase-order-by-column"/><col className="purchase-demand-column"/><col className="purchase-stock-column"/><col className="purchase-arrival-column"/><col className="purchase-order-column"/><col className="purchase-pf-column"/><col className="purchase-supplier-column"/><col className="purchase-oct-column"/><col className="purchase-production-column"/><col className="purchase-status-column"/></colgroup><thead><tr><th className="purchase-select-cell" aria-label="Seleziona"></th><th>Materiale</th><th>Tipo</th><th>Necessario entro</th><th>Ordina entro</th><th>Fabbisogno</th><th>Giacenza</th><th>In arrivo</th><th>Da ordinare</th><th>PF Mexal</th><th>Consegne / fornitore</th><th>OCT</th><th>Ordini produzione</th><th>Stato</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.key} className={row.quantityToOrder > 0 ? "to-order" : ""}><td className="purchase-select-cell">{row.quantityToOrder > 0 && <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row)} aria-label={`Seleziona ${row.articleCode}`}/>}</td><td className="purchase-material-cell"><strong>{row.articleCode}</strong><small>{row.description}</small></td><td><span className="purchase-type">{typeLabel(row.articleType)}</span></td><td>{date(row.requiredAt)}</td><td><strong className={row.status === "ORDER_LATE" ? "late" : ""}>{date(row.orderBy)}</strong><small>{row.leadTimeDays} gg</small></td><td className="number">{quantity(row.requiredQuantity)} {row.unitOfMeasure}</td><td className="number">{quantity(row.availableStock)}</td><td className="number">{quantity(row.incomingQuantity)}</td><td className="number"><strong className={row.quantityToOrder > 0 ? "late" : "covered"}>{quantity(row.quantityToOrder)}</strong>{row.reorderLot > 0 && row.quantityToOrder > 0 && <small>netto {quantity(row.netRequirement)} · lotto {quantity(row.reorderLot)}</small>}</td><td>{row.pfDocuments ? <><span className="purchase-pf">{row.pfDocuments}</span><small>{quantity(row.pfQuantity)} {row.unitOfMeasure} proposti</small></> : "—"}</td><td><span>{row.supplierOrders || "Nessuna consegna datata"}</span><small>{row.supplierName}</small></td><td className="purchase-lineage">{row.octReferences || "—"}</td><td className="purchase-lineage">{row.productionOrders || "—"}</td><td><span className={`purchase-status ${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span></td></tr>)}</tbody></table>{!visibleRows.length && <p className="table-message">Nessun fabbisogno corrisponde alla ricerca.</p>}</div>
        </section>;
      })}</div>
      {!groups.length && <div className="rdp-empty">Non ci sono fabbisogni per gli ordini di produzione nuovi o pianificati.</div>}
      <p className="purchase-footnote">I documenti PF vengono creati solo dopo conferma. Restano proposte a fornitore e non aumentano la disponibilità futura finché non vengono trasformati in ordini fornitore effettivi.</p>
    </>}
    {pfPreview && <div className="pf-preview-backdrop" role="presentation"><section className="pf-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-preview-title"><header><div><span>Anteprima non emessa</span><h2 id="pf-preview-title">PF Mexal · {previewIndex + 1} di {pfPreview.files.length}</h2><p>{pfPreview.documents[previewIndex]?.supplierName} · {pfPreview.documents[previewIndex]?.lines.length} articoli</p></div><button type="button" className="secondary-action" onClick={closePfPreview} disabled={Boolean(busy)} aria-label="Chiudi anteprima"><X size={18}/></button></header><div className="pf-preview-document"><iframe src={pfPreview.files[previewIndex]?.url} title={`Anteprima ${pfPreview.files[previewIndex]?.name}`}/></div><footer><div className="pf-preview-navigation"><button type="button" className="secondary-action" disabled={previewIndex === 0 || Boolean(busy)} onClick={() => setPreviewIndex((value) => value - 1)}><ChevronLeft size={16}/>Precedente</button><a className="secondary-action" href={pfPreview.files[previewIndex]?.url} download={pfPreview.files[previewIndex]?.name}><Download size={16}/>Scarica anteprima</a><button type="button" className="secondary-action" disabled={previewIndex >= pfPreview.files.length - 1 || Boolean(busy)} onClick={() => setPreviewIndex((value) => value + 1)}>Successivo<ChevronRight size={16}/></button></div><div className="pf-preview-confirm"><span>{pfPreview.documentCount} PF · {pfPreview.lineCount} righe. Nessun documento è stato ancora scritto.</span><button type="button" className="secondary-action" onClick={closePfPreview} disabled={Boolean(busy)}>Annulla</button><button type="button" className="primary-action" onClick={confirmPfPreview} disabled={Boolean(busy)}><FilePlus2 size={16}/>{busy === "CONFIRM_PF_PREVIEW" ? "Emissione…" : "Conferma ed emetti PF"}</button></div></footer></section></div>}
    {!canManage && <p className="rdp-diagnostic-readonly">Permesso purchases.manage richiesto per importazioni e creazione PF.</p>}
  </div>;
}

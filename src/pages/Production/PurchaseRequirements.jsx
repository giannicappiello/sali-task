import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FilePlus2, RefreshCw, ShoppingCart, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import InfoTooltip from "../../components/InfoTooltip";

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

export default function PurchaseRequirements() {
  const { session, hasPermission } = useAuth();
  const accessToken = session?.access_token;
  const canManage = hasPermission?.("purchases.manage");
  const [data, setData] = useState({ requirements: [], suppliers: [], saliDiIschiaProposals: [] });
  const [selected, setSelected] = useState(new Set());
  const [supplierByMonth, setSupplierByMonth] = useState({});
  const [confirmMonth, setConfirmMonth] = useState("");
  const [onlyToOrder, setOnlyToOrder] = useState(false);
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

  const rows = useMemo(() => onlyToOrder ? data.requirements.filter((row) => row.quantityToOrder > 0) : data.requirements, [data.requirements, onlyToOrder]);
  const groups = useMemo(() => Object.values(rows.reduce((result, row) => {
    const key = String(row.month || "");
    result[key] ||= { key, month: row.month, rows: [] };
    result[key].rows.push(row);
    return result;
  }, {})).sort((a, b) => String(a.month).localeCompare(String(b.month))), [rows]);

  function toggle(row) { setSelected((current) => { const next = new Set(current); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; }); setConfirmMonth(""); }
  function toggleGroup(group) {
    const ids = group.rows.filter((row) => row.quantityToOrder > 0).map((row) => row.key);
    setSelected((current) => { const next = new Set(current); ids.every((id) => next.has(id)) ? ids.forEach((id) => next.delete(id)) : ids.forEach((id) => next.add(id)); return next; });
    setConfirmMonth("");
  }
  const selectedRows = (group) => group.rows.filter((row) => row.quantityToOrder > 0 && selected.has(row.key));

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

  async function createPf(group) {
    const rowsToSend = selectedRows(group);
    const supplierId = Number(supplierByMonth[group.key]);
    if (!supplierId || !rowsToSend.length) { setError("Seleziona il fornitore e almeno un materiale da ordinare."); return; }
    const ok = await run("CREATE_PF", { supplierId, month: group.month,
      lines: rowsToSend.map((row) => ({ articleId: row.articleId, quantity: row.quantityToOrder, requiredAt: row.requiredAt })) });
    if (ok) { setSelected((current) => { const next = new Set(current); rowsToSend.forEach((row) => next.delete(row.key)); return next; }); setConfirmMonth(""); }
  }

  const toOrder = data.requirements.filter((row) => row.quantityToOrder > 0);
  const latestSaliProposal = data.saliDiIschiaProposals?.[0] || null;
  return <div className="production-page purchase-requirements-page">
    <div className="purchase-command-row">
      <div className="purchase-calculation-note"><strong>Come viene calcolato.</strong><span>Workspace applica i criteri MES ai dati certificati: giacenze disponibili dei magazzini 1 e 8, domande degli OP nuovi o pianificati e quantità residue degli ordini fornitore. Gli arrivi coprono soltanto necessità successive alla loro data.</span></div>
      <div className="purchase-command-bar">
        <button type="button" className="secondary-action" disabled={!canManage || Boolean(busy)} onClick={() => run("IMPORT_SUPPLIER_ORDERS")}><RefreshCw size={16}/>Importa ordini fornitore</button>
        <button type="button" className="secondary-action" disabled={!canManage || Boolean(busy)} onClick={() => run("GENERATE_SALI_DI_ISCHIA")}><ShoppingCart size={16}/>Genera proposta Sali di Ischia</button>
        <button type="button" className="secondary-action" disabled={!canManage || Boolean(busy) || !toOrder.length} onClick={() => run("GENERATE_PF_AUTOMATIC")}><FilePlus2 size={16}/>Genera PF automatico</button>
        <button type="button" className="primary-action" disabled={Boolean(busy)} onClick={load}><RefreshCw className={loading ? "rdp-spin" : ""} size={16}/>Ricalcola lista</button>
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
      <div className="purchase-summary"><article><span>Articoli da approvvigionare<InfoTooltip label="Articoli da approvvigionare" text="Numero di fabbisogni con quantità da ordinare maggiore di zero dopo giacenze e arrivi previsti." /></span><strong className="danger">{toOrder.length}</strong></article><article><span>Articoli coperti da arrivi<InfoTooltip label="Articoli coperti da arrivi" text="Numero di fabbisogni coperti, alla data necessaria, dalle consegne fornitore già previste." /></span><strong>{data.requirements.filter((row) => row.status === "COVERED_BY_ARRIVALS").length}</strong></article><article><span>Fabbisogni totali<InfoTooltip label="Fabbisogni totali" text="Numero complessivo di righe materiale richieste dalle produzioni nuove o pianificate." /></span><strong>{data.requirements.length}</strong></article></div>
      <section className="purchase-toolbar"><div><strong>Suddivisione mensile</strong><span>I materiali sono raggruppati per data di necessità.</span></div><label><input type="checkbox" checked={onlyToOrder} onChange={(event) => setOnlyToOrder(event.target.checked)}/>Mostra solo da ordinare</label></section>
      <nav className="purchase-month-index" aria-label="Vai al mese">{groups.map((group) => <a key={group.key} href={`#${monthId(group.month)}`}><span>{monthTitle(group.month)}</span><strong>{group.rows.length}</strong></a>)}</nav>
      <div className="purchase-months">{groups.map((group) => {
        const groupToOrder = group.rows.filter((row) => row.quantityToOrder > 0);
        const allSelected = groupToOrder.length > 0 && groupToOrder.every((row) => selected.has(row.key));
        const supplierId = supplierByMonth[group.key] || "";
        const selectedForGroup = selectedRows(group);
        const supplier = data.suppliers.find((item) => String(item.id) === String(supplierId));
        return <section className="purchase-month-card" id={monthId(group.month)} key={group.key}>
          <header><div><span>Fabbisogni del mese</span><h2>{monthTitle(group.month)}</h2></div><div><b>{groupToOrder.length}</b> da ordinare · <b>{group.rows.length - groupToOrder.length}</b> coperti</div></header>
          {!!groupToOrder.length && <div className="purchase-month-actions"><button type="button" className="secondary-action" onClick={() => toggleGroup(group)}>{allSelected ? "Deseleziona materiali" : "Seleziona da ordinare"}</button><select aria-label={`Fornitore PF ${monthTitle(group.month)}`} value={supplierId} onChange={(event) => { setSupplierByMonth((current) => ({ ...current, [group.key]: event.target.value })); setConfirmMonth(""); }}><option value="">Seleziona fornitore PF…</option>{data.suppliers.map((item) => <option value={item.id} key={item.id}>{item.ragioneSociale} ({item.codiceMexal})</option>)}</select><button type="button" className="primary-action" disabled={!canManage || !supplierId || !selectedForGroup.length || Boolean(busy)} onClick={() => setConfirmMonth(group.key)}>Prepara PF Mexal</button></div>}
          {confirmMonth === group.key && <div className="purchase-confirm"><div><strong>Conferma creazione PF</strong><span>Verrà creato un documento per <b>{supplier?.ragioneSociale}</b> con <b>{selectedForGroup.length}</b> righe e consegne previste in {monthTitle(group.month)}.</span></div><div><button type="button" className="secondary-action" onClick={() => setConfirmMonth("")} disabled={Boolean(busy)}>Annulla</button><button type="button" className="primary-action" onClick={() => createPf(group)} disabled={Boolean(busy)}>{busy === "CREATE_PF" ? "Creazione in corso…" : "Conferma e crea PF"}</button></div></div>}
          <div className="purchase-table-wrap"><table><colgroup><col className="purchase-select-column"/><col className="purchase-material-column"/><col className="purchase-type-column"/><col className="purchase-required-column"/><col className="purchase-order-by-column"/><col className="purchase-demand-column"/><col className="purchase-stock-column"/><col className="purchase-arrival-column"/><col className="purchase-order-column"/><col className="purchase-pf-column"/><col className="purchase-supplier-column"/><col className="purchase-oct-column"/><col className="purchase-production-column"/><col className="purchase-status-column"/></colgroup><thead><tr><th className="purchase-select-cell" aria-label="Seleziona"></th><th>Materiale</th><th>Tipo</th><th>Necessario entro</th><th>Ordina entro</th><th>Fabbisogno</th><th>Giacenza</th><th>In arrivo</th><th>Da ordinare</th><th>PF Mexal</th><th>Consegne / fornitore</th><th>OCT</th><th>Ordini produzione</th><th>Stato</th></tr></thead><tbody>{group.rows.map((row) => <tr key={row.key} className={row.quantityToOrder > 0 ? "to-order" : ""}><td className="purchase-select-cell">{row.quantityToOrder > 0 && <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row)} aria-label={`Seleziona ${row.articleCode}`}/>}</td><td className="purchase-material-cell"><strong>{row.articleCode}</strong><small>{row.description}</small></td><td><span className="purchase-type">{typeLabel(row.articleType)}</span></td><td>{date(row.requiredAt)}</td><td><strong className={row.status === "ORDER_LATE" ? "late" : ""}>{date(row.orderBy)}</strong><small>{row.leadTimeDays} gg</small></td><td className="number">{quantity(row.requiredQuantity)} {row.unitOfMeasure}</td><td className="number">{quantity(row.availableStock)}</td><td className="number">{quantity(row.incomingQuantity)}</td><td className="number"><strong className={row.quantityToOrder > 0 ? "late" : "covered"}>{quantity(row.quantityToOrder)}</strong>{row.reorderLot > 0 && row.quantityToOrder > 0 && <small>netto {quantity(row.netRequirement)} · lotto {quantity(row.reorderLot)}</small>}</td><td>{row.pfDocuments ? <><span className="purchase-pf">{row.pfDocuments}</span><small>{quantity(row.pfQuantity)} {row.unitOfMeasure} proposti</small></> : "—"}</td><td><span>{row.supplierOrders || "Nessuna consegna datata"}</span><small>{row.supplierName}</small></td><td className="purchase-lineage">{row.octReferences || "—"}</td><td className="purchase-lineage">{row.productionOrders || "—"}</td><td><span className={`purchase-status ${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span></td></tr>)}</tbody></table></div>
        </section>;
      })}</div>
      {!groups.length && <div className="rdp-empty">Non ci sono fabbisogni per gli ordini di produzione nuovi o pianificati.</div>}
      <p className="purchase-footnote">I documenti PF vengono creati solo dopo conferma. Restano proposte a fornitore e non aumentano la disponibilità futura finché non vengono trasformati in ordini fornitore effettivi.</p>
    </>}
    {!canManage && <p className="rdp-diagnostic-readonly">Permesso purchases.manage richiesto per importazioni e creazione PF.</p>}
  </div>;
}

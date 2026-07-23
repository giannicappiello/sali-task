from pathlib import Path

page = Path('src/modules/orders/pages/NewOrder.jsx')
source = page.read_text(encoding='utf-8')

money_block = '''function money(value) {
  return Number(value || 0).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}
'''
money_replacement = money_block + '''
function pieces(value) {
  return Number(value || 0).toLocaleString("it-IT");
}
'''
if money_block not in source:
    raise SystemExit('money block not found')
source = source.replace(money_block, money_replacement, 1)

preview_line = '''  const availabilityPreview = useMemo(() => buildAvailabilityPreview(lines, availability?.lines), [lines, availability]);
'''
preview_replacement = preview_line + '''  const documentPreviewTotals = useMemo(() => ({
    ocm: availabilityPreview.ocm.reduce((sum, item) => sum + numberValue(item.quantity), 0),
    oci: availabilityPreview.oci.reduce((sum, item) => sum + numberValue(item.quantity), 0),
    ocx: availabilityPreview.ocx.reduce((sum, item) => sum + numberValue(item.quantity), 0),
  }), [availabilityPreview]);
'''
if preview_line not in source:
    raise SystemExit('availability preview line not found')
source = source.replace(preview_line, preview_replacement, 1)

old_availability = '''        {availability && <div className="orders-availability-results">
          <p>Verifica {availability.status === "completed" ? "completata" : "completata con errori"} alle {new Date(availability.checkedAt).toLocaleString("it-IT")} · Magazzino {availability.warehouse}.</p>
          <p>Richiesta: {availability.summary.requestedQuantity} · Confermabile: {availability.summary.confirmedQuantity} · Mancante: {availability.summary.missingQuantity} · Disponibili: {availability.summary.availableLines} · Parziali: {availability.summary.partialLines} · Non disponibili: {availability.summary.unavailableLines} · Errori: {availability.summary.errorLines}</p>
          <table className="orders-table"><thead><tr><th>Prodotto</th><th>Richiesta</th><th>Disponibile</th><th>Confermabile</th><th>Mancante</th><th>Stato</th></tr></thead><tbody>
            {availability.lines.map((result) => { const line = lines.find((item) => item.codice_articolo === result.productCode); const labels = { available: "Disponibile", partial: "Parzialmente disponibile", unavailable: "Non disponibile", error: "Errore di verifica" }; return <tr key={result.productCode}><td>{result.productCode} · {line?.descrizione || "-"}</td><td>{result.requestedQuantity}</td><td>{result.availableQuantity ?? "-"}</td><td>{result.confirmedQuantity}</td><td>{result.missingQuantity}</td><td>{labels[result.status]}{result.message ? ` — ${result.message}` : ""}</td></tr>; })}
          </tbody></table>
          <div className="orders-calculation-detail"><div><span>Disponibile — futuro OCM</span><strong>{availabilityPreview.ocm.map((item) => `${item.productCode}: ${item.quantity}`).join(" · ") || "Nessuna riga"}</strong></div><div><span>Mancante — futuro OCX</span><strong>{availabilityPreview.ocx.map((item) => `${item.productCode}: ${item.quantity}`).join(" · ") || "Nessuna riga"}</strong></div></div>
        </div>}
'''
new_availability = '''        {availability && (
          <div className="orders-availability-results orders-availability-summary">
            <div className="orders-availability-check">
              <strong>✓ Verifica completata</strong>
              <span>{new Date(availability.checkedAt).toLocaleString("it-IT")}</span>
              <span>Magazzino {availability.warehouse}</span>
              <span className="orders-availability-errors">Errori: {availability.summary.errorLines}</span>
            </div>

            <div className="orders-document-preview">
              <div><span>Futuro OCM</span><strong>{pieces(documentPreviewTotals.ocm)} pezzi</strong></div>
              <div><span>Futuro OCI</span><strong>{pieces(documentPreviewTotals.oci)} pezzi</strong></div>
              <div><span>Futuro OCX</span><strong>{pieces(documentPreviewTotals.ocx)} pezzi</strong></div>
            </div>
          </div>
        )}
'''
if old_availability not in source:
    raise SystemExit('availability render block not found')
source = source.replace(old_availability, new_availability, 1)

old_footer = '''      <div className="orders-order-footer">
        <div className="orders-order-total">
          <span>{totals.pezzi} pezzi</span>
          <span>Imponibile: {money(totals.totale_imponibile)} · IVA: {money(totals.totale_iva)}</span>
          <strong>{money(totals.totale_documento)}</strong>
          <small>Totale documento</small>
        </div>
        <div className="orders-order-actions">
          <button className="orders-secondary" type="button" disabled={saving} onClick={() => saveOrder({ confirm: false })}>
            <Save size={18} /> Salva bozza
          </button>
          <button className="orders-primary" type="button" disabled={saving || checkingAvailability || !availabilityValidity.valid || productsMissingVat.length > 0} onClick={() => saveOrder({ confirm: true })}>
            <ShoppingCart size={18} /> {saving ? "Salvataggio..." : "Conferma ordine"}
          </button>
          {!availabilityValidity.valid && <small className="orders-confirmation-note">{availabilityValidity.reason}</small>}
          {productsMissingVat.length > 0 && <small className="orders-confirmation-note">IVA mancante: {productsMissingVat.map((line) => line.codice_articolo).join(", ")}</small>}
        </div>
      </div>
'''
new_footer = '''      <div className="orders-order-footer">
        <div className="orders-order-total orders-order-total-enhanced">
          <div><span>Totale ordine</span><strong>{pieces(totals.pezzi)} pezzi</strong></div>
          <div><span>Imponibile</span><strong>{money(totals.totale_imponibile)}</strong></div>
          <div><span>IVA</span><strong>{money(totals.totale_iva)}</strong></div>
          <div className="orders-order-grand-total"><span>TOTALE</span><strong>{money(totals.totale_documento)}</strong></div>
        </div>
        <div className="orders-order-actions">
          {availability && (
            <div className="orders-split-summary">
              <strong>L'ordine verrà suddiviso automaticamente in:</strong>
              <span>OCM: {pieces(documentPreviewTotals.ocm)} pezzi (evasione immediata)</span>
              <span>OCI: {pieces(documentPreviewTotals.oci)} pezzi</span>
              <span>OCX: {pieces(documentPreviewTotals.ocx)} pezzi (backorder)</span>
            </div>
          )}
          <button className="orders-secondary" type="button" disabled={saving} onClick={() => saveOrder({ confirm: false })}>
            <Save size={18} /> Salva bozza
          </button>
          <button className="orders-primary" type="button" disabled={saving || checkingAvailability || !availabilityValidity.valid || productsMissingVat.length > 0} onClick={() => saveOrder({ confirm: true })}>
            <ShoppingCart size={18} /> {saving ? "Salvataggio..." : "Conferma ordine"}
          </button>
          {!availabilityValidity.valid && <small className="orders-confirmation-note">{availabilityValidity.reason}</small>}
          {productsMissingVat.length > 0 && <small className="orders-confirmation-note">IVA mancante: {productsMissingVat.map((line) => line.codice_articolo).join(", ")}</small>}
        </div>
      </div>
'''
if old_footer not in source:
    raise SystemExit('footer block not found')
source = source.replace(old_footer, new_footer, 1)
page.write_text(source, encoding='utf-8')

css_path = Path('src/modules/orders/orders-module.css')
css = css_path.read_text(encoding='utf-8')
marker = '/* PR118 native order summary */'
styles = '''

/* PR118 native order summary */
.orders-availability-summary{display:flex;flex-direction:column;gap:16px;margin-top:16px}.orders-availability-check{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid #bbf7d0;border-radius:12px;background:#f0fdf4;color:#166534}.orders-availability-check strong{font-size:16px}.orders-availability-check span{font-size:14px}.orders-availability-errors{margin-top:6px;font-weight:700}.orders-document-preview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.orders-document-preview>div{display:flex;flex-direction:column;gap:6px;padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}.orders-document-preview span{font-size:13px;color:#64748b}.orders-document-preview strong{font-size:18px;color:#0f172a}.orders-order-total-enhanced{display:grid;grid-template-columns:repeat(4,max-content);gap:22px;align-items:end;text-align:right}.orders-order-total-enhanced>div{display:flex;flex-direction:column;gap:3px}.orders-order-total-enhanced span{font-size:12px;color:#64748b}.orders-order-total-enhanced strong{font-size:17px;color:#0f172a}.orders-order-total-enhanced .orders-order-grand-total strong{font-size:25px}.orders-order-actions{align-items:center;flex-wrap:wrap;justify-content:flex-end}.orders-split-summary{display:flex;flex-direction:column;gap:3px;max-width:390px;margin-right:6px;padding:10px 12px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:12px}.orders-split-summary strong{font-size:13px}@media(max-width:900px){.orders-document-preview{grid-template-columns:1fr}.orders-order-total-enhanced{grid-template-columns:repeat(2,1fr);width:100%;text-align:left}.orders-split-summary{max-width:none;width:100%;box-sizing:border-box}}@media(max-width:650px){.orders-order-footer{max-height:72vh;overflow:auto}.orders-order-total-enhanced{grid-template-columns:repeat(2,1fr);gap:10px 18px}.orders-order-actions{grid-template-columns:1fr 1fr}.orders-split-summary{grid-column:1/-1}.orders-order-total-enhanced .orders-order-grand-total strong{font-size:23px}}
'''
if marker not in css:
    css_path.write_text(css.rstrip() + styles + '\n', encoding='utf-8')

for obsolete in [
    Path('src/modules/orders/pages/NewOrderPresentation.jsx'),
    Path('src/modules/orders/orders-summary.css'),
    Path('src/modules/orders/services/orderPerformanceMonitor.js'),
    Path('.github/workflows/apply-orders-summary-pr118.yml'),
    Path('.github/workflows/apply-orders-summary-pr118-on-pr.yml'),
    Path('.github/pr118-trigger.txt'),
    Path('.github/scripts/apply_pr118.py'),
]:
    if obsolete.exists():
        obsolete.unlink()

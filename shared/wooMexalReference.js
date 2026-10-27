import {sameFirstDecimal} from '../integrations/salidischia-mexal-connector/src/money-policy.mjs';
export const MEXAL_OC_META_KEY = '_sdi_mexal_oc_v1';
const reasons = {
  order_changed: 'L’ordine è cambiato dopo l’importazione: occorre riconciliarlo.',
  reconciliation_required: 'Invio precedente da verificare prima di riprovare.',
  address_invalid: 'Indirizzo o indicazioni di consegna da verificare.',
  api_error: 'Il gestionale o il sito ha restituito un errore API.',
  validation_failed: 'Dati ordine non validi per l’invio al gestionale.',
  totals_mismatch: 'I totali differiscono alla prima cifra decimale: controllare righe, IVA e spedizione.',
};
export function wooMexalSyncStatus(order) {
  const entries=(order?.meta_data||[]).filter(x=>x.key==='_sdi_mexal_sync_v1');
  if(entries.length!==1)return null;
  const v=entries[0].value;
  if(v?.version!==1||v.source_order_id!==String(order.id)||!['verified','blocked'].includes(v.status)||!Number.isFinite(Date.parse(v.checked_at)))return null;
  const diagnostic=/^mexal_(\d{1,8})_([a-z][a-z0-9_]{0,63})$/.exec(v.error_code||'');
  const message=v.status==='blocked'?(diagnostic?`Mexal ha rifiutato il campo ${diagnostic[2]} (errore ${diagnostic[1]}).`:reasons[v.error_code]||reasons.validation_failed):null;
  const c=v.amount_comparison;
  const validComparison=v.status==='verified'&&c?.policy==='first_decimal'&&sameFirstDecimal(c.sourceTotalCents,c.mexalTotalCents)&&sameFirstDecimal(c.sourceTaxCents,c.mexalTaxCents)&&c.totalDifferenceCents===c.mexalTotalCents-c.sourceTotalCents&&c.taxDifferenceCents===c.mexalTaxCents-c.sourceTaxCents;
  return {status:v.status,message,checkedAt:v.checked_at,catalogAt:Number.isFinite(Date.parse(v.catalog_at))?v.catalog_at:null,...(validComparison?{amountComparison:c}:{})};
}

export function formatMexalOrderReference(value) {
  const match = typeof value === 'string' && /^OC[+/](\d{1,3})[+/]([1-9]\d{0,9})$/.exec(value);
  return match ? `OC/${Number(match[1])}/${Number(match[2])}` : null;
}

export function wooMexalOrderReference(order) {
  const entries = (order?.meta_data || []).filter(entry => entry.key === MEXAL_OC_META_KEY);
  if (entries.length !== 1) return null;
  const value = entries[0].value;
  if (!value || value.version !== 1 || value.verified !== true || String(value.source_order_id) !== String(order.id)) return null;
  return formatMexalOrderReference(value.reference);
}

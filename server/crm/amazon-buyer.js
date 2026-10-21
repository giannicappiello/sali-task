import { request, refreshAccessToken } from './digital-provider-adapters.js';
import { safeFetch } from './digital-security.js';

// Buyer names are requested on demand after the caller's authorization. Do not
// persist buyer PII in import snapshots, logs, customer accounts or probe results.
export async function fetchAmazonOrderWithBuyer(connection, secrets, orderId, { fetcher = safeFetch, now = new Date() } = {}) {
  const root = { eu:'https://sellingpartnerapi-eu.amazon.com', na:'https://sellingpartnerapi-na.amazon.com', fe:'https://sellingpartnerapi-fe.amazon.com' }[connection.configurazione?.region || 'eu'];
  if (!root) throw new Error('Regione Amazon non valida.');
  const token = await refreshAccessToken(connection,secrets,fetcher);
  const options = { headers: { 'x-amz-access-token':token.access_token, 'user-agent':'Workspace/1.0 (Language=JavaScript; Platform=Node.js)',
    'x-amz-date':now.toISOString().replace(/[:-]|\.\d{3}/g,''), accept:'application/json' } };
  const endpoint = `${root}/orders/2026-01-01/orders/${encodeURIComponent(orderId)}`;
  let data, denied = false;
  try {
    data = await request(`${endpoint}?includedData=PROCEEDS,FULFILLMENT,BUYER`,options,fetcher,'Nominativo acquirente Amazon');
  } catch (error) {
    if (error.code !== 'provider_403') throw error;
    // The fallback must itself succeed before identifying a buyer-role denial.
    data = await request(`${endpoint}?includedData=PROCEEDS,FULFILLMENT`,options,fetcher,'Dettaglio ordine Amazon');
    denied = true;
  }
  if (String(data.order?.orderId) !== String(orderId) || !Array.isArray(data.order?.orderItems)) throw new Error('Dettaglio ordine Amazon non valido.');
  const customerName = !denied && typeof data.order.buyer?.buyerName === 'string' ? data.order.buyer.buyerName.trim().slice(0,200) || null : null;
  return { order:data.order, customerName, buyerAccess:customerName ? 'provided' : denied ? 'denied' : 'not_provided' };
}

export function amazonBuyerUnavailable(access, status) {
  if (access === 'denied') return 'Amazon ha negato l’accesso al nominativo: verificare i ruoli riservati ai dati acquirente dell’applicazione.';
  if (access === 'unavailable') return 'Richiesta del nominativo Amazon non completata. Riprova dal dettaglio ordine.';
  if (String(status || '').toUpperCase() === 'PENDING') return 'Amazon non rende ancora disponibile il nominativo per questo ordine in attesa.';
  return 'Nome cliente non fornito da Amazon nella richiesta BUYER: verificare i permessi e la disponibilità del dato per questo ordine.';
}

export async function probeAmazonBuyer({ authorize, loadOrder, connection, secrets, fetcher }) {
  await authorize();
  const order = await loadOrder();
  if (!order) throw Object.assign(new Error('Nessun ordine Amazon spedito disponibile per la verifica.'),{status:404});
  const c = await connection(order.connection_id);
  if (c.provider_code !== 'amazon_sp_api' || !c.abilitata) throw Object.assign(new Error('Connessione Amazon non attiva.'),{status:409});
  const result = await fetchAmazonOrderWithBuyer(c,await secrets(c.id),order.external_id,{fetcher});
  // Internal scheduler diagnostics expose only availability, never the name.
  return { orderNumber:order.external_id, buyerAccess:result.buyerAccess, available:Boolean(result.customerName),
    reason:result.customerName ? null : amazonBuyerUnavailable(result.buyerAccess,result.order.fulfillment?.fulfillmentStatus) };
}

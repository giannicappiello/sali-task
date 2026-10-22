/* global Buffer */
import { sheetHtml, sheetText } from '../shared/directProductSheet.js';
import { safeFetch } from './crm/digital-security.js';
import { request, refreshAccessToken } from './crm/digital-provider-adapters.js';

const fail = message => Object.assign(new Error(message), { status: 409 });
const noRedirects = (url, options) => safeFetch(url, { ...options, redirects: 2 });
const amazonHosts = { eu: 'https://sellingpartnerapi-eu.amazon.com', na: 'https://sellingpartnerapi-na.amazon.com', fe: 'https://sellingpartnerapi-fe.amazon.com' };
// Provider contracts: https://developer.woocommerce.com/docs/apis/rest-api/v3/products
// https://developer-docs.amazon.com/sp-api/reference/patchlistingsitem
export async function publishSheetToChannel({ connection, mapping, content, secrets, fetcher = noRedirects }) {
  const config = connection.configurazione || {};
  if (connection.provider_code === 'woocommerce') {
    const base = String(config.site_url || connection.site_url || '').replace(/\/$/, '');
    const headers = { authorization: `Basic ${Buffer.from(`${secrets.consumer_key}:${secrets.consumer_secret}`).toString('base64')}`, 'content-type': 'application/json' };
    if (!secrets.consumer_key || !secrets.consumer_secret) throw fail('Credenziali del sito non complete.');
    const products = await request(`${base}/wp-json/wc/v3/products?sku=${encodeURIComponent(mapping.external_sku)}`, { headers }, fetcher);
    const exact = Array.isArray(products) ? products.filter(p => p.sku === mapping.external_sku) : [];
    if (exact.length !== 1 || !Number.isInteger(exact[0].id)) throw fail('SKU non trovato in modo univoco sul sito. Nessun articolo aggiornato.');
    const data = await request(`${base}/wp-json/wc/v3/products/${exact[0].id}`, { method: 'PUT', headers, body: JSON.stringify({ description: sheetHtml(content), short_description: sheetHtml({ description: content.description }) }) }, fetcher);
    if (data.id !== exact[0].id) throw fail('Il sito non ha confermato il prodotto aggiornato.');
    return { status: 'sent', message: 'Contenuti inviati al sito.' };
  }
  if (connection.provider_code === 'amazon_sp_api') {
    const marketplace = mapping.marketplace;
    if (!config.seller_id || !marketplace || !(config.marketplace_ids || connection.marketplace_ids || []).includes(marketplace)) throw fail('Seller ID o marketplace Amazon della riconciliazione non valido.');
    const token = await refreshAccessToken(connection, secrets, fetcher);
    if (!token.access_token) throw fail('Autenticazione Amazon non riuscita.');
    const base = amazonHosts[config.region || 'eu']; if (!base) throw fail('Regione Amazon non valida.');
    const url = `${base}/listings/2021-08-01/items/${encodeURIComponent(config.seller_id)}/${encodeURIComponent(mapping.external_sku)}`;
    const query = `marketplaceIds=${encodeURIComponent(marketplace)}`;
    const headers = { 'x-amz-access-token': token.access_token, 'content-type': 'application/json' };
    const current = await request(`${url}?${query}&includedData=attributes,summaries`, { headers }, fetcher);
    const summary = current.summaries?.find(s => s.marketplaceId === marketplace);
    if (!summary?.productType) throw fail('Tipologia prodotto Amazon non disponibile.');
    const existing = current.attributes?.product_description || [], target = existing.find(v => v.marketplace_id === marketplace);
    const language = target?.language_tag || ({ APJ6JRA9NG5V4: 'it_IT' })[marketplace];
    // Content publication currently targets Italian copy; foreign listings require a reviewed translation workflow.
    if (language !== 'it_IT') throw fail('Per questo marketplace occorre un testo approvato nella lingua della destinazione. La pubblicazione automatica attuale usa la scheda italiana.');
    const attributes = [...existing.filter(v => v.marketplace_id !== marketplace), { value: sheetText(content), language_tag: language, marketplace_id: marketplace }];
    const data = await request(`${url}?${query}`, { method: 'PATCH', headers, body: JSON.stringify({ productType: summary.productType, patches: [{ op: 'replace', path: '/attributes/product_description', value: attributes }] }) }, fetcher);
    const issues = (data.issues || []).filter(i => i.severity === 'ERROR');
    if (data.status !== 'ACCEPTED' || issues.length) throw fail(`Amazon non ha accettato il testo${issues.length ? ` (${issues.map(i => String(i.code).replace(/[^A-Za-z0-9_-]/g, '')).join(', ')})` : ''}.`);
    return { status: 'accepted', message: 'Accettato da Amazon; la visibilità nella pagina dipende dalla successiva elaborazione Amazon.' };
  }
  throw fail('Canale non supportato per la pubblicazione delle schede.');
}

/* global Buffer */
import { wooCustomer, mailchimpCustomer, wooOrder } from './commerce-import.js';
import { request } from './digital-provider-adapters.js';
import { safeFetch } from './digital-security.js';

// Independent, bounded cursor: refreshing contacts must not interrupt an order import.
export async function fetchCustomerProfiles(connection, secrets, cursor = {}, fetcher = safeFetch) {
  const page = Number(cursor.page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('Pagina anagrafiche non valida.');
  const get = (url, headers) => request(url, { headers, timeoutMs: 20000, maxBytes: 4000000 }, fetcher, 'Aggiornamento anagrafiche');
  if (connection.provider_code === 'woocommerce') {
    const phase = cursor.phase || 'customers';
    if (!['customers', 'orders'].includes(phase)) throw new Error('Fase anagrafiche non valida.');
    const root = String(connection.configurazione.site_url).replace(/\/$/, '') + '/wp-json/wc/v3/';
    const headers = { authorization: `Basic ${Buffer.from(`${secrets.consumer_key}:${secrets.consumer_secret}`).toString('base64')}` };
    const data = await get(`${root}${phase}?per_page=50&page=${page}&orderby=id&order=asc`, headers);
    if (!Array.isArray(data)) throw new Error('Anagrafiche WooCommerce non valide.');
    // Reuse the same stable guest/provider identity as the normal order import.
    const rows = phase === 'customers' ? data.map(wooCustomer) : data.map(r => { const order = wooOrder(r); return { ...order.customer, order_external_id: order.external_id, order_lines: order.lines }; });
    const next = data.length === 50 ? { phase, page: page + 1 } : phase === 'customers' ? { phase: 'orders', page: 1 } : null;
    return { rows, next };
  }
  if (connection.provider_code === 'mailchimp') {
    const dc = connection.configurazione.data_center || String(secrets.api_key || '').split('-').pop();
    if (!/^us\d+$/.test(dc)) throw new Error('Data center non valido.');
    const root = `https://${dc}.api.mailchimp.com/3.0/`;
    const headers = { authorization: secrets.access_token ? `Bearer ${secrets.access_token}` : `Basic ${Buffer.from(`workspace:${secrets.api_key}`).toString('base64')}` };
    const audiences = await get(`${root}lists?count=1000&fields=lists.id,total_items`, headers);
    if (!Array.isArray(audiences.lists) || audiences.total_items > audiences.lists.length) throw new Error('Elenco audience incompleto.');
    const audienceIndex = Number(cursor.audienceIndex || 0);
    if (!Number.isInteger(audienceIndex) || audienceIndex < 0) throw new Error('Audience non valida.');
    const audience = audiences.lists[audienceIndex];
    if (!audience) return { rows: [], next: null };
    const schema = await get(`${root}lists/${encodeURIComponent(audience.id)}/merge-fields?count=1000`, headers);
    if (!Array.isArray(schema.merge_fields) || schema.total_items > schema.merge_fields.length) throw new Error('Campi Mailchimp incompleti.');
    const data = await get(`${root}lists/${encodeURIComponent(audience.id)}/members?count=50&offset=${(page - 1) * 50}`, headers);
    if (!Array.isArray(data.members)) throw new Error('Contatti Mailchimp non validi.');
    const next = (page - 1) * 50 + data.members.length < data.total_items ? { audienceIndex, page: page + 1 }
      : audienceIndex + 1 < audiences.lists.length ? { audienceIndex: audienceIndex + 1, page: 1 } : null;
    return { rows: data.members.map(member => mailchimpCustomer(member, schema.merge_fields)), next };
  }
  throw new Error('Anagrafiche non accessibili con questo connettore. Per Amazon servono i ruoli autorizzati per i dati personali.');
}


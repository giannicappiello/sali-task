const required = (env, key) => {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`Configurare ${key} in .env.local.`);
  return value;
};

async function requestJson(url, headers, fetcher, { method = 'GET', payload, metadata = false,timeoutMs=30000 } = {}) {
  // Reject redirect-based credential forwarding, invalid TLS and unbounded waits.
  const response = await fetcher(url, { method, headers: payload === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  const declaredSize = Number(response.headers?.get('content-length') || 0);
  if (declaredSize > 8 * 1024 * 1024) throw new Error('Risposta API troppo grande.');
  // Stream with a hard cap even if Content-Length is absent or incorrect.
  const parts = []; let length = 0;
  for await (const part of response.body || []) {
    length += part.length;
    if (length > 8 * 1024 * 1024) throw new Error('Risposta API troppo grande.');
    parts.push(part);
  }
  try {
    const raw = Buffer.concat(parts).toString('utf8');
    let data=null;
    try { data=raw.trim()?JSON.parse(raw):null; }
    catch { if(response.ok)throw new Error('L’API non ha restituito JSON valido.'); }
    if (!response.ok) {
      const detail=data?.error?.['response-detail'];
      const diagnostic=typeof detail==='string'?/^(\d{1,8}) - [^\[]*\[([a-z][a-z0-9_]{0,63})\b/i.exec(detail):null;
      const error = new Error(`${method === 'GET' ? 'Lettura' : 'Richiesta'} API non riuscita (HTTP ${response.status}).${diagnostic?` Mexal ${diagnostic[1]}, campo ${diagnostic[2]}.`:''}`);
      error.status = response.status;
      // Keep diagnostics out of console logs: providers may echo customer data.
      Object.defineProperty(error,'apiDetails',{value:data});
      throw error;
    }
    return metadata ? { data, status: response.status, location: response.headers.get('location') } : data;
  }
  catch (error) { if (error.status) throw error; throw new Error('L’API non ha restituito JSON valido.'); }
}

function baseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Configurare un endpoint API HTTPS senza credenziali nell’URL.');
  }
  return url.href.replace(/\/+$/, '');
}

export function wooClient(env = process.env, fetcher = fetch, {enableWrites=false}={}) {
  const root = baseUrl(required(env, 'WOO_URL'));
  const auth = Buffer.from(`${required(env, 'WOO_CONSUMER_KEY')}:${required(env, 'WOO_CONSUMER_SECRET')}`).toString('base64');
  return {
    async publishMexalSyncStatus(id,value) {
      if(!enableWrites)throw new Error('Scritture WooCommerce disabilitate.');
      if(!Number.isSafeInteger(id)||id<1||value?.version!==1||value.source_order_id!==String(id)||!['verified','blocked'].includes(value.status)||!/^[a-z0-9_]{0,100}$/.test(value.error_code||''))throw new Error('Stato sincronizzazione non valido.');
      return requestJson(`${root}/wp-json/wc/v3/orders/${id}`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher,{method:'PUT',payload:{meta_data:[{key:'_sdi_mexal_sync_v1',value}]}});
    },
    async publishMexalOrderReference(id,value) {
      if(!enableWrites)throw new Error('Scritture WooCommerce disabilitate.');
      if(!Number.isSafeInteger(id)||id<1||value?.version!==1||value.verified!==true||value.source_order_id!==String(id)||!/^OC\+\d{1,3}\+[1-9]\d{0,9}$/.test(value.reference||''))throw new Error('Riferimento OC non valido.');
      return requestJson(`${root}/wp-json/wc/v3/orders/${id}`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher,{method:'PUT',payload:{meta_data:[{key:'_sdi_mexal_oc_v1',value}]}});
    },
    async products(page=1) {
      if(!Number.isInteger(page)||page<1)throw new Error('Pagina prodotti non valida.');
      return requestJson(`${root}/wp-json/wc/v3/products?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,parent_id,sku,type,status,regular_price,sale_price,tax_status,tax_class,manage_stock,stock_quantity,stock_status,backorders,meta_data`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async variations(id,page=1) {
      if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(page)||page<1)throw new Error('Prodotto o pagina non validi.');
      return requestJson(`${root}/wp-json/wc/v3/products/${id}/variations?per_page=100&page=${page}`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async taxSetting() {
      return requestJson(`${root}/wp-json/wc/v3/settings/tax/woocommerce_prices_include_tax`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async updateProduct(id,payload,parentId=null) {
      if(!enableWrites)throw new Error('Scritture WooCommerce disabilitate.');
      if(!Number.isSafeInteger(id)||id<1||(parentId!==null&&(!Number.isSafeInteger(parentId)||parentId<1)))throw new Error('ID prodotto non valido.');
      const path=parentId===null?`products/${id}`:`products/${parentId}/variations/${id}`;
      return requestJson(`${root}/wp-json/wc/v3/${path}`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher,{method:'PUT',payload});
    },
    async product(id,parentId=null) {
      if(!Number.isSafeInteger(id)||id<1||(parentId!==null&&(!Number.isSafeInteger(parentId)||parentId<1)))throw new Error('ID prodotto non valido.');
      const path=parentId===null?`products/${id}`:`products/${parentId}/variations/${id}`;
      return requestJson(`${root}/wp-json/wc/v3/${path}?_fields=id,sku,regular_price,sale_price,manage_stock,stock_quantity,stock_status,backorders,meta_data`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async productBatch(updates,parentId=null) {
      if(!enableWrites)throw new Error('Scritture WooCommerce disabilitate.');
      if(!Array.isArray(updates)||!updates.length||updates.length>10||updates.some(p=>!Number.isSafeInteger(p.id)||p.id<1)||(parentId!==null&&(!Number.isSafeInteger(parentId)||parentId<1)))throw new Error('Lotto prodotti non valido.');
      const path=parentId===null?'products/batch':`products/${parentId}/variations/batch`;
      return requestJson(`${root}/wp-json/wc/v3/${path}`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher,{method:'POST',payload:{update:updates},timeoutMs:120000});
    },
    async productsByIds(ids,parentId=null) {
      if(!Array.isArray(ids)||!ids.length||ids.length>10||ids.some(id=>!Number.isSafeInteger(id)||id<1)||(parentId!==null&&(!Number.isSafeInteger(parentId)||parentId<1)))throw new Error('Selezione prodotti non valida.');
      const path=parentId===null?'products':`products/${parentId}/variations`;
      return requestJson(`${root}/wp-json/wc/v3/${path}?include=${ids.join(',')}&per_page=100&_fields=id,sku,regular_price,sale_price,manage_stock,stock_quantity,stock_status,backorders,meta_data`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async latestOrder() {
      const rows=await requestJson(`${root}/wp-json/wc/v3/orders?per_page=1&orderby=id&order=desc&status=any`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
      if(!Array.isArray(rows)||!rows[0]?.id)throw new Error('Ultimo ordine WooCommerce non leggibile.');
      return rows[0];
    },
    async paymentGateways() {
      return requestJson(`${root}/wp-json/wc/v3/payment_gateways?_fields=id,title,enabled`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async connectorStatus() {
      return requestJson(`${root}/wp-json/wc-sdi/v1/connector-status`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async orders({status,page,after}) {
      if(!['processing','completed'].includes(status)||!Number.isInteger(page)||page<1||!/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(after))throw new Error('Filtri ordini WooCommerce non validi.');
      const query=new URLSearchParams({status,page:String(page),per_page:'100',after,orderby:'id',order:'asc'});
      return requestJson(`${root}/wp-json/wc/v3/orders?${query}`,{Authorization:`Basic ${auth}`,Accept:'application/json'},fetcher);
    },
    async order(id) {
      if (!/^\d+$/.test(String(id)) || Number(id) <= 0) throw new Error('ID ordine non valido.');
      const result = await requestJson(`${root}/wp-json/wc/v3/orders/${id}`, { Authorization: `Basic ${auth}`, Accept: 'application/json' }, fetcher);
      if (String(result.id) !== String(id)) throw new Error('L’API ha restituito un ordine diverso.');
      return result;
    },
  };
}

export function mexalReader(env = process.env, fetcher) {
  const root = baseUrl(required(env, 'MEXAL_BASE_URL'));
  fetcher ||= env.MEXAL_CERT_SHA256 ? pinnedFetch(root,env.MEXAL_CERT_SHA256) : fetch;
  const auth = Buffer.from(`${required(env, 'MEXAL_USERNAME')}:${required(env, 'MEXAL_PASSWORD')}`).toString('base64');
  const company = required(env, 'MEXAL_AZIENDA'), year = required(env, 'MEXAL_ANNO'), warehouse = required(env, 'MEXAL_MAGAZZINO');
  if (!/^[A-Z0-9_-]+$/i.test(company) || !/^\d{4}$/.test(year) || !/^\d+$/.test(warehouse)) throw new Error('Coordinate azienda/anno/magazzino non valide.');
  const headers = { Authorization: `Passepartout ${auth}`, 'Coordinate-Gestionale': `Azienda=${company} Anno=${year} Magazzino=${warehouse}`, Accept: 'application/json' };
  return {
    async help(resource) {
      if (!['clienti', 'documenti/ordini-clienti', 'documenti/ordini-clienti/righe'].includes(resource)) throw new Error('Risorsa non prevista.');
      return requestJson(`${root}/webapi/risorse/${resource}?info=true`, headers, fetcher);
    },
  };
}

// Writes are deliberately separate from the reader and require a verified contract.
export function mexalTransport(env = process.env, fetcher, { enableWrites = false } = {}) {
  const root = baseUrl(required(env, 'MEXAL_BASE_URL'));
  fetcher ||= env.MEXAL_CERT_SHA256 ? pinnedFetch(root,env.MEXAL_CERT_SHA256) : fetch;
  const company=required(env,'MEXAL_AZIENDA'),year=required(env,'MEXAL_ANNO'),warehouse=required(env,'MEXAL_MAGAZZINO');
  if (!/^[A-Z0-9_-]+$/i.test(company) || !/^\d{4}$/.test(year) || !/^\d+$/.test(warehouse)) throw new Error('Coordinate azienda/anno/magazzino non valide.');
  const headers={Authorization:`Passepartout ${Buffer.from(`${required(env,'MEXAL_USERNAME')}:${required(env,'MEXAL_PASSWORD')}`).toString('base64')}`,
    'Coordinate-Gestionale':`Azienda=${company} Anno=${year} Magazzino=${warehouse}`,Accept:'application/json'};
  return {
    company, year, warehouse:Number(warehouse),
    async orderPrintModules() {
      return requestJson(`${root}/webapi/risorse/documenti/moduli-stampa/OC`,headers,fetcher,{metadata:true});
    },
    async search(resource,filters,{pageToken,max=100}={}) {
      if(!['clienti','documenti/ordini-clienti','documenti/movimenti-magazzino'].includes(resource)||!Array.isArray(filters)||filters.some(x=>!['=','contiene','>='].includes(x.condizione)))throw new Error('Ricerca Mexal non consentita.');
      const query=new URLSearchParams({max:String(max)});if(pageToken)query.set('next',pageToken);
      return requestJson(`${root}/webapi/risorse/${resource}/ricerca?${query}`,headers,fetcher,{method:'POST',payload:{filtri:filters},metadata:true});
    },
    async calculateDocument(document) {
      return requestJson(`${root}/webapi/servizi`,headers,fetcher,{method:'POST',payload:{cmd:'totali_documento',dati:{in_documento:document}},metadata:true});
    },
    async documentTotals(reference,customerCode) {
      const match=/^OC\+(\d+)\+(\d+)$/.exec(reference);
      if(!match)throw new Error('Riferimento OC non valido per i totali.');
      return requestJson(`${root}/webapi/servizi`,headers,fetcher,{method:'POST',payload:{cmd:'totali_documento',dati:{in_sigla:'OC',in_serie:Number(match[1]),in_numero:Number(match[2]),in_cod_conto:customerCode}},metadata:true});
    },
    async request(path, { method='GET', payload }={}) {
      if (!/^\/(aziende|clienti|articoli|indirizzi-spedizione|documenti\/ordini-clienti|documenti\/movimenti-magazzino|dati-generali)(\/|\?|$)/.test(path) || /[\\\r\n#]/.test(path) || /%2e|\.\./i.test(path)) throw new Error('Percorso Mexal non consentito.');
      if(path.startsWith('/documenti/movimenti-magazzino')&&method!=='GET')throw new Error('Movimenti disponibili soltanto in lettura.');
      if (path.startsWith('/aziende') && method!=='GET') throw new Error('Le aziende sono disponibili soltanto in lettura.');
      if (!['GET','POST','PUT'].includes(method)) throw new Error('Metodo Mexal non consentito.');
      if (method!=='GET' && !enableWrites) throw new Error('Scritture Mexal disabilitate.');
      return requestJson(`${root}/webapi/risorse${path}`,headers,fetcher,{method,payload,metadata:true});
    },
  };
}
import { pinnedFetch } from './pinned-fetch.mjs';

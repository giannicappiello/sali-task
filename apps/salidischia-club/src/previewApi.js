import { combinedPrice } from './offerPricing.js';
// Simulation writes remain local. The optional reader is used only for catalog reads.
export function createPreviewApi({ readCatalog } = {}) {
  const now = () => new Date().toISOString();
  const copy = value => structuredClone(value);
  const program = { cashback_percent: 5, reimbursement_modes: ['products', 'prizes', 'money'], delivery_methods: ['pickup', 'home'], cash_minimum: 20, cash_method: 'bank_transfer', shipping_fee: 4.9, shipping_payment: 'wallet', free_shipping_threshold: 30 };
  const info = { program, registration_available: true, privacy_url: '/regolamento?documento=privacy', terms_url: '/regolamento?documento=program', support_email: '' };
  const stores = [{ store_code: 'DEMO-A', name: 'Negozio dimostrativo Ischia', address: 'Indirizzo dimostrativo', postal_code: '80077', province: 'NA' }, { store_code: 'DEMO-B', name: 'Negozio dimostrativo Napoli', address: 'Indirizzo dimostrativo', postal_code: '80100', province: 'NA' }];
  const member = { id: 'demo-member', name: 'Cliente dimostrativo', member_code: 'CLUB-DEMO-001', joined_at: now(), store_code: stores[0].store_code, store_name: stores[0].name };
  const wallet = { available: 80, reserved: 15, used: 5 };
  const rewards = [{ id: 'demo-reward', name: 'Crema viso · esempio', kind: 'products', description: 'Premio dimostrativo per verificare il riscatto e la consegna.', budget_required: 15, stock: 10, delivery_methods: ['pickup', 'home'] }, { id: 'demo-prize', name: 'Rituale benessere · esempio', kind: 'prizes', description: 'Premio dimostrativo per verificare il catalogo.', budget_required: 30, stock: 5, delivery_methods: ['pickup'] }];
  let products = [{ id: 'demo-product', name: 'Crema viso · esempio', code: 'DEMO-01', list_price: 30, category_ids: [1] }, { id: 'demo-oil', name: 'Olio corpo · esempio', code: 'DEMO-02', list_price: 20, category_ids: [2] }, { id: 'demo-gift', name: 'Mini crema · esempio', code: 'DEMO-03', list_price: 10, category_ids: [1] }];
  if (readCatalog) products = [];
  let categories = [{ id: 1, name: 'Skin Care', parent_id: null }, { id: 2, name: 'Body Care', parent_id: null }], catalogLoad;
  const catalogRequests = new Map();
  async function readCatalogOnce(name, args = {}) {
    const key = JSON.stringify([name, args]);
    if (!catalogRequests.has(key)) catalogRequests.set(key, Promise.resolve().then(() => readCatalog(name, args)).catch(error => { catalogRequests.delete(key);throw error; }));
    return catalogRequests.get(key);
  }
  async function loadCategories() {
    if (!readCatalog) return;
    if (!catalogLoad) catalogLoad = readCatalogOnce('club_catalog_categories').then(rows => { categories = rows; }).catch(error => { catalogLoad = null;throw error; });
    await catalogLoad;
  }
  function remember(rows) {
    const entries = rows.filter(Boolean).map(p => ({ ...p, list_price: p.pricing?.list_price ?? null }));
    for (const product of entries) { const index = products.findIndex(p => p.id === product.id);if (index < 0) products.push(product);else products[index] = product; }
    return entries;
  }
  const offers = [];
  const purchases = [{ id: 'demo-purchase', amount: 100, cashback: 5, status: 'confirmed', created_at: now(), store_name: stores[0].name, customer_name: member.name, items: [{ name: 'Acquisto dimostrativo', quantity: 2, amount: 100 }] }];
  const requests = [{ id: 'demo-request', reward_name: rewards[0].name, mode: 'products', amount: 15, reserved_amount: 15, shipping_fee: 0, shipping_payment: 'wallet', delivery_method: 'pickup', status: 'approved', created_at: now(), store_name: stores[0].name, customer_name: member.name, member_code: member.member_code, pickup_code: 'DEMO123456', store_code: stores[0].store_code, reward_id: rewards[0].id }];
  const consents = { marketing: false, profiling: false };
  const idem = new Map();
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  function page(rows, args, size = 20) { return { total: rows.length, rows: rows.slice(args.page_offset || 0, (args.page_offset || 0) + size) }; }
  function filter(rows, search = '') { return rows.filter(row => Object.values(row).join(' ').toLowerCase().includes(search.toLowerCase())); }
  function inCategory(product, target) {
    return (product.category_ids || []).some(id => {
      const visited = new Set();
      while (id != null && !visited.has(id)) { if (Number(id) === target) return true;visited.add(id);id = categories.find(c => c.id === Number(id))?.parent_id; }
      return false;
    });
  }
  const activeOffers = () => offers.filter(o => o.status === 'published' && o.store_code === member.store_code && new Date(o.starts_at) <= new Date() && (!o.ends_at || new Date(o.ends_at) > new Date()));
  let publication = 0;
  function catalogProduct(product) {
    if (!product) return null;
    const active = offers.filter(o => o.status === 'published' && o.store_code === member.store_code && new Date(o.starts_at) <= new Date() && (!o.ends_at || new Date(o.ends_at) > new Date()));
    const applicable = active.filter(o => o.kind === 'discount' ? o.scope === 'all' || o.product_id === product.id || inCategory(product, Number(o.category_id)) : o.gift_product_id === product.id || o.requirements.some(r => r.product_id === product.id));
    const pricing = combinedPrice(product, active, { inCategory });
    const sale = pricing.price, percent = sale != null && product.list_price > 0 && sale < product.list_price ? round(100 * (1 - sale / product.list_price)) : 0;
    return { ...copy(product), description: product.description || '', image_url: product.image_url || null, website_url: product.website_url || null, media: product.media || [], pricing: { ...pricing, discount_percent: percent, store_code: member.store_code, store_name: member.store_name, offers: copy(applicable) } };
  }
  const requireMember = code => { if (code !== member.member_code || member.store_code !== 'DEMO-A') throw Error('Cliente non disponibile per questo negozio dimostrativo.'); };
  async function rpc(name, args = {}) {
    let result;
    if (readCatalog && ['club_catalog_products','club_browse_catalog','club_catalog_product','club_store_products'].includes(name)) {
      const method = name === 'club_store_products' ? 'club_catalog_products' : name;
      const [catalog] = await Promise.all([readCatalogOnce(method, args), loadCategories()]);
      if (name === 'club_catalog_product') return catalogProduct(remember([catalog])[0]);
      const rows = remember(catalog.rows).map(catalogProduct);
      return name === 'club_store_products' ? rows : { ...catalog, rows };
    }
    switch (name) {
      case 'club_catalog_categories': await loadCategories();return copy(categories);
      case 'club_pdf_sections': return readCatalog ? copy(await readCatalogOnce('club_pdf_sections')) : [];
      case 'club_feed': return { rows: [], total: 0 };
      case 'club_post': return null;
      case 'club_browse_catalog':
      case 'club_catalog_products': result = page(filter(products, args.search_text).filter(p => !args.category_id || inCategory(p, Number(args.category_id))).map(catalogProduct), args, 24);break;
      case 'club_catalog_product': result = catalogProduct(products.find(p => p.id === args.target_id));break;
      case 'club_shop_offers': result = { ...page(offers.filter(o => o.status === 'published' && o.store_code === member.store_code), args, 12), store_code: member.store_code, store_name: member.store_name };break;
      case 'club_my_store_offers': result = { ...page(offers, args, 20), store_code: stores[0].store_code, store_name: stores[0].name };break;
      case 'club_store_offer_editor': result = offers.find(o => o.id === args.target_id);if (!result) throw Error('Offerta dimostrativa non trovata.');break;
      case 'club_save_store_offer': {
        const existing = offers.find(o => o.id === args.target_id);if (existing?.status === 'published') throw Error('Duplica l’offerta pubblicata.');
        const value = { ...copy(args.payload), combination_mode: args.payload.combination_mode || 'best', id: args.target_id || crypto.randomUUID(), status: 'draft', updated_at: now(), starts_at: args.payload.starts_at || now(), store_code: stores[0].store_code, store_name: stores[0].name, category_name: categories.find(c => c.id === Number(args.payload.category_id))?.name, product_name: products.find(p => p.id === args.payload.product_id)?.name, gift_name: products.find(p => p.id === args.payload.gift_product_id)?.name, requirements: (args.payload.requirements || []).map(row => ({ ...row, name: products.find(p => p.id === row.product_id)?.name })) };
        if (existing) Object.assign(existing, value);else offers.unshift(value);result = value.id;break;
      }
      case 'club_publish_store_offer': {
        const offer = offers.find(o => o.id === args.target_id);if (!offer) throw Error('Offerta dimostrativa non trovata.');offer.status = args.archive ? 'archived' : 'published';offer.published_at = new Date(Math.max(Date.now(), publication + 1)).toISOString();publication = new Date(offer.published_at).getTime();offer.updated_at = now();break;
      }
      case 'club_quote_store_offer': {
        const active = activeOffers(), offer = active.find(o => o.id === args.target_id);if (!offer) throw Error('Offerta dimostrativa non disponibile.');
        const selected = id => args.items.filter(p => p.product_id === id).reduce((n, p) => n + p.quantity, 0);
        const missing = (offer.requirements || []).filter(row => selected(row.product_id) < row.quantity).map(row => ({ ...row, required: row.quantity, selected: selected(row.product_id) }));
        const options = { items: args.items, quoteTarget: offer.id, inCategory };
        const gifts = active.filter(o => o.kind === 'bundle_gift' && (o.combination_mode !== 'best' || o.id === offer.id) && o.requirements.every(r => selected(r.product_id) >= r.quantity && combinedPrice(products.find(p => p.id === r.product_id), active, options).applied_offer_ids.includes(o.id))).map(o => ({ offer_id: o.id, product_id: o.gift_product_id, name: o.gift_name, quantity: o.gift_quantity }));
        result = { qualifies: !missing.length, missing, offer, gifts, gift: gifts.find(g => g.offer_id === offer.id) || null, lines: [...new Set(args.items.map(r => r.product_id))].map(id => { const product = products.find(p => p.id === id);return { product_id: id, quantity: selected(id), name: product.name, base_price: catalogProduct(product).pricing.price, ...combinedPrice(product, active, options) }; }) };break;
      }
      case 'club_member_portal': result = { member, wallet, rewards: rewards.filter(r => r.stock > 0), public_info: info, consents }; break;
      case 'club_list_stores': result = page(filter(stores, args.search_text), args, 25); break;
      case 'club_select_store': {
        const store = stores.find(s => s.store_code === args.target_store_code);
        if (!store) throw Error('Negozio non disponibile.');
        member.store_code = store.store_code; member.store_name = store.name; break;
      }
      case 'club_member_history': result = page(args.history_kind === 'requests' ? requests : purchases, args); break;
      case 'club_update_consents': Object.assign(consents, { marketing: args.marketing, profiling: args.profiling }); break;
      case 'club_create_request': {
        if (idem.has(args.idempotency_key)) return idem.get(args.idempotency_key);
        const reward = rewards.find(r => r.id === args.target_reward_id), cash = args.target_mode === 'money';
        if (!cash && (!reward || reward.stock < 1)) throw Error('Premio non disponibile.');
        const amount = cash ? Number(args.target_amount) : reward.budget_required;
        if (!Number.isFinite(amount) || amount <= 0 || (cash && amount < program.cash_minimum)) throw Error('Importo non valido.');
        const shipping = args.target_delivery === 'home' && amount < program.free_shipping_threshold ? program.shipping_fee : 0;
        const reserved = round(amount + shipping);
        if (reserved > wallet.available) throw Error('Budget disponibile insufficiente.');
        if (['pickup', 'store_cash'].includes(args.target_delivery) && !member.store_code) throw Error('Scegli il negozio di fiducia.');
        const id = crypto.randomUUID();
        requests.unshift({ id, reward_name: cash ? 'Rimborso in denaro · esempio' : reward.name, mode: args.target_mode, amount, reserved_amount: reserved, shipping_fee: shipping, shipping_payment: program.shipping_payment, delivery_method: args.target_delivery, status: 'pending', created_at: now(), store_name: member.store_name, store_code: member.store_code, customer_name: member.name, member_code: member.member_code, pickup_code: 'DEMO123456', reward_id: reward?.id });
        wallet.available = round(wallet.available - reserved); wallet.reserved = round(wallet.reserved + reserved); if (reward) reward.stock--; idem.set(args.idempotency_key, id); result = id; break;
      }
      case 'club_cancel_request': {
        const row = requests.find(r => r.id === args.target_id);
        if (!row || !['pending', 'approved', 'ready'].includes(row.status)) throw Error('Richiesta non annullabile.');
        row.status = 'cancelled'; wallet.available = round(wallet.available + row.reserved_amount); wallet.reserved = round(wallet.reserved - row.reserved_amount); const reward = rewards.find(r => r.id === row.reward_id); if (reward) reward.stock++; break;
      }
      case 'club_store_portal': result = { ...page(member.store_code === 'DEMO-A' ? filter([{ ...member, name: member.name }], args.search_text) : [], args, 25), store_name: stores[0].name, pending_pickups: requests.filter(r => ['approved', 'ready'].includes(r.status) && r.store_code === 'DEMO-A' && member.store_code === 'DEMO-A' && ['pickup', 'store_cash'].includes(r.delivery_method)).length }; break;
      case 'club_lookup_member': requireMember(args.member_code); result = { ...member, available: wallet.available }; break;
      case 'club_store_products': result = filter(products, args.search_text).slice(args.page_offset || 0, (args.page_offset || 0) + 30); break;
      case 'club_record_purchase': {
        if (idem.has(args.idempotency_key)) return copy(idem.get(args.idempotency_key));
        requireMember(args.member_code);
        if (!args.items?.length || args.items.some(i => !products.some(p => p.id === i.product_id) || !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.amount) || i.amount < 0)) throw Error('Prodotti o importi non validi.');
        const amount = round(args.items.reduce((sum, item) => sum + item.amount, 0)); if (amount <= 0) throw Error('Importo non valido.');
        const cashback = round(amount * program.cashback_percent / 100);
        const row = { id: crypto.randomUUID(), amount, cashback, status: 'confirmed', created_at: now(), customer_name: member.name, store_name: stores[0].name, items: args.items.map(i => ({ ...i, name: products.find(p => p.id === i.product_id).name })) };
        purchases.unshift(row); wallet.available = round(wallet.available + cashback); idem.set(args.idempotency_key, row); result = row; break;
      }
      case 'club_store_history': result = page(member.store_code === 'DEMO-A' ? purchases : [], args); break;
      case 'club_reverse_purchase': {
        requireMember(member.member_code); const row = purchases.find(p => p.id === args.target_id);
        if (!row) throw Error('Acquisto non disponibile.'); if (row.status === 'reversed') break;
        if (!args.reason?.trim()) throw Error('Indica la motivazione.');
        if (wallet.available < row.cashback) throw Error('Cashback già utilizzato o riservato.');
        row.status = 'reversed'; wallet.available = round(wallet.available - row.cashback); break;
      }
      case 'club_store_pickups': result = requests.filter(r => r.store_code === 'DEMO-A' && member.store_code === 'DEMO-A' && ['approved', 'ready'].includes(r.status) && ['pickup', 'store_cash'].includes(r.delivery_method)).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'pickup_code'))); break;
      case 'club_store_handover': {
        requireMember(member.member_code); const row = requests.find(r => r.id === args.target_id && r.store_code === 'DEMO-A');
        if (!row || row.pickup_code !== args.pickup_code) throw Error('Codice di ritiro non valido.'); if (row.status === 'completed') break;
        if (!['approved', 'ready'].includes(row.status)) throw Error('Richiesta non pronta.');
        row.status = 'completed'; wallet.reserved = round(wallet.reserved - row.reserved_amount); wallet.used = round(wallet.used + row.reserved_amount); break;
      }
      case 'club_enrollment_identity': return { kind: previewRetailer ? 'store' : 'consumer', email: previewRetailer ? 'negozio@example.test' : 'cliente@example.test', first_name: '', last_name: '', legal_name: previewRetailer ? 'Rivenditore dimostrativo Ischia' : undefined, shop_name: previewShopName };
      case 'club_enroll_retailer': if (!args.first_name?.trim() || !args.last_name?.trim() || !args.accept_program || !args.profiling) throw Error('Completa dati e consensi del negozio.');result = stores[0].store_code;break;
      case 'club_enroll_member': if (!args.first_name?.trim() || !args.last_name?.trim() || args.email_address !== 'cliente@example.test' || !args.accept_program || !args.profiling) throw Error('Completa nome, cognome, email e consensi.');Object.assign(consents, { marketing: false, profiling: true });result = member.id; break;
      default: throw Error('Questa azione non è disponibile nella prova. Nessun dato reale è stato modificato.');
    }
    return result === undefined ? null : copy(result);
  }
  let previewRetailer = false, previewShopName = '';
  async function retailerRegistration(input) { if (input.mode === 'lookup') { if (!/^(IT)?[0-9]{11}$/i.test(input.vat_number.replace(/\s/g, ''))) throw Error('Inserisci una partita IVA di 11 cifre.');return { token: 'demo', legal_name: 'Rivenditore dimostrativo Ischia', masked_email: 'n•••@example.test' }; }if (input.password?.length < 6) throw Error('Password di almeno 6 caratteri.');previewRetailer = true;previewShopName = input.shop_name;return { message: 'Account rivenditore simulato: nessuna email inviata. Usa Modulo di iscrizione per completare la prova.' }; }
  return { rpc, retailerRegistration, info: copy(info), auth: { signInWithPassword: async () => ({ error: null, preview: true }), signUp: async () => ({ data: { session: null }, error: null, preview: true }), resetPasswordForEmail: async () => ({ error: null, preview: true }) } };
}

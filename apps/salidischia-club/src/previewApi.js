// Isolated, explicitly labelled demonstration state. No Supabase transport is
// reachable from this adapter, including for unsupported actions.
export function createPreviewApi() {
  const now = () => new Date().toISOString();
  const copy = value => structuredClone(value);
  const program = { cashback_percent: 5, reimbursement_modes: ['products', 'prizes', 'money'], delivery_methods: ['pickup', 'home'], cash_minimum: 20, cash_method: 'bank_transfer', shipping_fee: 4.9, shipping_payment: 'wallet', free_shipping_threshold: 30 };
  const info = { program, registration_available: true, privacy_url: '/regolamento?documento=privacy', terms_url: '/regolamento?documento=program', support_email: '' };
  const stores = [{ store_code: 'DEMO-A', name: 'Negozio dimostrativo Ischia', address: 'Indirizzo dimostrativo', postal_code: '80077', province: 'NA' }, { store_code: 'DEMO-B', name: 'Negozio dimostrativo Napoli', address: 'Indirizzo dimostrativo', postal_code: '80100', province: 'NA' }];
  const member = { id: 'demo-member', name: 'Cliente dimostrativo', member_code: 'CLUB-DEMO-001', joined_at: now(), store_code: stores[0].store_code, store_name: stores[0].name };
  const wallet = { available: 80, reserved: 15, used: 5 };
  const rewards = [{ id: 'demo-reward', name: 'Crema viso · esempio', kind: 'products', description: 'Premio dimostrativo per verificare il riscatto e la consegna.', budget_required: 15, stock: 10, delivery_methods: ['pickup', 'home'] }, { id: 'demo-prize', name: 'Rituale benessere · esempio', kind: 'prizes', description: 'Premio dimostrativo per verificare il catalogo.', budget_required: 30, stock: 5, delivery_methods: ['pickup'] }];
  const products = [{ id: 'demo-product', name: 'Crema viso · esempio', code: 'DEMO-01' }];
  const purchases = [{ id: 'demo-purchase', amount: 100, cashback: 5, status: 'confirmed', created_at: now(), store_name: stores[0].name, customer_name: member.name, items: [{ name: products[0].name, quantity: 2, amount: 100 }] }];
  const requests = [{ id: 'demo-request', reward_name: rewards[0].name, mode: 'products', amount: 15, reserved_amount: 15, shipping_fee: 0, shipping_payment: 'wallet', delivery_method: 'pickup', status: 'approved', created_at: now(), store_name: stores[0].name, customer_name: member.name, member_code: member.member_code, pickup_code: 'DEMO123456', store_code: stores[0].store_code, reward_id: rewards[0].id }];
  const consents = { marketing: false, profiling: false };
  const idem = new Map();
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  function page(rows, args, size = 20) { return { total: rows.length, rows: rows.slice(args.page_offset || 0, (args.page_offset || 0) + size) }; }
  function filter(rows, search = '') { return rows.filter(row => Object.values(row).join(' ').toLowerCase().includes(search.toLowerCase())); }
  const requireMember = code => { if (code !== member.member_code || member.store_code !== 'DEMO-A') throw Error('Cliente non disponibile per questo negozio dimostrativo.'); };
  async function rpc(name, args = {}) {
    let result;
    switch (name) {
      case 'club_catalog_categories': return [];
      case 'club_catalog_products': case 'club_feed': return { rows: [], total: 0 };
      case 'club_catalog_product': case 'club_post': return null;
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
        if (!args.items?.length || args.items.some(i => i.product_id !== products[0].id || !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.amount) || i.amount < 0)) throw Error('Prodotti o importi non validi.');
        const amount = round(args.items.reduce((sum, item) => sum + item.amount, 0)); if (amount <= 0) throw Error('Importo non valido.');
        const cashback = round(amount * program.cashback_percent / 100);
        const row = { id: crypto.randomUUID(), amount, cashback, status: 'confirmed', created_at: now(), customer_name: member.name, store_name: stores[0].name, items: args.items.map(i => ({ ...i, name: products[0].name })) };
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
      case 'club_enroll_member': if (!args.accept_program || args.display_name.trim().length < 2) throw Error('Completa nome e accettazione del programma.'); result = member.id; break;
      default: throw Error('Questa azione non è disponibile nella prova. Nessun dato reale è stato modificato.');
    }
    return result === undefined ? null : copy(result);
  }
  return { rpc, info: copy(info), auth: { signInWithPassword: async () => ({ error: null, preview: true }), signUp: async () => ({ data: { session: null }, error: null, preview: true }), resetPasswordForEmail: async () => ({ error: null, preview: true }) } };
}

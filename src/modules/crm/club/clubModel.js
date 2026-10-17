export const CLUB_PATH = '/crm/online/salidischiaclub';
export const CLUB_SCREENS = Object.freeze({ dashboard: 'crm.online.club.dashboard', requests: 'crm.online.club.richieste', configuration: 'crm.online.club.configurazione', rewards: 'crm.online.club.premi', members: 'crm.online.club.clienti', stores: 'crm.online.club.negozi', documents: 'crm.online.club.regolamento' });
export const CLUB_NAVIGATION = Object.freeze([
  ['Dashboard', CLUB_PATH], ['Richieste', `${CLUB_PATH}/richieste`],
  ['Configurazione', `${CLUB_PATH}/configurazione`], ['Premi', `${CLUB_PATH}/premi`], ['Clienti e movimenti', `${CLUB_PATH}/clienti`], ['Negozi', `${CLUB_PATH}/negozi`], ['Regolamento', `${CLUB_PATH}/regolamento`],
]);
export const REQUEST_STATUS = Object.freeze({ pending: 'Da approvare', approved: 'Approvata', ready: 'Pronta al ritiro', shipped: 'Spedita', completed: 'Completata', cancelled: 'Annullata', rejected: 'Rifiutata' });
export const MODE_LABELS = Object.freeze({ products: 'Prodotti', prizes: 'Premi', money: 'Denaro' });
export const DELIVERY_LABELS = Object.freeze({ pickup: 'Negozio di fiducia', home: 'A casa', bank_transfer: 'Bonifico bancario', store_cash: 'Contanti al negozio di fiducia' });
export const MOVEMENT_LABELS = Object.freeze({ earn: 'Accredito acquisto', reserve: 'Riserva richiesta', release: 'Rilascio riserva', spend: 'Utilizzo cashback', reverse: 'Storno acquisto' });

export function requestActions(row) {
  if (row.status === 'pending') return [['approved', 'APPROVA RICHIESTA'], ['rejected', 'Rifiuta']];
  if (row.status === 'approved') return [[row.delivery_method === 'home' ? 'shipped' : row.delivery_method === 'bank_transfer' ? 'completed' : 'ready', row.delivery_method === 'home' ? 'Segna spedita' : row.delivery_method === 'bank_transfer' ? 'Registra pagamento' : 'Pronta al ritiro'], ['cancelled', 'Annulla']];
  if (row.status === 'ready') return [['completed', row.mode === 'money' ? 'Registra pagamento' : 'Conferma consegna'], ['cancelled', 'Annulla']];
  if (row.status === 'shipped') return [['completed', 'Conferma consegna']];
  return [];
}
export function configurationForm(row = {}) {
  row = row || {};
  return { name: row.name ?? 'Cashback Club', cashback_percent: String(row.cashback_percent ?? 5), reimbursement_modes: row.reimbursement_modes ?? ['products', 'prizes'], delivery_methods: row.delivery_methods ?? ['pickup', 'home'], cash_minimum: String(row.cash_minimum ?? 20), cash_method: row.cash_method ?? 'bank_transfer', shipping_fee: String(row.shipping_fee ?? 0), shipping_payment: row.shipping_payment ?? 'company', free_shipping_threshold: row.free_shipping_threshold == null ? '' : String(row.free_shipping_threshold), effective_at: row.effective_at ? localDateTime(row.effective_at) : '' };
}
export function localDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const part = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}
export function configurationPayload(form) {
  const rate = Number(form.cashback_percent);
  if (form.cashback_percent === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) throw Error('La percentuale deve essere compresa tra 0 e 100.');
  if (!form.name.trim()) throw Error('Indica il nome della configurazione.');
  if (!form.reimbursement_modes.length) throw Error('Abilita almeno una modalità di rimborso.');
  if (form.reimbursement_modes.some(mode => mode !== 'money') && !form.delivery_methods.length) throw Error('Abilita almeno una modalità di consegna.');
  const numeric = key => {
    if (form[key] === '' || !Number.isFinite(Number(form[key])) || Number(form[key]) < 0) throw Error('Importi non validi.');
    return Number(form[key]);
  };
  return { ...form, name: form.name.trim(), cashback_percent: rate, cash_minimum: numeric('cash_minimum'), shipping_fee: numeric('shipping_fee'), free_shipping_threshold: form.free_shipping_threshold === '' ? null : numeric('free_shipping_threshold'), effective_at: form.effective_at ? new Date(form.effective_at).toISOString() : null };
}
export function cashbackPreview(amount, percent) {
  if (amount === '' || percent === '' || !Number.isFinite(Number(amount)) || !Number.isFinite(Number(percent)) || Number(amount) < 0 || Number(percent) < 0 || Number(percent) > 100) return null;
  return Math.round((Number(amount) * Number(percent) / 100 + Number.EPSILON) * 100) / 100;
}
export function clubError(error) {
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(error?.code)) return 'SalidischiaClub non è ancora configurato nel database. È necessaria la migrazione del modulo.';
  return error?.message || 'Operazione Club non riuscita. Riprova.';
}

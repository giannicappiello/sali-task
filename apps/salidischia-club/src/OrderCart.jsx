import { useEffect, useRef, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { money } from './client';
import { usePortalRpc } from './usePortalApi';
import useAsync from './useAsync';
import { useAction } from './useAction';
import { Alert, Loading, Modal } from './ui';
import { Orders } from './ProductOrders';
import './product-orders.css';

import { CartContext, useCart } from './cartContext';
function loadCart(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? saved.filter(x => typeof x.product_id === 'string' && typeof x.name === 'string' && Number.isInteger(x.quantity) && x.quantity > 0 && x.quantity <= 99).slice(0, 100) : [];
  } catch { return []; }
}
export function CartProvider({ children, owner }) {
  const storageKey = `club-cart:${owner || 'guest'}`;
  // A keyed inner provider isolates carts immediately when the signed-in account changes.
  return <CartSession key={storageKey} storageKey={storageKey}>{children}</CartSession>;
}
function CartSession({ children, storageKey }) {
  const [items, setItems] = useState(() => { const own = loadCart(storageKey);return own.length || storageKey === 'club-cart:guest' ? own : loadCart('club-cart:guest'); });
  const [open, setOpen] = useState(false), [feedback, setFeedback] = useState('');
  const key = useRef(crypto.randomUUID());
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(items));if (storageKey !== 'club-cart:guest') localStorage.removeItem('club-cart:guest'); } catch { /* The cart remains usable when browser storage is unavailable. */ } }, [items, storageKey]);
  function change(next) { key.current = crypto.randomUUID(); setItems(next);setFeedback(''); }
  function add(product) {
    change(current => {
      const found = current.find(x => x.product_id === product.id);
      if (found) return current.map(x => x === found ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x);
      return current.length < 100 ? [...current, { product_id: product.id, name: product.name, quantity: 1 }] : current;
    });
    setOpen(true);
  }
  const value = { items, add, open: () => setOpen(true), change };
  return <CartContext.Provider value={value}>{children}{open && <Modal title="Carrello" onClose={() => setOpen(false)}><CartContents signedIn={storageKey !== 'club-cart:guest'} items={items} change={change} requestKeyRef={key} feedback={feedback} onSent={() => { setItems([]);key.current = crypto.randomUUID();setFeedback('Ordine inviato al tuo negozio. Puoi seguirne lo stato qui.'); }} /></Modal>}</CartContext.Provider>;
}
export function CartButton() {
  const cart = useCart();
  if (!cart) return null;
  const count = cart.items.reduce((sum, x) => sum + x.quantity, 0);
  return <button type="button" className="button cart-button" onClick={cart.open}><ShoppingBag size={18} />Carrello ({count})</button>;
}
export function OrderButton({ product }) {
  const cart = useCart();
  if (!cart) return <a className="button primary" href={`/prodotti?prodotto=${encodeURIComponent(product.id)}`}>Ordina</a>;
  return <button type="button" className="button primary" onClick={() => cart.add(product)}>Ordina<ShoppingBag size={16} /></button>;
}
function CartContents({ signedIn, items, change, requestKeyRef, feedback, onSent }) {
  const rpc = usePortalRpc(), action = useAction();
  const session = useAsync('club_session', {}, signedIn);
  const member = useAsync('club_member_portal', {}, session.data?.role === 'member');
  const payload = items.map(({ product_id, quantity }) => ({ product_id, quantity }));
  const quote = useAsync('club_quote_order', { items: payload }, !!items.length && !!member.data?.member?.store_code);
  const [note, setNote] = useState('');
  const noteKey = useRef(null);
  function editNote(value) { requestKeyRef.current = crypto.randomUUID();noteKey.current = null;setNote(value); }
  async function send() {
    // Retain the exact payload and key after an uncertain network response.
    if (!noteKey.current || noteKey.current.key !== requestKeyRef.current) noteKey.current = { key: requestKeyRef.current, items: payload, note, quote: quote.data };
    const pending = noteKey.current;
    const result = await action.run(() => rpc('club_send_order', { items: pending.items, idempotency_key: pending.key, expected_quote: pending.quote, note: pending.note }));
    if (result.ok) { setNote('');onSent(); }
  }
  return <><Alert>{feedback}</Alert><Alert error={action.error || session.error || member.error} />{items.length > 0 ? <>
    <fieldset disabled={action.busy} className="cart-lines">{items.map(item => <div className="cart-line" key={item.product_id}><strong>{item.name}</strong><label>Quantità<input aria-label={`Quantità ${item.name}`} type="number" min="1" max="99" step="1" value={item.quantity} onChange={e => { const quantity = Number(e.target.value);if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 99) change(current => current.map(x => x.product_id === item.product_id ? { ...x, quantity } : x)); }} /></label><button type="button" className="text-button" onClick={() => change(current => current.filter(x => x.product_id !== item.product_id))}>Rimuovi {item.name}</button></div>)}</fieldset>
    {session.loading ? <Loading /> : session.data?.role !== 'member' ? <p className="notice">Accedi con il tuo account cliente Club per inviare l’ordine. <a href="/">Accedi al Club</a></p> : member.loading ? <Loading /> : !member.data?.member?.store_code ? <p className="notice">Scegli prima il tuo negozio di fiducia. <a href="/?negozio=1">Scegli negozio</a></p> : <>
      <h3>Il tuo negozio: {member.data.member.store_name}</h3><Alert error={quote.error} />{quote.loading ? <Loading /> : quote.data && <><ul className="order-lines">{quote.data.items.map((line, i) => <li key={`${line.product_id}-${i}`}>{line.name} · {line.quantity} × {money(line.unit_price)}{line.gift ? ' · Omaggio' : ''}<strong>{money(line.amount)}</strong></li>)}</ul><p className="row-between"><span>Totale ordine</span><strong>{money(quote.data.total)}</strong></p></>}
      <label className="order-note">Nota per il negozio<textarea maxLength={1000} disabled={action.busy} value={note} onChange={e => editNote(e.target.value)} /></label><p className="subtle">Il negozio confermerà la ricezione e ti comunicherà qui quando i prodotti saranno disponibili per il ritiro. Pagamento in negozio.</p>
      <div className="order-actions"><button type="button" className="button" disabled={action.busy || quote.loading} onClick={() => { noteKey.current = null;requestKeyRef.current = crypto.randomUUID();void quote.reload(); }}>Aggiorna riepilogo</button><button type="button" className="button primary" disabled={action.busy || quote.loading || !quote.data || !!quote.error} onClick={send}>{action.busy ? 'Invio…' : 'Invia ordine al tuo negozio'}</button></div>
    </>}
  </> : <p>Il carrello è vuoto. Aggiungi i prodotti con il pulsante Ordina.</p>}{session.data?.role === 'member' && <Orders compact />}</>;
}

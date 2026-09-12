import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import InfoTooltip from '../../components/InfoTooltip';
import { CUSTOMER_PRODUCT_SCREENS, groupCustomerProducts, productAmount } from './customerProducts';
import { useCustomerProductData } from './useCustomerProductData';
import { formatMoney } from './crmConfig';

function CustomerProductCard({ customerKey, kind, period, crmType }) {
  const { hasScreenAccess } = useAuth();
  const screen = CUSTOMER_PRODUCT_SCREENS[kind];
  const { rows, loading, error } = useCustomerProductData(customerKey, kind, crmType);
  const products = useMemo(() => groupCustomerProducts(rows, { from: period.from, to: period.to }), [rows, period.from, period.to]);
  const amount = productAmount(products.flatMap(product => product.lines));
  return <section className="panel crm-panel crm-expandable-card crm-product-card">
    <h3>{screen.title}<InfoTooltip label={screen.title} text="Articoli distinti nel periodo selezionato, da righe reali dei documenti visibili. Importi netti IVA esclusa; unità di misura mantenute separate. Nessuna duplicazione tra ordini e fatture." /></h3>
    {loading ? <p>Caricamento prodotti…</p> : error ? <p role="alert">{error}</p> : <><strong>{products.length} prodotti</strong><p>{formatMoney(amount.value)}{amount.unknown ? ' · importo parziale' : ''}</p><p>{products.slice(0, 2).map(product => product.description).join(' · ') || 'Nessun prodotto nel periodo'}</p></>}
    {hasScreenAccess(screen.code) ? <Link className="secondary-action" to={period.withPeriod(screen.path, { customer: customerKey, crmType, product: null, productSearch: null, productHistory: null })}>Apri dettaglio →</Link> : <small>Schermata da assegnare nelle impostazioni o non autorizzata.</small>}
  </section>;
}
export default function CustomerProductCards({ customerKey, period, crmType }) {
  return <><CustomerProductCard customerKey={customerKey} kind="purchased" period={period} crmType={crmType} /><CustomerProductCard customerKey={customerKey} kind="ordered" period={period} crmType={crmType} /></>;
}

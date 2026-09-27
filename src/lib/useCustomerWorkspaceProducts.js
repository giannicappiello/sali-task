import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { loadCustomerProductLines } from '../modules/crm/customerProducts';

export function filterCustomerProducts(products, lines) {
  const codes = new Set(lines.map(row => String(row.product_code || '').trim().toUpperCase()).filter(Boolean));
  return products.filter(product => [product.codice_mexal, product.codice].some(code => code && codes.has(String(code).trim().toUpperCase())));
}

export default function useCustomerWorkspaceProducts(products, customerKey, crmType, open) {
  const [result, setResult] = useState({ key: '', type: '', lines: [], error: '' });
  const direct = customerKey === 'crm:00000000-0000-4000-8000-000000000001';
  useEffect(() => {
    if (!open || !customerKey || direct) return;
    const controller = new AbortController();
    Promise.all(['ordered', 'purchased'].map(kind => loadCustomerProductLines(supabase, customerKey, kind, controller.signal, crmType === 'brand_direct' ? '' : crmType)))
      .then(groups => { if (!controller.signal.aborted) setResult({ key: customerKey, type: crmType, lines: groups.flat(), error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key: customerKey, type: crmType, lines: [], error: error.message }); });
    return () => controller.abort();
  }, [open, customerKey, crmType, direct]);
  const ready = result.key === customerKey && result.type === crmType;
  const available = useMemo(() => !customerKey ? [] : direct ? products : ready ? filterCustomerProducts(products, result.lines) : [], [products, customerKey, direct, ready, result.lines]);
  return { products: available, loading: Boolean(customerKey && !direct && !ready), error: ready ? result.error : '' };
}

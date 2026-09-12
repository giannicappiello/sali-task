import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { loadCustomerProductLines } from './customerProducts';

export function useCustomerProductData(customerKey, kind, crmType = '') {
  const [state, setState] = useState({ key: '', kind: '', crmType: '', rows: [], loading: false, error: '' });
  useEffect(() => {
    if (!customerKey) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ key: customerKey, kind, crmType, rows: [], loading: true, error: '' });
      loadCustomerProductLines(supabase, customerKey, kind, controller.signal, crmType).then(rows => {
        if (!controller.signal.aborted) setState({ key: customerKey, kind, crmType, rows, loading: false, error: '' });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ key: customerKey, kind, crmType, rows: [], loading: false, error: error.message || 'Dati prodotti non disponibili.' });
      });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [customerKey, kind, crmType]);
  return state.key === customerKey && state.kind === kind && state.crmType === crmType ? state : { rows: [], loading: Boolean(customerKey), error: '' };
}

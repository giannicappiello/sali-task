import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { CrmKpiDialog } from './CrmKpiDetail';
import { loadAllQueryRows } from './crmDataset';
import { digitalConnectionsService } from '../integrations/services/digitalConnectionsService';
import { marketplaceLabel } from './marketplaceLabel.js';

export default function AmazonReconcileDialog({ mapping, onClose, onSaved, channelLabel = "Amazon" }) {
  const [products,setProducts] = useState([]), [query,setQuery] = useState(''), [selected,setSelected] = useState(mapping.product_id || '');
  const [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(()=>{
    let active = true;
    loadAllQueryRows((from,to)=>supabase.from('prodotti').select('id,nome,codice,codice_mexal').or('codice.ilike.IT%,codice_mexal.ilike.IT%').order('nome').order('id').range(from,to)).then(result=>{
      if (!active) return;
      if (result.error) setError(result.error.message); else setProducts(result.data || []);
      setLoading(false);
    });
    return ()=>{active=false;};
  },[]);
  const options = useMemo(()=>products.filter(product=>`${product.codice_mexal || product.codice} ${product.nome}`.toLocaleLowerCase('it-IT').includes(query.trim().toLocaleLowerCase('it-IT'))),[products,query]);
  const product = products.find(row=>row.id===selected);
  async function save(event) {
    event.preventDefault(); if (!product || busy) return;
    setBusy(true); setError('');
    try {
      await digitalConnectionsService.saveMapping({mappingId:mapping.id,connectionId:mapping.connection_id,marketplace:mapping.marketplace,externalSku:mapping.external_sku,asin:mapping.asin,productId:product.id,status:'matched'});
      await onSaved();
    } catch(failure) { setError(failure.message); setBusy(false); }
  }
  return <CrmKpiDialog title={`Riconcilia prodotto ${channelLabel}`} subtitle={`${marketplaceLabel(mapping.marketplace)} · SKU ${mapping.external_sku}${mapping.asin ? ' · ASIN '+mapping.asin : ''}`} onClose={()=>{if(!busy) onClose();}}>
    <form className="crm-form-grid crm-amazon-reconcile-form" onSubmit={save}>
      <label>Cerca prodotto IT<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Codice IT o nome prodotto" disabled={loading || busy}/></label>
      <label>Prodotto Workspace (codice IT)<select aria-label="Prodotto Workspace (codice IT)" required value={selected} disabled={loading || busy} onChange={event=>setSelected(event.target.value)}>
        <option value="">Seleziona un prodotto…</option>
        {product && !options.some(row=>row.id===product.id) ? <option value={product.id}>{product.codice_mexal || product.codice} · {product.nome}</option> : null}
        {options.map(row=><option key={row.id} value={row.id}>{row.codice_mexal || row.codice} · {row.nome}</option>)}
      </select></label>
      {loading ? <p role="status">Caricamento prodotti IT…</p> : <p>{options.length} prodotti disponibili per la ricerca.</p>}
      <p>I prodotti esterni riconciliati con lo stesso prodotto Workspace contribuiscono a un unico totale. Il collegamento resta distinto per fonte, marketplace e SKU.</p>
      {error ? <p role="alert" className="crm-message error">{error}</p> : null}
      <button type="submit" className="primary-action" disabled={loading || busy || !product}>{busy ? 'Salvataggio…' : 'Salva riconciliazione'}</button>
    </form>
  </CrmKpiDialog>;
}

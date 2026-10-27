const cents=value=>value!=null && value!=='' && Number.isFinite(Number(value))?Math.round(Number(value)*100):null;
const taxAmount=proceeds=>{
  const rows=(proceeds?.breakdowns || []).filter(row=>row.type==='TAX');
  if(!rows.length || rows.some(row=>cents(row.subtotal?.amount)===null)) return null;
  return rows.reduce((sum,row)=>sum+cents(row.subtotal.amount),0);
};

// Persist only fiscal classification and amounts, never tax registrations or PII.
export function amazonTaxSnapshot(order) {
  const declared=(order.orderItems || []).some(item=>(item.tax?.taxCollections || []).some(row=>row.model==='MARKETPLACE_FACILITATOR'));
  const rows=(order.orderItems || []).map(item=>({external_line_id:String(item.orderItemId || ''),
    marketplace_facilitator:(item.tax?.taxCollections || []).some(row=>row.model==='MARKETPLACE_FACILITATOR' && /amazon/i.test(row.responsibleParty || '')),
    tax_cents:taxAmount(item.proceeds)}));
  if(!declared) return null;
  return {model:rows.every(row=>row.marketplace_facilitator)?'MARKETPLACE_FACILITATOR':'MIXED',
    vat_code:'N41',source:'amazon_tax',lines:rows};
}

export function amazonCoxFinancials(order,lines) {
  const classification=order.raw_summary?.tax_collection;
  if(!classification) return {order,lines};
  if(classification.model!=='MARKETPLACE_FACILITATOR' || classification.vat_code!=='N41') throw new Error('Regime fiscale Amazon misto o non configurato: verificare il COX.');
  const gross=cents(order.gross_revenue),net=cents(order.net_revenue);
  if(gross===null || net===null || net<0 || net>gross) throw new Error('Importi Marketplace Facilitator non disponibili.');
  const proof={model:classification.model,vatCode:'N41',buyerTotalCents:gross,amazonCollectedTaxCents:gross-net,documentTotalCents:net};
  if(lines===undefined) return {order:{...order,gross_revenue:net/100},vatCode:'N41',proof};
  let taxSum=0;
  const prepared=lines.map(line=>{
    const matches=(classification.lines || []).filter(row=>row.external_line_id===line.external_line_id);
    const tax=matches.length===1?matches[0].tax_cents:lines.length===1?gross-net:null;
    const revenue=cents(line.line_revenue);
    if(!Number.isSafeInteger(tax) || tax<0 || revenue===null || tax>revenue) throw new Error('Imposta riscossa da Amazon non disponibile per ogni riga: COX N41 non emesso.');
    taxSum+=tax;
    return {...line,line_revenue:(revenue-tax)/100};
  });
  if(taxSum!==gross-net || prepared.reduce((sum,line)=>sum+cents(line.line_revenue),0)!==net) throw new Error('Importi N41 non riconciliati con Amazon.');
  return {order:{...order,gross_revenue:net/100},lines:prepared,vatCode:'N41',
    proof};
}

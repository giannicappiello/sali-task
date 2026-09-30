export function fillingActivityMessage(data) {
 const a=data?.activity;
 if(data?.type!=='progremes-filling-activity' || !a || !Number.isSafeInteger(a.productionOrderId) || a.productionOrderId<=0 || a.productionOrderId>2147483647) return null;
 if(!['Packaging','Cartoning'].includes(a.operationType)) return null;
 for(const key of ['orderNumber','articleCode','resourceCode','resource','stato']) if(typeof a[key]!=='string'||a[key].length>300) return null;
 if(typeof a.descrizione!=='string'||a.descrizione.length>2000) return null;
 for(const key of ['start','end']) if(typeof a[key]!=='string'||a[key].length>50||!Number.isFinite(Date.parse(a[key]))) return null;
 if(a.actualStart!=null && (typeof a.actualStart!=='string'||a.actualStart.length>50||!Number.isFinite(Date.parse(a.actualStart)))) return null;
 return {...a, id:a.productionOrderId+'-'+a.resourceCode+'-'+a.operationType, tipo:'production', reparto:'Confezionamento', titolo:a.orderNumber+' · '+a.articleCode};
}

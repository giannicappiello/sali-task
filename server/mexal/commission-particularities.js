const text = value => String(value ?? '').trim();
const number = value => value === null || value === undefined || text(value)==='' ? null : Number(text(value).replace(',','.'));
const raw = row => ({...row.dati_mexal,...row});
const dateKey = value => {
  if(!value)return '';
  const s=value instanceof Date ? new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(value) : text(value);
  const key=s.slice(0,10).replace(/-/g,'');
  if(!/^\d{8}$/.test(key) || key==='00000000')return '';
  return key;
};
const val = (object,...keys) => {for(const key of keys){const v=object?.[key] ?? object?.dati_mexal?.[key] ?? object?.json_mexal?.[key];if(v!==undefined && v!==null && text(v)!=='')return v;}return null;};
const entries = values => Array.isArray(values) ? values.filter(Array.isArray).map(item=>[String(item[0]),text(item.at(-1))]).filter(([,v])=>v!=='') : [];

export async function loadCommissionParticularities(db) {
  const data=[];
  for(let offset=0;;offset+=500){
    const page=await db.from('ordini_particolarita').select('*').eq('tipo_part','V').eq('is_active',true).order('id').range(offset,offset+499);
    if(page.error)return {data:null,error:page.error};
    data.push(...page.data);
    if(page.data.length<500)return {data,error:null};
  }
}

function match(rule,{customer,product,customerCategory,productCategory,date}) {
  if(rule.tipo_part!=='V' || rule.is_active===false)return false;
  const at=dateKey(date),start=dateKey(rule.data_inizio),end=dateKey(rule.data_fine);
  if((start && at<start)||(end && at>end))return false;
  const customerType=text(rule.tp_dato_conto).toUpperCase(),productType=text(rule.tp_dato_art).toUpperCase();
  const customerMatch=customerType==='C' ? text(rule.codice_conto)===text(customer.codice_cliente) : customerType==='N' ? number(rule.id_cat_conto)===customerCategory : customerType==='S' ? number(rule.id_catsta_conto)===number(val(customer,'categoria_statistica_cliente','cod_cat_sta','id_catsta_conto','nr_cat_sta')) : false;
  if(!customerMatch)return false;
  if(productType==='A')return text(rule.cod_articolo).toUpperCase()===text(val(product,'codice_articolo','codice_mexal','codice')).toUpperCase();
  if(productType==='T')return number(rule.id_cat_art)===productCategory;
  if(productType==='E')return number(rule.nr_catsta_art)===number(val(product,'categoria_statistica_articolo','nr_cat_sta','nr_catsta_art'));
  if(productType==='U')return text(rule.cod_natura)!=='' && text(rule.cod_natura)===text(val(product,'cod_natura','natura'));
  if(productType==='M'){const group=text(val(product,'cod_grp_merc','gruppo_merceologico'));return Boolean(text(rule.cod_grp_merc)) && group.startsWith(text(rule.cod_grp_merc));}
  return false;
}
function priority(rule){return ({C:300,N:200,S:100}[rule.tp_dato_conto]||0)+({A:50,T:40,M:30,E:20,U:10}[rule.tp_dato_art]||0);}

export function particularityPercentage(rule) {
  // The two Mexal tables can repeat the same rate at different matrix indexes.
  // They are alternative representations, never additive commissions.
  if(['scaglione1','scaglione_2','cod_agente_1','cod_agente_2','cod_cond_1','cod_cond_2'].some(key=>entries(rule[key]).length) || ['tp_condizione','tp_applicazione','tp_applica'].some(key=>text(rule[key])))throw new Error(`Particolarità provvigionale ${rule.id}: condizioni o scaglioni da verificare, nessuna percentuale presunta.`);
  const rates=[];
  for(const suffix of ['1','2']){
    const types=new Map(entries(rule[`tipo_pr_${suffix}`]));
    for(const [position,value] of entries(rule[`part_${suffix}`])){
      if(types.get(position)!=='%')throw new Error(`Particolarità provvigionale ${rule.id}: formula diversa da una percentuale semplice.`);
      const rate=number(value);
      if(rate===null || !Number.isFinite(rate) || rate<0 || rate>100)throw new Error(`Particolarità provvigionale ${rule.id}: percentuale non valida.`);
      rates.push(rate);
    }
  }
  if(!rates.length || new Set(rates).size!==1)throw new Error(`Particolarità provvigionale ${rule.id}: percentuale assente o ambigua.`);
  return rates[0];
}
export function resolveCommissionParticularity(particularities,context) {
  const candidates=particularities.map(raw).filter(rule=>match(rule,context)).sort((a,b)=>priority(b)-priority(a));
  if(!candidates.length)return null;
  const best=candidates.filter(rule=>priority(rule)===priority(candidates[0]));
  const percentage=particularityPercentage(best[0]);
  if(best.some(rule=>particularityPercentage(rule)!==percentage))throw new Error('Più particolarità provvigionali con la stessa priorità e percentuali diverse: verificare le regole Mexal.');
  return {rule:best[0],percentage};
}

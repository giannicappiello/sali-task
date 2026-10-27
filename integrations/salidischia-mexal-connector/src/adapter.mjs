import { decimal } from './order.mjs';
import {moneyVerification} from './money-policy.mjs';
const text=value=>String(value??'').trim();
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const get=(object,path)=>path.split('.').reduce((node,key)=>node?.[key],object);
function scalar(value) {
  if (Array.isArray(value)) { if(value.length===0)return '';assert(value.length===1,'Campo scalare ambiguo.');return scalar(value[0].at(-1)); }
  return value;
}
function record(response) {
  let value=response.data;
  if (value && typeof value==='object' && 'dati' in value) value=value.dati;
  if(Array.isArray(value)){assert(value.length===1,'Risorsa Mexal non univoca.');value=value[0];}
  assert(value && typeof value==='object' && !Array.isArray(value),'Risorsa Mexal non leggibile.');
  return value;
}
const mappedValue=(row,binding)=>binding?scalar(get(row,binding.field)):undefined;
function sourceValue(source,path,binding){
  let value=binding.sources?binding.sources.map(p=>text(get(source,p))).filter(Boolean).join(binding.separator??' '):text(get(source,path));
  if(binding.values && value){assert(Object.hasOwn(binding.values,value),`Valore non mappato: ${path}.`);value=binding.values[value];}
  if(binding.prefixFrom && value){const prefix=text(get(source,binding.prefixFrom)).toUpperCase();if(prefix&&!value.toUpperCase().startsWith(prefix))value=prefix+value;}
  return value;
}
const normalized=(value,binding)=>binding?.normalize==='upper'?text(value).toUpperCase():binding?.normalize==='lower'?text(value).toLowerCase():text(value);
const fiscal=(value,country)=>text(value).toUpperCase().replace(new RegExp('^'+text(country).toUpperCase()),'').replace(/\s/g,'');
function encode(binding,value) {
  assert(binding && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(binding.field),'Mappatura campo non verificata.');
  assert(['scalar','matrix'].includes(binding.encoding),'Codifica campo non verificata.');
  const result=text(value);
  if(binding.maxLength!==undefined)assert(result.length<=binding.maxLength,`Campo troppo lungo: ${binding.field}. Nessun troncamento automatico.`);
  return binding.encoding==='matrix'?[[1,result]]:result;
}
function encodeFields(source,bindings) {
  const output={};
  for(const [path,binding] of Object.entries(bindings)){
    const value=sourceValue(source,path,binding);
    // Updating a customer never blanks a field that the website did not supply.
    if(value)output[binding.field]=encode(binding,value);
  }
  return output;
}
function verifyFields(actual,source,bindings) {
  for(const [path,binding] of Object.entries(bindings)){
    const expected=sourceValue(source,path,binding);
    if(expected)assert(normalized(mappedValue(actual,binding),binding)===normalized(expected,binding),`Rilettura differente: ${path}.`);
  }
}
const addressFields=['first_name','last_name','company','address_1','address_2','postcode','city','state','country','phone','email'];
const fiscalFields=['vat','fiscalCode','pec','sdi','type'];
function splitAddress(address,limit){
  if(!limit||[address.address_1,address.address_2].filter(Boolean).join(', ').length<=limit)return {address,notes:[]};
  assert(address.address_1.length<=limit&&address.address_2.length<=64,'Indirizzo troppo lungo per i campi Mexal verificati.');
  const chunks=address.address_2.match(/.{1,32}/gu)||[];
  return {address:{...address,address_2:''},notes:chunks.map((part,i)=>[i+1,`SDI:${part}`])};
}
function verifyAddressNotes(actual,source){
  const notes=new Map(actual.descr_nota||[]);
  for(const [index,value]of source.addressNotes||[])assert(text(notes.get(index)).toUpperCase()===value.toUpperCase(),'Rilettura differente: indicazioni aggiuntive indirizzo.');
}

export class MexalAdapter {
  constructor(transport,config){this.api=transport;this.config=config;this.contract=config.contract;}
  async collection(path){
    let next=null;const seen=new Set(),rows=[];
    for(let page=0;page<(this.config.maxPages||200);page++){
      const query=new URLSearchParams({max:'100'});if(next)query.set('next',next);
      const response=await this.api.request(`${path}?${query}`);
      const payload=response.data;
      assert(payload && Array.isArray(payload.dati),'Formato elenco Mexal non verificato.');
      rows.push(...payload.dati);next=text(payload.next);
      if(!next)return rows;
      assert(!seen.has(next),'Paginazione Mexal ripetuta.');seen.add(next);
    }
    throw new Error('Elenco Mexal incompleto: limite pagine raggiunto.');
  }
  async findExistingOrder(plan){
    assert(this.contract?.orderReference,'Campo riferimento ordine non configurato.');
    const rows=this.api.search?(await this.api.search('documenti/ordini-clienti',[{campo:this.contract.orderReference.field,condizione:'contiene',valore:plan.reference}])).data?.dati:await this.collection('/documenti/ordini-clienti');
    assert(Array.isArray(rows),'Ricerca riferimenti ordine non leggibile.');
    // Old orders must be reconciled at cutover; exact markers handle new imports.
    return rows.find(row=>text(mappedValue(row,this.contract.orderReference)).includes(plan.reference))||null;
  }
  customerSource(customer){
    // Mexal rejects ':' in cod_alternativo. Keep the source plan/hash unchanged.
    const id=/^guest:\d+$/.test(customer.externalId)?customer.externalId.replace('guest:','GUEST-'):customer.externalId;
    const split=splitAddress(customer.billing,this.config.addressMaxLength);
    return {...customer,billing:split.address,addressNotes:split.notes,displayName:customer.billing.company||[customer.billing.last_name,customer.billing.first_name].filter(Boolean).join(' '),externalId:this.resolvedCustomerExternalId||(this.config.externalPrefix?`${this.config.externalPrefix}${id}`:`${this.plan.site}|${id}`)};
  }
  destinationSource(customer,customerCode){
    const source=customer.shipping;
    const shipping=source.address_1?{...source,first_name:source.first_name||customer.billing.first_name,last_name:source.last_name||customer.billing.last_name}:customer.billing;
    for(const key of ['address_1','postcode','city','country'])assert(shipping[key],`Destinazione incompleta: ${key}.`);
    const split=splitAddress(shipping,this.config.addressMaxLength);
    if(split.notes.length)assert(shipping.address_2.length<=64,'Indicazioni consegna troppo lunghe per i campi Mexal verificati.');
    return {...split.address,displayName:shipping.company||[shipping.last_name,shipping.first_name].filter(Boolean).join(' '),customerCode,externalId:`${this.plan.reference}|spedizione`};
  }
  async preflight(plan,config){
    this.plan=plan;
    this.resolvedCustomerExternalId=null;
    const c=this.contract;
    assert(c?.verified===true,'Contratto campi Mexal non verificato.');
    assert(String(this.api.company)===plan.company && String(this.api.year)===plan.year,'Azienda/esercizio API diversi dal piano.');
    assert(config.importFrom && plan.date>=config.importFrom,'Ordine precedente alla data di subentro verificata.');
    assert(config.legacyReconciledThrough && Number(plan.orderId)>Number(config.legacyReconciledThrough),'Ordine incluso nel precedente flusso: riconciliazione richiesta.');
    const customer=this.customerSource(plan.customer);
    for(const field of [...addressFields.map(key=>`billing.${key}`),...fiscalFields,'externalId']){
      if(text(get(customer,field)))assert(c.customer?.fields?.[field]||Object.values(c.customer?.fields||{}).some(b=>b.sources?.includes(field)),`Mappatura anagrafica assente: ${field}.`);
    }
    assert(c.customer?.code && c.destination?.code && c.article?.sku && c.article?.unit && c.article?.tax && (config.totalsServiceVerified||c.orderTotals?.total&&c.orderTotals?.tax) && c.orderCode,'Contratto di rilettura incompleto.');
    encodeFields(customer,c.customer.fields);
    const destination=this.destinationSource(plan.customer,'PREFLIGHT');
    for(const field of [...addressFields,'customerCode','externalId'])if(text(destination[field]))assert(c.destination.fields?.[field]||Object.values(c.destination.fields||{}).some(b=>b.sources?.includes(field)),`Mappatura destinazione assente: ${field}.`);
    encodeFields(destination,c.destination.fields);
    assert(Number.isInteger(config.paymentCodes?.[plan.paymentMethod]),'Pagamento WooCommerce non mappato a Mexal.');
    if(config.customerDefaults)assert(Object.keys(config.customerDefaults).every(k=>['cod_listino','valuta'].includes(k))&&Number.isInteger(config.customerDefaults.cod_listino)&&config.customerDefaults.cod_listino>=1&&config.customerDefaults.cod_listino<=999&&(config.customerDefaults.valuta===undefined||config.customerDefaults.valuta===1),'Valori iniziali cliente non verificati.');
    for(const line of plan.lines){
      const article=record(await this.api.request(`/articoli/${encodeURIComponent(line.sku)}`));
      assert(text(mappedValue(article,c.article.sku))===line.sku,'Articolo Mexal non corrispondente.');
      assert(text(mappedValue(article,c.article.unit))===text(config.articleUnit),'Unità di misura articolo non verificata.');
      const tax=text(mappedValue(article,c.article.tax));
      const expected=String(config.taxCodes[line.taxes[0]?.id]??'');
      assert(line.taxes.length===1 && (tax===expected || /^\d+(,\d+)?$/.test(tax)&&Number(tax.replace(',','.'))===Number(expected)),'IVA articolo diversa dall’ordine del sito.');
    }
  }
  async resolveCreated(response,path,codeBinding){
    // A Location header may be absolute; only same-resource paths are used.
    let location=response.location;
    if(location){
      const url=new URL(location,'https://mexal.invalid');
      const prefix=`/webapi/risorse${path}/`;
      assert(url.pathname.startsWith(prefix),'Location Mexal inattesa.');
      const code=decodeURIComponent(url.pathname.slice(prefix.length));
      assert(code && !code.includes('/'),'Codice creato non valido.');return code;
    }
    const code=text(mappedValue(record(response),codeBinding));
    assert(code,'Mexal non ha restituito il codice creato.');return code;
  }
  async ensureCustomer(customer,{expectedCode}={}){
    const c=this.contract.customer,source=this.customerSource(customer);
    const rows=await this.collection('/clienti');
    const binding=c.fields.externalId;
    const externalMatches=rows.filter(row=>text(mappedValue(row,binding))===source.externalId);
    assert(externalMatches.length<=1,'Più clienti hanno lo stesso riferimento WooCommerce.');
    const fiscalMatches=rows.filter(row=>text(mappedValue(row,c.fields['billing.country'])).toUpperCase()===source.billing.country.toUpperCase() && ['vat','fiscalCode'].some(key=>source[key] && fiscal(mappedValue(row,c.fields[key]),key==='vat'?source.billing.country:'')===fiscal(source[key],key==='vat'?source.billing.country:'')));
    assert(fiscalMatches.length<=1,'Identità fiscale ambigua in Mexal.');
    let row=externalMatches[0]||fiscalMatches[0];
    if(externalMatches[0] && fiscalMatches[0])assert(text(mappedValue(externalMatches[0],c.code))===text(mappedValue(fiscalMatches[0],c.code)),'Riferimento sito e dati fiscali identificano clienti differenti.');
    if(row){
      // Always reread the full record immediately before PUT, retaining Mexal's
      // optimistic-lock timestamp instead of updating from a possibly stale list.
      const code=text(mappedValue(row,c.code));assert(code,'Codice cliente non leggibile.');
      row=record(await this.api.request(`/clienti/${encodeURIComponent(code)}`));
      const oldExternal=text(mappedValue(row,c.fields.externalId));
      // A returning guest has a different order ID. Reuse only the unique fiscal
      // match and preserve our existing alternate code; never match by name/email.
      const prefix=this.config.externalPrefix;
      if(oldExternal&&oldExternal!==source.externalId&&/^guest:\d+$/.test(customer.externalId)&&fiscalMatches[0]&&text(mappedValue(fiscalMatches[0],c.code))===code&&prefix&&oldExternal.startsWith(prefix)&&/^(?:GUEST-)?\d+$/.test(oldExternal.slice(prefix.length))){
        source.externalId=oldExternal;this.resolvedCustomerExternalId=oldExternal;
      }
      assert(!oldExternal||oldExternal===source.externalId,'Codice alternativo cliente già utilizzato da un altro collegamento.');
      for(const key of ['vat','fiscalCode']){
        const previous=text(mappedValue(row,c.fields[key]));
        assert(!source[key] || !previous || fiscal(previous,key==='vat'?source.billing.country:'')===fiscal(source[key],key==='vat'?source.billing.country:''),'Dati fiscali confliggenti: aggiornamento cliente bloccato.');
      }
    }
    if(expectedCode)assert(row&&text(mappedValue(row,c.code))===expectedCode,'Cliente di recupero non corrispondente: nessuna creazione consentita.');
    const payload=encodeFields(source,c.fields);
    if(source.addressNotes.length){
      assert(!row||(row.descr_nota||[]).every(([,v])=>!text(v)||/^SDI(?::|-A2 )/.test(text(v))),'Note cliente già occupate: impossibile salvare le indicazioni senza sovrascriverle.');
      payload.descr_nota=source.addressNotes;
      if(source.addressNotes.length===1)payload.descr_nota.push([2,'']);
    }else if(row?.descr_nota?.some(([,v])=>/^SDI(?::|-A2 )/.test(text(v)))){
      payload.descr_nota=row.descr_nota.map(([i,v])=>[i,/^SDI(?::|-A2 )/.test(text(v))?'':v]);
    }
    if(!row){
      Object.assign(payload,this.config.customerDefaults||{});
      if(this.config.customerPaymentFromOrder)payload.cod_pagamento=this.config.paymentCodes[this.plan.paymentMethod];
    }
    if(row){
      const code=text(mappedValue(row,c.code));assert(code,'Codice cliente non leggibile.');
      assert(row.data_ult_mod,'Timestamp ultima modifica cliente non disponibile.');
      payload.data_ult_mod=row.data_ult_mod;
      payload[c.code.field]=encode(c.code,code);
      await this.api.request(`/clienti/${encodeURIComponent(code)}`,{method:'PUT',payload});return code;
    }
    if(this.config.customerCodePrefix){
      const prefix=this.config.customerCodePrefix;assert(/^\d{3}$/.test(prefix),'Mastro clienti non valido.');
      const numbers=rows.map(r=>text(mappedValue(r,c.code))).filter(code=>code.startsWith(prefix+'.')).map(code=>Number(code.slice(4))).filter(Number.isInteger);
      const next=Math.max(0,...numbers)+1;assert(next<=99999,'Numerazione clienti esaurita.');
      payload[c.code.field]=encode(c.code,`${prefix}.${String(next).padStart(5,'0')}`);
    }
    return this.resolveCreated(await this.api.request('/clienti',{method:'POST',payload}),'/clienti',c.code);
  }
  customerPatch(customer){return encodeFields(this.customerSource(customer),this.contract.customer.fields);}
  async verifyCustomer(code,customer){
    const actual=record(await this.api.request(`/clienti/${encodeURIComponent(code)}`)),source=this.customerSource(customer);
    verifyFields(actual,source,this.contract.customer.fields);verifyAddressNotes(actual,source);
  }
  async prepareDestination(code,plan){
    const c=this.contract.destination,source=this.destinationSource(plan.customer,code);
    const payload=encodeFields(source,c.fields);
    if(this.config.destinationAllocateNumericId){
      const rows=await this.collection('/indirizzi-spedizione');
      const matching=rows.filter(row=>text(mappedValue(row,c.fields.externalId))===source.externalId&&text(mappedValue(row,c.fields.customerCode))===code);
      assert(matching.length<=1,'Destinazione con riferimento sito ambiguo.');
      if(matching.length){verifyFields(matching[0],source,c.fields);return text(mappedValue(matching[0],c.code));}
      const ids=rows.map(row=>text(mappedValue(row,c.code))).filter(id=>/^\d+$/.test(id)).map(Number);
      const next=Math.max(0,...ids)+1;assert(Number.isSafeInteger(next)&&String(next).length<=8,'Numerazione indirizzi esaurita.');
      payload[c.code.field]=encode(c.code,String(next));
    }
    // A new OC receives a dedicated delivery address. Uncertain creation is never retried.
    const response=await this.api.request('/indirizzi-spedizione',{method:'POST',payload});
    const destination=await this.resolveCreated(response,'/indirizzi-spedizione',c.code);
    verifyFields(record(await this.api.request(`/indirizzi-spedizione/${encodeURIComponent(destination)}`)),source,c.fields);
    return destination;
  }
  async createOrder(payload){
    const result=await this.api.request('/documenti/ordini-clienti',{method:'POST',payload});
    return this.resolveCreated(result,'/documenti/ordini-clienti',this.contract.orderCode);
  }
  async validateTotals(plan,payload,reference){
    const response=reference?await this.api.documentTotals(reference,payload.cod_conto):await this.api.calculateDocument(payload);
    const t=record(response);
    moneyVerification(plan,decimal(t.tot_imponibile)+decimal(t.tot_imposta),decimal(t.tot_imposta));
    assert(decimal(t.spese_trasporto)===plan.shippingCents,'Spedizione calcolata da Mexal diversa dall’ordine sito.');
    assert(Array.isArray(t.totali_righe)&&t.totali_righe.length===plan.lines.length,'Numero righe calcolate da Mexal diverso.');
    t.totali_righe.forEach((row,i)=>{assert(decimal(row.imponibile)===plan.lines[i].netCents,`Imponibile riga ${i+1} diverso dal sito.`);assert(Number(row.quantita)===plan.lines[i].quantity,`Quantità riga ${i+1} diversa.`);});
    return t;
  }
  async verifyOrder(reference,plan,payload){
    const actual=record(await this.api.request(`/documenti/ordini-clienti/${encodeURIComponent(reference)}`));
    for(const field of ['sigla','serie','cod_conto','cod_modulo','id_causale','id_magazzino','id_pagamento','cod_anag_sped','tp_porto','tp_spese_sped','val_spese_sped','nota',...(payload.descr_porto?['descr_porto']:[])]){
      const observed=text(scalar(actual[field])),expected=text(scalar(payload[field]));
      const omittedFreeTransport=plan.shippingCents===0&&observed===''&&((field==='tp_spese_sped'&&expected==='V')||(field==='val_spese_sped'&&Number(expected)===0));
      assert(observed===expected||omittedFreeTransport,`OC salvato diverso: ${field}.`);
    }
    assert(Array.isArray(actual.codice_articolo)&&actual.codice_articolo.length===plan.lines.length,'Numero righe salvate diverso dal sito.');
    for(const field of ['tp_riga','codice_articolo','quantita','prezzo','sconto','id_mag_riga','tp_um_articolo','cod_iva','tipo_stato_riga']){
      const rows=new Map(actual[field]||[]);
      for(const[index,value]of payload[field]){
        const observed=text(rows.get(index)??(field==='sconto'?'':undefined)),expected=text(value);
        const sameTax=field==='cod_iva'&&/^\d+(?:[.,]\d+)?$/.test(observed)&&/^\d+(?:[.,]\d+)?$/.test(expected)&&Number(observed.replace(',','.'))===Number(expected.replace(',','.'));
        assert(observed===expected||sameTax,`Righe OC salvate diverse: ${field}.`);
      }
    }
    assert(text(mappedValue(actual,this.contract.orderReference)).includes(plan.reference),'Riferimento sito non salvato.');
    if(this.config.totalsServiceVerified){
      const totals=await this.validateTotals(plan,payload,reference);
      return moneyVerification(plan,decimal(totals.tot_imponibile)+decimal(totals.tot_imposta),decimal(totals.tot_imposta));
    }
    else{
      const totals=this.contract.orderTotals;
      return moneyVerification(plan,decimal(mappedValue(actual,totals.total)),decimal(mappedValue(actual,totals.tax)));
    }
  }
}

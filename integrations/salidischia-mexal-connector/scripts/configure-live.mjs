import{readFile,writeFile}from'node:fs/promises';
import{existsSync}from'node:fs';
if(existsSync('.private/connector-config.json')&&!process.argv.includes('--replace'))throw new Error('Configurazione già presente. Non sovrascrivere quella attiva; --replace va usato solo dopo avere fermato il connettore.');
const help=JSON.parse(await readFile('output/mexal-api-help.json','utf8'));
const destination=JSON.parse(await readFile('.private/dest-schema.json','utf8')).data;
const article=JSON.parse(await readFile('.private/article-schema.json','utf8')).data;
const b=(field,options={})=>({field,encoding:'scalar',...options});
const u=field=>b(field,{normalize:'upper'});
const customerFields={
 'billing.company':u('ragione_sociale'),displayName:u('ragione_sociale'),
 'billing.first_name':u('nome'),'billing.last_name':u('cognome'),
 'billing.address_1':b('indirizzo',{sources:['billing.address_1','billing.address_2'],separator:', ',normalize:'upper'}),
 'billing.postcode':b('cap'),'billing.city':u('localita'),'billing.state':u('provincia'),'billing.country':u('cod_paese'),
 'billing.phone':b('telefono'),'billing.email':b('email',{normalize:'lower'}),
 vat:b('partita_iva',{prefixFrom:'billing.country',normalize:'upper'}),fiscalCode:u('codice_fiscale'),
 pec:b('pec',{normalize:'lower'}),sdi:u('codice_sdi'),type:b('gest_per_fisica',{values:{azienda:'N',privato:'S'}}),externalId:b('cod_alternativo',{maxLength:16}),
 nationality:b('tp_nazionalita',{sources:['billing.country'],values:{IT:'I'},normalize:'upper'}),
};
const destinationFields={
 company:u('descrizione'),displayName:u('descrizione'),first_name:b('riferimento',{sources:['first_name','last_name'],normalize:'upper'}),
 address_1:b('indirizzo',{sources:['address_1','address_2'],separator:', ',normalize:'upper'}),postcode:b('cap'),city:u('localita'),state:u('provincia'),country:u('cod_paese'),
 phone:b('telefono'),email:b('email',{normalize:'lower'}),customerCode:b('cod_conto'),externalId:b('nota',{maxLength:50}),
 nationality:b('tp_nazionalita',{sources:['country'],values:{IT:'I'},normalize:'upper'}),
};
for(const[bindings,schema]of[[customerFields,help.clienti],[destinationFields,destination]]){
 const names=new Set(schema.dati.map(x=>x.nome));for(const binding of Object.values(bindings))if(!names.has(binding.field))throw new Error(`Campo assente nello schema reale: ${binding.field}`);
}
const config={site:process.env.WOO_URL,company:process.env.MEXAL_AZIENDA,year:Number(process.env.MEXAL_ANNO),module:'',series:1,warehouse:Number(process.env.MEXAL_MAGAZZINO),
 taxCodes:{1:'22'},priceDecimals:4,shippingTaxVerified:true,shippingTaxCode:'22',paymentCodes:{paypal:4,ppcp:4,ppcp_card:20,ppcp_googlepay:20,ppcp_applepay:20},articleUnit:'PZ',customerCodePrefix:'501',externalPrefix:'WOO-',customerDefaults:{cod_listino:1,valuta:1},customerPaymentFromOrder:true,
 importFrom:'2026-10-21',legacyReconciledThrough:13729,cutoverVerified:false,contractVerified:true,totalsServiceVerified:true,destinationAllocateNumericId:true,
 contract:{verified:true,customer:{code:b('codice'),fields:customerFields},destination:{code:b('id'),fields:destinationFields},article:{sku:b('codice'),unit:b('um_principale'),tax:b('alq_iva')},orderReference:b('nota'),orderCode:b('riferimento')},
};
await writeFile('.private/connector-config.json',JSON.stringify(config,null,2));
console.log('Configurazione costruita sugli schemi reali. Attivazione ancora bloccata sul passaggio dal vecchio connettore.');

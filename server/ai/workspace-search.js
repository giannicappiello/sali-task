import { jsonSchema } from 'ai';
// Only explicit projections: never accept a table, SQL expression or column from the model.
export const DATASETS = Object.freeze({
 products: { module:'prodotti', table:'prodotti', columns:'id,codice_mexal,nome,descrizione,mostra_in_app,attivo_mexal', search:'nome', order:'id' },
 documents: { module:'documenti', table:'documenti_workspace', columns:'id,titolo,nome_file,categoria,modificato_il', search:'titolo', order:'id' },
});
export function canReadDataset(auth, name) {
 const descriptor=Object.hasOwn(DATASETS,name) ? DATASETS[name] : null;
 if(!descriptor || auth?.capabilities?.internal_data !== true)return false;
 if(auth.profile?.ruoli?.amministratore_workspace === true)return true;
 return (auth.access?.modules || []).includes(descriptor.module) && (!Array.isArray(auth.capabilities.allowed_modules) || auth.capabilities.allowed_modules.includes(descriptor.module));
}
export async function searchWorkspace(auth, input) {
 if(!canReadDataset(auth,input.dataset))throw Object.assign(Error('Dati non autorizzati per questo utente.'),{status:403});
 const d=DATASETS[input.dataset];const offset=Number(input.offset || 0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw Error('Pagina non valida.');
 let query=auth.scoped.from(d.table).select(d.columns,{count:'exact'}).order(d.order).range(offset,offset+49);
 if(input.id)query=query.eq('id',String(input.id));
 else if(input.query)query=query.ilike(d.search,`%${String(input.query).slice(0,160).replace(/[\\%_]/g,'\\$&')}%`);
 const {data,error,count}=await query;if(error)throw error;
 return {dataset:input.dataset,rows:data || [],total:count,offset,nextOffset:offset+(data?.length||0)<count ? offset+50:null,readAt:new Date().toISOString(),source:d.table};
}
export function workspaceReadTools(auth){
 const datasets=Object.keys(DATASETS).filter(name=>canReadDataset(auth,name));
 if(!datasets.length)return {};
 return {WORKSPACE_SEARCH:{description:'Cerca nei dati attuali autorizzati, recupera un record per ID o pagina i risultati oltre il contesto iniziale. Non interpreta dati mancanti come record inesistenti prima della ricerca. Sola lettura.',inputSchema:jsonSchema({type:'object',additionalProperties:false,required:['dataset'],properties:{dataset:{type:'string',enum:datasets},query:{type:'string',maxLength:160},id:{type:'string'},offset:{type:'integer',minimum:0}}}),execute:input=>searchWorkspace(auth,input)}};
}

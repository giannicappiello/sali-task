import { objectSchema,uuidSchema } from './schema.js';
import { canReadModule } from '../ai/operational-read.js';
import { AGENTS,must,requireThat } from '../reports/commercial-policy.js';
import { reportPlan,reportArtifact } from '../reports/commercial-service.js';

export function commercialReportTools(auth) {
  if(!canReadModule(auth,['crm_b2b'])||auth.profile.ruoli?.amministratore_workspace!==true)return {};
  return {
    COMMERCIAL_REPORT_PLAN:{effect:'read',description:'Legge il piano report mensile autorizzato, i 14 agenti, i contatti e lo stato dei lotti. Non attiva né invia nulla.',inputSchema:objectSchema(),execute:()=>reportPlan(auth)},
    COMMERCIAL_REPORT_ARTIFACT:{effect:'artifact',description:'Carica SOLO i PDF elencati nel manifest del lotto mensile già approvato e attivo dal titolare in Workspace. Non modifica dati aziendali e non consente destinatari liberi. Quando tutti i PDF sono verificati, accoda gli invii: ogni agente il proprio; responsabili solo la propria squadra; alle due caselle centrali tutti gli individuali e i consolidati PR/PH. Leggere status prima di ritentare; queued non significa sent. Senza delega attiva rifiuta ogni caricamento.',inputSchema:objectSchema({
      action:{type:'string',enum:['chunk','finalize','status']},batchId:uuidSchema,artifactKey:{type:'string',minLength:1,maxLength:100},
      part:{type:'integer',minimum:0,maximum:99},total:{type:'integer',minimum:1,maximum:100},base64:{type:'string',maxLength:40000},
      sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},period:{type:'string',format:'date'},network:{type:'string',enum:['prof','ph']},source:{type:'string',enum:['fatture','ordiniph']},verified:{type:'boolean'},
    },['action','batchId']),execute:input=>reportArtifact(auth,input)},
    COMMERCIAL_REPORT_DATA:{effect:'read',description:'Legge gli stessi dettagli paginati prodotti e righe della dashboard CRM per uno dei 14 agenti approvati. Professional: prodotti acquistati da fatture; Farmacie: prodotti ordinati da ordiniph. catalog restituisce classificazioni ufficiali prodotti. Paginare fino a nextOffset=null. Non usare la cache ordini come KPI. Le letture applicano RLS personali.',inputSchema:objectSchema({agentCode:{type:'string',enum:AGENTS.map(a=>a.code)},from:{type:'string',format:'date'},to:{type:'string',format:'date'},kind:{type:'string',enum:['products','lines','catalog']},productCode:{type:'string',maxLength:100},offset:{type:'integer',minimum:0,maximum:1000000}},['agentCode','from','to','kind']),execute:async input=>{
      const a=AGENTS.find(a=>a.code===input.agentCode);
      requireThat(canReadModule(auth,[a.network==='ph'?'ordini_ph':'ordini_pr']),'Modulo rete non autorizzato.',403);
      requireThat(input.from<=input.to,'Intervallo date non valido.');
      if(input.kind==='catalog') {
        requireThat(canReadModule(auth,['prodotti']),'Catalogo prodotti non autorizzato.',403);
        const offset=input.offset||0;
        let q=auth.scoped.from('prodotti').select('id,codice,nome,linea_mexal,categoria_mexal,sottocategoria_mexal').order('id').range(offset,offset+50);
        if(input.productCode)q=q.eq('codice',input.productCode);
        const rows=must(await q)||[];
        return {source:'prodotti',rows:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null};
      }
      const rpc=input.kind==='products'?'crm_b2b_order_product_groups_with_agents':'crm_b2b_order_product_detail_lines';
      const args={p_customer_group:a.network==='ph'?'all':'regular',p_crm_type:'b2b',p_order_module:a.network,p_from:input.from,p_to:input.to,p_agent:a.code,p_category:a.network==='ph'?'ordered':'purchased',p_limit:51,p_offset:input.offset||0};
      if(input.kind==='lines') {requireThat(input.productCode,'Indicare il codice prodotto per le righe.');args.p_product=input.productCode;}
      const rows=must(await auth.scoped.rpc(rpc,args))||[];
      return {source:a.source,rpc,agent:a,from:input.from,to:input.to,rows:rows.slice(0,50),nextOffset:rows.length>50?(input.offset||0)+50:null,readAt:new Date().toISOString()};
    }},
  };
}

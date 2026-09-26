import { randomUUID } from "node:crypto";
import { jsonSchema } from "ai";
import { defaultSettings } from "../../src/features/production-costs/cost-engine.js";

export function cleanCostDraft(value) {
 if (!value || typeof value !== "object" || Array.isArray(value)) return null;
 if (JSON.stringify(value).length > 80000 || !Array.isArray(value.machines) || value.machines.length > 200) return null;
 return structuredClone(value);
}
export function productionCostTools(auth, screenContext, run = async (req, body) => {
 const { handleProductionCosts } = await import("../production-costs.js");
 return handleProductionCosts(req, body);
}) {
 if (!auth.capabilities?.internal_data) return {};
 const req = {method:"POST",headers:{authorization:`Bearer ${auth.token}`}};
 const call = body => run(req, body); // Rechecks screen permissions and ownership on every call.
 return {
  PRODUCTION_COST_CONFIGURATION: {
   description:"Legge configurazioni costi versionate STATION/FILLING e la bozza della schermata aperta, incluse modifiche non salvate. Non modifica dati.",
   inputSchema:jsonSchema({type:"object",properties:{},additionalProperties:false}),
   execute:async()=>({...await call({operation:"configuration"}),screenDraft:cleanCostDraft(screenContext?.productionCostSettings)}),
  },
  PRODUCTION_COST_PROPOSALS: {
   description:"Legge lo storico personale delle proposte costi; con id legge proposta, domande, confronto prima/dopo ed esempi calcolati. Non applica modifiche.",
   inputSchema:jsonSchema({type:"object",properties:{id:{type:"string",format:"uuid"}},additionalProperties:false}),
   execute:input=>call(input.id?{operation:"ai-proposal",id:input.id}:{operation:"ai-history"}),
  },
  PRODUCTION_COST_PROPOSE: {
   description:"Delega al motore specializzato la proposta di criteri STATION/FILLING, tariffe, turni, lavaggi e obiettivo per lavorazione. Conserva storico, controlla i campi e calcola esempi deterministici. Usa la bozza corrente se presente, altrimenti la configurazione salvata. Riporta domande, limiti o modifiche senza dichiararle applicate. L'utente verifica la proposta nel pannello assistente della Configurazione costi, la trasferisce e salva la decorrenza. Per criteri non supportati usa il flusso sviluppo codice, senza inventare impostazioni.",
   inputSchema:jsonSchema({type:"object",required:["prompt"],properties:{prompt:{type:"string",minLength:1,maxLength:6000},parentId:{type:"string",format:"uuid"}},additionalProperties:false}),
   execute:async input=>{
    const configuration=await call({operation:"configuration"});
    const settings=cleanCostDraft(screenContext?.productionCostSettings)||configuration.configurations?.[0]?.settings||defaultSettings();
    const result=await call({operation:"ai-propose",requestId:randomUUID(),parentId:input.parentId||null,prompt:input.prompt,settings});
    return {...result,applied:false,reviewUrl:`/settings/costi-produzione?costProposal=${result.proposal.id}`,nextStep:"Apri l'assistente nella Configurazione costi: verifica valori ed esempi, conferma il trasferimento e salva una nuova versione con decorrenza. Nessuna versione è stata salvata da questo strumento."};
   },
  },
 };
}

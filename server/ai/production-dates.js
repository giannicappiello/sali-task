import { jsonSchema } from 'ai';
import { mesDomainCall } from './formula-revisions.js';
export const productionStartSchema = { type: 'object', additionalProperties: false,
 required: ['targetId','expectedHash','newStartDate','reason'], properties: {
  targetId: { type: 'integer', minimum: 1 }, expectedHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  newStartDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Data italiana YYYY-MM-DD. Conserva l’orario già registrato.' },
  reason: { type: 'string', minLength: 5, maxLength: 1000 }
 }};
export const productionDateCall = (auth, operation, input={}) => mesDomainCall(auth, 'production-dates', operation, input);
export function productionDateTools(auth) { return {
 MES_PRODUCTION_DATES_LOOKUP: { description: 'Legge le fasi di un OC o RdP esatto (anche OC2/157), articolo, date effettive, presenze, stato e hash prima di rettificare inizio o fine. Se ci sono più fasi concluse chiedere quale correggere; non scegliere arbitrariamente. Non modifica dati.',
  inputSchema: jsonSchema({type:'object',additionalProperties:false,required:['query'],properties:{query:{type:'string',minLength:2,maxLength:100}}}),
  execute: input => productionDateCall(auth,'lookup',input) }
}; }

export const productionDatesSchema = { type:'object',additionalProperties:false,
 required:['targetId','expectedHash','newStartDate','newEndDate','newStartTime','newEndTime','alignBoundaryPresences','reason'],properties:{
  targetId:productionStartSchema.properties.targetId,expectedHash:productionStartSchema.properties.expectedHash,
  newStartDate:{anyOf:[productionStartSchema.properties.newStartDate,{type:'null'}]},
  newEndDate:{anyOf:[productionStartSchema.properties.newStartDate,{type:'null'}]},
  newStartTime:{type:['string','null'],pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$',description:'HH:mm solo se indicato dall’utente, altrimenti null per conservare l’orario.'},
  newEndTime:{type:['string','null'],pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$',description:'HH:mm solo se indicato dall’utente, altrimenti null.'},
  alignBoundaryPresences:{type:'boolean',description:'Solo con autorizzazione esplicita dell’utente: allinea gli estremi delle presenze coincidenti con quelli originari. Mostrare le presenze modificate nel riepilogo da confermare.'},
  reason:productionStartSchema.properties.reason
 }};

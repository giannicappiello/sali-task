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
 MES_PRODUCTION_DATES_LOOKUP: { description: 'Legge le fasi di un OC o RdP esatto (anche OC2/157), date effettive, stato e hash prima di rettificare l’inizio. Se ci sono più fasi concluse chiedere quale correggere; non scegliere arbitrariamente. Non modifica dati.',
  inputSchema: jsonSchema({type:'object',additionalProperties:false,required:['query'],properties:{query:{type:'string',minLength:2,maxLength:100}}}),
  execute: input => productionDateCall(auth,'lookup',input) }
}; }

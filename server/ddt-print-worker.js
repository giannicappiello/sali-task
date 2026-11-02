import {timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createProgremesReadonlyAdmin} from './progremes-readonly-auth.js';
import {assert} from '../shared/orderPreparation.js';
import {checked} from './order-preparation-auth.js';

export async function handleDdtPrintWorker(req, {env=globalThis.process.env,adminFactory=createProgremesReadonlyAdmin}={}) {
  const expected=Buffer.from(env.DDT_PRINT_WORKER_SECRET || '');
  const supplied=Buffer.from(String(req.headers?.authorization || '').replace(/^Bearer\s+/i,''));
  assert(expected.length>=32 && supplied.length===expected.length && timingSafeEqual(expected,supplied),'Agente stampa non autorizzato.',401);
  const {station,action,input={}}=req.body;
  assert(/^[A-Za-z0-9_-]{1,80}$/.test(station) && ['inventory','claim','printing','submitted','uncertain','failed'].includes(action),'Richiesta stampa non valida.');
  return {result:checked(await adminFactory().rpc('warehouse_print_worker',{p_station:station,p_action:action,p_input:input}))};
}

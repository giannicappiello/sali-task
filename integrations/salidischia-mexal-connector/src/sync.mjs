import { documentPayload } from './order.mjs';

// Adapter must validate its installed Mexal field contract and verify persisted
// customer data, delivery destination, taxes and OC totals by GET after each write.
export async function syncOrder(plan, { journal, mexal, config, dryRun = true }) {
  if (dryRun) return { mode: 'preview', plan };
  if (!config.cutoverVerified || !config.contractVerified) throw new Error('Attivazione bloccata: verificare contratto API e arresto del vecchio connettore.');
  const duplicate = journal.reserve(plan);
  if (duplicate) return { mode: 'already-imported', documentRef: duplicate.document_ref };
  try {
    // Reconcile older imports independently from the new connector's local journal.
    const existing = await mexal.findExistingOrder(plan);
    if (existing) throw new Error('Possibile ordine già presente in Mexal: riconciliazione manuale necessaria.');
    // Preflight MUST check SKU/UOM, tax codes, price precision, client write mapping,
    // destination mapping and payment mapping before making ANY external mutation.
    await mexal.preflight(plan, config);
    documentPayload(plan, 'PREFLIGHT', config);
    journal.set(plan.key, 'customer_pending');
    const customerCode = await mexal.ensureCustomer(plan.customer);
    journal.set(plan.key,'customer_pending',customerCode);
    await mexal.verifyCustomer(customerCode, plan.customer);
    return await finishOrder(plan,{journal,mexal,config},customerCode);
  } catch (error) {
    // Never automatically repeat POST: a timeout can occur after Mexal committed it.
    journal.fail(plan.key,error);
    throw error;
  }
}

// Explicit operator recovery only: never called by the periodic worker.
export async function resumeOrder(plan,{journal,mexal,config}){
  const entry=journal.get(plan.key);
  if(!config.cutoverVerified||!config.contractVerified||entry?.status!=='reconciliation_required'||entry.plan_hash!==plan.hash||!entry.customer_code||entry.document_ref)throw Error('Recupero ordine non autorizzabile dallo stato corrente.');
  if(await mexal.findExistingOrder(plan))throw Error('OC già presente: recupero bloccato.');
  await mexal.preflight(plan,config);documentPayload(plan,'PREFLIGHT',config);
  try{
    journal.set(plan.key,'customer_pending');
    const code=await mexal.ensureCustomer(plan.customer,{expectedCode:entry.customer_code});
    if(code!==entry.customer_code)throw Error('Cliente differente durante il recupero.');
    await mexal.verifyCustomer(code,plan.customer);
    return await finishOrder(plan,{journal,mexal,config},code);
  }catch(error){journal.fail(plan.key,error);throw error;}
}

async function finishOrder(plan,{journal,mexal,config},customerCode){
    journal.set(plan.key, 'destination_pending', customerCode);
    const destinationCode = await mexal.prepareDestination(customerCode, plan);
    if (!destinationCode) throw new Error('Destinazione Mexal non verificata.');
    journal.set(plan.key, 'order_pending', customerCode);
    const payload = { ...documentPayload(plan, customerCode, config), cod_anag_sped: [[1, destinationCode]] };
    if(config.totalsServiceVerified)await mexal.validateTotals(plan,payload);
    const reference = await mexal.createOrder(payload, plan);
    if (!reference) throw new Error('Mexal non ha restituito il riferimento OC.');
    journal.set(plan.key, 'verification_pending', customerCode, reference);
    const verification=await mexal.verifyOrder(reference, plan, payload);
    journal.set(plan.key, 'verified', customerCode, reference);
    if(verification)journal.setVerification(plan.key,verification);
    return { mode: 'imported', documentRef: reference };
}

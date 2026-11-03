import {ensureDdtPdf,ensurePackingPdf} from './preparation-ddt-pdf.js';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { PDFDocument } from 'pdf-lib';
import { assert, scalar, text } from '../shared/orderPreparation.js';
import { buildPreparationPdf, packingListFileName } from '../src/pages/Warehouse/preparationPdf.js';
import { checked } from './order-preparation-auth.js';
import { unwrap, verifyDdt } from './order-preparation-mexal.js';
import { triggerArubaOrderEmailWorker } from './orders/order-email-dispatch.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export const MEXAL_BCF_PDF_SERVICE = 'mexal:stampa_movimento_magazzino';
export function emailAddress(value) {
  const email = text(value).toLowerCase();
  assert(email.length <= 254 && /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/.test(email), 'Indirizzo email mancante o non valido.');
  return email;
}

// Mexal permits several addresses in one field. Keep atomic validation strict
// (also used by configuration), then validate each explicitly listed address.
function mexalRecipientEmails(record) {
  const values = value => Array.isArray(value)
    ? value.flatMap(row => values(Array.isArray(row) ? row.at(-1) : row))
    : typeof value === 'string' && value.trim() ? [value] : [];
  const fields = ['email','mail','posta_elettronica'].flatMap(key => values(record?.[key]));
  const emails = [], invalid = [];
  for (const field of fields) {
    if (/[\r\n]/.test(field)) { invalid.push(true); continue; }
    for (const token of field.split(/[;,]/).filter(token => token.trim())) {
      try { emails.push(emailAddress(token)); } catch { invalid.push(true); }
    }
  }
  return {emails:[...new Set(emails)], invalid:invalid.length > 0};
}
export function validateDispatchSettings(body) {
  const settings = {};
  for (const [input,column] of [['emailCustomers','email_customers'],['emailAgents','email_agents']]) {
    if (!Object.hasOwn(body,input)) continue;
    assert(typeof body[input] === 'boolean', 'Scelta destinatari non valida.');
    settings[column] = body[input];
  }
  for (const [input,column] of [['ddtPrinterId','ddt_printer_id'],['packingPrinterId','packing_printer_id']]) {
    if (!Object.hasOwn(body,input)) continue;
    assert(typeof body[input] === 'string' && body[input].length<=340 && !/[\r\n]/.test(body[input]),'Stampante non valida.');
    settings[column] = body[input] || null;
  }
  if (Object.hasOwn(body, 'bcfContractVerified')) {
    assert(typeof body.bcfContractVerified === 'boolean', 'Conferma contratto BCF non valida.');
    settings.bcf_contract_verified = body.bcfContractVerified;
  }
  if (Object.hasOwn(body, 'ddtPdfPath')) {
    const path = text(body.ddtPdfPath);
    assert(!path || path === MEXAL_BCF_PDF_SERVICE || (/^\/documenti\/[A-Za-z0-9_/{}.?=&%+-]+$/.test(path) && !path.includes('..') && path.split('{reference}').length === 2), 'Collegamento PDF Mexal non valido.');
    settings.ddt_pdf_path = path || null;
  }
  if (Object.hasOwn(body, 'backofficeEmails')) {
    assert(Array.isArray(body.backofficeEmails) && body.backofficeEmails.length <= 10, 'Destinatari backoffice non validi.');
    settings.backoffice_emails = [...new Set(body.backofficeEmails.map(emailAddress))];
  }
  for (const [input, field, limit] of [['emailSubject','email_subject',300], ['emailBody','email_body',10000], ['contractEvidence','contract_evidence',2000]]) {
    if (!Object.hasOwn(body,input)) continue;
    assert(typeof body[input] === 'string' && body[input].trim().length <= limit, 'Testo configurazione non valido.');
    if (field === 'email_subject') assert(!/[\r\n]/.test(body[input]), 'Oggetto email non valido.');
    settings[field] = body[input].trim();
  }
  return settings;
}

export async function shipmentPreview(db, client, row, settings) {
  assert(settings.bcf_contract_verified && text(settings.contract_evidence), 'Verifica il contratto BCF in Impostazioni → Integrazioni → Configurazioni DDT.', 409);
  assert(settings.ddt_pdf_path, 'Configura il percorso verificato del PDF BCF Mexal.', 409);
  validateDispatchSettings({ddtPdfPath: settings.ddt_pdf_path});
  assert(settings.backoffice_emails?.length, 'Configura almeno un destinatario backoffice DDT.', 409);
  const raw = row.source_raw;
  const agentCode = text(scalar(raw.codice_agente));
  const emailCustomers = settings.email_customers !== false;
  const emailAgents = settings.email_agents !== false;
  const candidates = [], recipientWarnings = [];
  function addOptional(role, record) {
    const result = mexalRecipientEmails(record);
    candidates.push(...result.emails.map(email => ({role,email})));
    if (!result.emails.length || result.invalid) recipientWarnings.push({role,
      code:result.emails.length ? 'partially_invalid' : 'missing_or_invalid',
      message:result.emails.length
        ? `Invio email ${role}: alcuni indirizzi non validi sono stati esclusi; gli indirizzi validi restano destinatari.`
        : `Email non inviata ${role === 'agente' ? 'all’agente' : 'al cliente'}: indirizzo mancante o non valido.`});
  }
  if (emailCustomers) {
    try {
      const customer = unwrap(await client.getJson('/clienti/' + encodeURIComponent(row.source.customerCode)));
      addOptional('cliente', customer);
    } catch {
      recipientWarnings.push({role:'cliente',code:'lookup_failed',message:'Email non inviata al cliente: recapito Mexal non verificabile.'});
    }
  }
  if (emailAgents) {
    if (!agentCode) recipientWarnings.push({role:'agente',code:'agent_missing',message:'Email non inviata all’agente: agente assente sull’OCM.'});
    else try {
      const agent = checked(await db.from('mexal_agenti').select('codice,email').eq('codice',agentCode).maybeSingle());
      addOptional('agente', agent);
    } catch {
      recipientWarnings.push({role:'agente',code:'lookup_failed',message:'Email non inviata all’agente: recapito non verificabile.'});
    }
  }
  candidates.push(...settings.backoffice_emails.map(email => ({role:'backoffice',email:emailAddress(email)})));
  const recipients = [];
  for (const candidate of candidates) {
    const existing = recipients.find(item => item.email === candidate.email);
    if (existing) { if (!existing.roles.includes(candidate.role)) existing.roles.push(candidate.role); }
    else recipients.push({email:candidate.email,roles:[candidate.role]});
  }
  const snapshot = {preparationId:row.id, sourceHash:row.source_hash, version:row.version,
    recipients, recipientWarnings, agentCode, emailCustomers, emailAgents, pdfPath:settings.ddt_pdf_path, pdfPrintModule:'S', packingLayout:'compact-v2', contractEvidence:settings.contract_evidence,
    subject:settings.email_subject || 'Documenti spedizione {documento}',
    body:settings.email_body || 'In allegato la bolla {documento} e la packing list dell’ordine {ordine}.',
  };
  return {...snapshot, hash:hash(JSON.stringify(snapshot))};
}

export async function shipmentReadback(db, row, kind) {
  if (kind) {
    assert(['bcf','bcf_print','packing_list'].includes(kind) || /^packing_pallet_[a-f0-9-]{36}$/.test(kind), 'Documento non valido.');
    const document = checked(await db.from('warehouse_current_preparation_documents').select('kind,filename,sha256,base64,created_at')
      .eq('preparation_id',row.id).eq('kind',kind).single());
    return {document};
  }
  const [documents, jobs] = await Promise.all([
    db.from('warehouse_current_preparation_documents').select('kind,filename,sha256,created_at').eq('preparation_id',row.id),
    db.from('warehouse_shipment_emails').select('id,recipient,roles,status,attempts,last_error,sent_at,provider_message_id').eq('preparation_id',row.id),
  ]);
  return {documents:checked(documents),emails:checked(jobs),recipientWarnings:row.dispatch_snapshot?.recipientWarnings || []};
}

// Recovery only prepares missing artifacts. It never reissues the Mexal document.
// Errors here must not turn a confirmed DDT back into an uncertain emission.
export async function finalizeShipment(db, client, row, { trigger = triggerArubaOrderEmailWorker } = {}) {
  try {
    assert(row.status === 'completed' && row.ddt?.signature === 'BCF', 'Spedizione BCF non confermata.', 409);
    assert(Number(client.anno) === row.source.year, 'Anno Mexal diverso da quello della spedizione: nessun PDF recuperato.',409);
    const snapshot = row.dispatch_snapshot;
    assert(snapshot?.recipients?.length, 'Riepilogo destinatari non disponibile.', 409);
    const existing = checked(await db.from('warehouse_current_preparation_documents').select('kind').eq('preparation_id',row.id));
    if (existing.length !== 3 + row.state.pallets.length) {
      const actual = row.confirmed_document;
      verifyDdt(actual, row, row.export_payload);
      if (snapshot.pdfPath === MEXAL_BCF_PDF_SERVICE) verifyDdt(await client.getJson('/documenti/movimenti-magazzino/'+encodeURIComponent(row.ddt.reference)),row,row.export_payload);
      const result = snapshot.pdfPath === MEXAL_BCF_PDF_SERVICE
        ? await client.printMovementPdf({sigla:'BC',serie:Number(row.ddt.series),numero:Number(row.ddt.number),cod_conto:row.source.customerCode,cod_modulo:'F'})
        : await client.getBinary(snapshot.pdfPath.replace('{reference}',encodeURIComponent(row.ddt.reference)),{accept:'application/pdf'});
      const pdf = Buffer.from(result.body);
      assert(pdf.subarray(0,5).toString() === '%PDF-' && pdf.length <= 10 * 1024 * 1024, 'Il servizio Mexal non ha restituito un PDF BCF valido.');
      const preparation = {...row,source:{...row.source,destination:row.verification.destination || row.source.destination}};
      const packing = Buffer.from(buildPreparationPdf(preparation).output('arraybuffer'));
      const source = await PDFDocument.load(pdf), print = await PDFDocument.create();
      for (let copy=0;copy<3;copy++) for (const page of await print.copyPages(source,source.getPageIndices())) print.addPage(page);
      const files = [{kind:'bcf',filename:`BCF_${row.source.year}_${row.ddt.series}_${row.ddt.number}.pdf`,bytes:pdf},
        {kind:'bcf_print',filename:`BCF_${row.ddt.number}_3_copie.pdf`,bytes:Buffer.from(await print.save())},
        {kind:'packing_list',filename:packingListFileName(row),bytes:packing},
        ...row.state.pallets.map(pallet=>({kind:'packing_pallet_'+pallet.id,filename:`PackList_${row.ddt.number}_Bancale_${pallet.number}.pdf`,
          bytes:Buffer.from(buildPreparationPdf(preparation,{palletId:pallet.id}).output('arraybuffer'))}))]
        .map(({bytes,...file}) => ({...file,base64:bytes.toString('base64'),sha256:hash(bytes)}));
      checked(await db.rpc('warehouse_commit_shipment', {p_id:row.id,p_files:files}));
    }
    await ensureDdtPdf(db,client,row);
    await ensurePackingPdf(db,row);
    const dispatch = await trigger();
    return {shipment:await shipmentReadback(db,row),dispatch};
  } catch (error) {
    return {warning:'BCF confermata. Documenti/email da completare: ' + error.message};
  }
}

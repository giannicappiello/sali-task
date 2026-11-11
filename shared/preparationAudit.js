export const preparationEventLabels={created:'Preparazione creata',scan:'Inserimento articoli',verify:'Riscontro e chiusura colli',reopen_package:'Collo riaperto',remove_quantity:'Quantità corretta',undo:'Lettura annullata',remove_scan:'Lettura eliminata',add_package:'Collo aggiunto',add_pallet:'Bancale aggiunto',assign:'Assegnazione bancale',remove_package:'Collo eliminato',remove_pallet:'Bancale eliminato',claim_export:'Richiesta emissione BCF',finish:'BCF confermata',uncertain:'Esito BCF da verificare',cancel:'Preparazione annullata',reopen:'Preparazione ripresa',refresh:'Ordine aggiornato',documents_and_emails_queued:'Documenti archiviati e invii accodati',email_claimed:'Email acquisita',email_sending:'Invio email avviato',email_complete:'Email accettata dal servizio',email_retry:'Tentativo email',email_failed:'Email non inviata',email_lease_expired:'Tentativo email interrotto',email_manual_resolution:'Esito email verificato',print_queued:'Stampa accodata',print_printing:'Stampa avviata',print_submitted:'Documento inviato alla stampante',print_uncertain:'Esito stampa da verificare',print_failed:'Stampa non riuscita',print_lease_expired:'Stampa interrotta',print_manual_reprint:'Ristampa richiesta',print_copies_selected:'Numero copie selezionato',automatic_completion_finished:'Completamento automatico concluso',automatic_completion_retry:'Nuovo controllo automatico',ddt_pdf_corrected:'PDF DDT corretto',packing_pdf_compacted:'Packing list compattata',orphan_ddt_delete_requested:'Cancellazione bolla richiesta',orphan_ddt_deleted:'Bolla senza collegamento eliminata',ddt_rejected_reset:'Emissione rifiutata: preparazione ripristinata'};

// Only changed readings are exported, including removed readings from beforeState.
// Full packing snapshots remain in the immutable source event, not in the PDF payload.
export function preparationAuditRecord(event){
 const p=event.payload||{},state=p.state,before=p.beforeState,prior=new Map((before?.scans||[]).map(s=>[s.id,s]));
 const readings=[];
 const location=scan=>{const pack=state?.packages?.find(x=>x.id===scan.packageId)||before?.packages?.find(x=>x.id===scan.packageId);const pallet=state?.pallets?.find(x=>x.id===pack?.palletId)||before?.pallets?.find(x=>x.id===pack?.palletId);return {packageId:scan.packageId,packageNumber:pack?.number,palletId:pack?.palletId,palletNumber:pallet?.number};};
 for(const scan of state?.scans||[]){const old=prior.get(scan.id);if(!old||old.quantity!==scan.quantity)readings.push({...location(scan),id:scan.id,code:scan.code,quantity:scan.quantity,previousQuantity:old?.quantity,action:old?'correction':'insert',at:scan.at||null,actor:scan.actor||null,mode:scan.mode});}
 for(const scan of before?.scans||[]){if(state&&!state.scans.some(s=>s.id===scan.id))readings.push({...location(scan),id:scan.id,code:scan.code,quantity:0,previousQuantity:scan.quantity,action:'remove',at:scan.at||null,actor:scan.actor||null,mode:scan.mode});}
 return {id:event.id,eventId:event.event_id,at:event.created_at,actor:event.actor,operatorName:p.operatorName||event.actor,operation:p.operation||event.event_type,readings,reason:p.reason||p.message||p.error||p.dispatch?.recipientWarnings?.map(warning=>warning.message).join(" ")||null,ddt:p.ddt||null,documents:p.documents?.map(f=>({filename:f.filename,sha256:f.sha256})),recipients:p.recipients||p.dispatch?.recipients||null,printer:p.printer_id||null,copies:p.copies||null,lots:p.verification?.allocations?.map(l=>({code:l.code,lot:l.lotCode||l.lotId,quantity:l.quantity,warehouse:l.warehouse}))||null};
}

export function preparationAuditPage(events,{previousState=null,operators=[]}={}){
 const names=new Map(operators.map(u=>[u.id,[u.nome,u.cognome].filter(Boolean).join(' ').trim()||u.id]));
 return events.map(event=>{
  const payload=event.payload||{},state=payload.state;
  const before=payload.beforeState||previousState;
  const record=preparationAuditRecord({...event,payload:{...payload,...(before?{beforeState:before}:{})}});
  if(state)previousState=state;
  if(!payload.operatorName||payload.operatorName===event.actor)record.operatorName=names.get(event.actor)||event.actor;
  record.readings=record.readings.map(scan=>({...scan,operatorName:scan.actor?names.get(scan.actor)||scan.actor:null}));
  record.packingChanges=[];
  if(state){
   for(const pack of state.packages||[]){const old=before?.packages?.find(p=>p.id===pack.id);if(!old)record.packingChanges.push(`Collo ${pack.number} aggiunto`);else if(old.palletId!==pack.palletId){const from=before.pallets?.find(p=>p.id===old.palletId)?.number??'nessuno',to=state.pallets?.find(p=>p.id===pack.palletId)?.number??'nessuno';record.packingChanges.push(`Collo ${pack.number}: bancale ${from} -> ${to}`);}}
   for(const pack of before?.packages||[])if(!state.packages?.some(p=>p.id===pack.id))record.packingChanges.push(`Collo ${pack.number} eliminato`);
   for(const pallet of state.pallets||[])if(!before?.pallets?.some(p=>p.id===pallet.id))record.packingChanges.push(`Bancale ${pallet.number} aggiunto`);
   for(const pallet of before?.pallets||[])if(!state.pallets?.some(p=>p.id===pallet.id))record.packingChanges.push(`Bancale ${pallet.number} eliminato`);
  }
  return record;
 });
}

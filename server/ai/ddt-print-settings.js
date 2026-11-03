import {createMesDdtPrinting} from '../ddt-mes-print.js';
import {checked} from '../order-preparation-auth.js';

export const warehousePrintOptions = Object.freeze({duplex:'long-edge',color:'monochrome',tray:'1'});
export const ddtPrintSettingsSchema = {
  type:'object',additionalProperties:false,required:['reason'],
  properties:{reason:{type:'string',minLength:5,maxLength:500}},
};

export async function readDdtPrintSettings(auth,{printing=createMesDdtPrinting()}={}) {
  if(auth.profile?.ruoli?.amministratore_workspace!==true || !checked(await auth.admin.rpc('workspace_screen_permission_for_user',{
    target_user_id:auth.profile.id,permission_code:'integrations.configure',target_screen:'integrazioni.ddt',
  }))) throw Object.assign(new Error('Configurazione DDT non autorizzata.'),{status:403});
  const current=checked(await auth.admin.from('warehouse_preparation_settings')
    .select('updated_at,ddt_printer_id,packing_printer_id,print_options').eq('id',true).single());
  const inventory=await printing.readInventory();
  const printer=inventory.configuration?.warehousePrinter;
  const supported=inventory.enabled===true && inventory.warehousePrintOptionsVersion===1 &&
    inventory.printers?.some(p=>p.name===printer && p.available && p.canPrintSilently);
  return {before:current,after:{ddt_printer_id:printer?'MES:'+printer:null,packing_printer_id:printer?'MES:'+printer:null,print_options:warehousePrintOptions},
    supported:Boolean(supported),readAt:new Date().toISOString(),
    scope:'Solo nuove richieste DDT e packing list di singolo bancale; nessuna stampa o ristampa. Fronte/retro sul lato lungo.',
    driverCheck:'Il driver deve confermare fronte/retro, bianco e nero e il vassoio 1 prima di inviare carta.'};
}

export async function previewDdtPrintSettings(auth,input,options) {
  const evidence=await readDdtPrintSettings(auth,options);
  if(!evidence.supported) throw Object.assign(new Error('Aggiornare ProgreMES e verificare la stampante MAGAZZINO prima di proporre le impostazioni.'),{status:409});
  return {reason:input.reason,targetCode:'integrazioni.ddt',expectedUpdatedAt:evidence.before.updated_at,
    printerId:evidence.after.ddt_printer_id,printOptions:warehousePrintOptions,evidence};
}

export async function applyDdtPrintSettings(auth,pending) {
  try {
    const data=checked(await auth.admin.rpc('warehouse_apply_print_settings_proposal',{
      p_proposal:pending.id,p_actor:auth.profile.id,
    }));
    return {action:Array.isArray(data)?data[0]:data,failure:null};
  } catch(error) {
    // Read the persisted outcome first: a lost RPC response must not repeat a successful change.
    const saved=checked(await auth.admin.from('ai_action_audit').select('*').eq('id',pending.id).eq('user_id',auth.profile.id).single());
    if(saved.status==='executed') return {action:saved,failure:null};
    if(saved.status!=='confirmed') return {action:saved,failure:saved.error||error.message};
    const data=checked(await auth.admin.rpc('complete_workspace_external_ai_action',{
      p_proposal_id:pending.id,p_succeeded:false,p_result:{changed:false},p_error:error.message,
    }));
    return {action:Array.isArray(data)?data[0]:data,failure:error.message};
  }
}

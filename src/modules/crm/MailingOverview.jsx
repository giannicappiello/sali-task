import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { loadAllQueryRows } from './crmDataset';
import { mailingOverview, deliveryLabel } from './mailingOverviewModel.js';
import { CrmKpiCard, CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import CrmCustomerLink from './CrmCustomerLink';
import { formatDate } from './crmConfig';

export default function MailingOverview({ connections, period }) {
  const [data, setData] = useState({ identities: [], consents: [], deliveries: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    let active = true;
    const ids = connections.filter(row => row.provider_code === 'mailchimp').map(row => row.id);
    async function load() {
      setLoading(true); setError('');
      if (!ids.length) { setData({identities:[],consents:[],deliveries:[]}); setLoading(false); return; }
      const results = await Promise.all([
        loadAllQueryRows((from,to) => supabase.from('crm_external_customers').select('id,connection_id,account_id,crm_accounts(id,nome,email,codice_cliente_mexal,metadati)').in('connection_id',ids).order('id').range(from,to)),
        loadAllQueryRows((from,to) => supabase.from('crm_marketing_consents').select('id,account_id,status,source,captured_at,withdrawn_at,created_at:creato_il').like('source','mailchimp:%').order('id').range(from,to)),
        loadAllQueryRows((from,to) => supabase.from('crm_mailing_deliveries').select('id,connection_id,account_id,campaign_id,title,sent_at,delivery_status').in('connection_id',ids).order('id').range(from,to)),
      ]);
      if (!active) return;
      const failure = results.find(row => row.error)?.error;
      if (failure) setError(failure.message);
      else setData({identities:results[0].data || [],consents:results[1].data || [],deliveries:results[2].data || []});
      setLoading(false);
    }
    void load().catch(e => { if(active) {setError(e.message);setLoading(false);} });
    return () => { active = false; };
  },[connections]);
  const model = useMemo(() => mailingOverview(data.identities,data.consents,data.deliveries,connections.filter(row=>row.provider_code==='mailchimp'),period),[data,connections,period]);
  const contactColumns = [
    {key:'name',label:'Cognome e Nome',value:row=>row.name,render:row=><CrmCustomerLink crmType="online" accountId={row.id} name={row.name} period={period}/>},
    {key:'email',label:'Email',value:row=>row.email},
    {key:'status',label:'Iscrizione mailing',value:row=>row.label},
    {key:'period',label:'Mailing ricevute nel periodo',value:row=>row.receivedInPeriod},
    {key:'received',label:'Mailing ricevute totali',value:row=>row.received == null ? 'Dato non disponibile' : row.received},
  ];
  if (loading) return <p role="status">Caricamento contatti e campagne Mailchimp…</p>;
  if (error) return <p className="crm-message error">Impossibile caricare i dati Mailchimp: {error}</p>;
  const complete = connections.filter(row=>row.provider_code==='mailchimp').every(row=>row.import_state?.completed && row.import_state?.mailing_complete);
  return <>
    <section className="b2b-kpi-section" aria-label="KPI Mailchimp"><h2>Mailchimp</h2>
      <p>Contatti e iscrizioni: stato attuale. Campagne e invii: dal {formatDate(period.from)} al {formatDate(period.to)}. Gli invii registrati non attestano la lettura dell’email.</p>
      {!complete ? <p role="status">Importazione parziale: i conteggi possono essere incompleti.</p> : null}
      <div className="crm-kpi-grid">
        <CrmKpiCard label="Contatti Mailchimp" value={model.contacts.length} note="Anagrafiche uniche collegate" info="Contatti importati da Mailchimp, compresi quelli già presenti dal sito. Ogni anagrafica è contata una volta." onClick={()=>setSelected({kind:'contacts',title:'Contatti Mailchimp'})}/>
        <CrmKpiCard label="Iscritti alla mailing" value={model.subscribers.length} note="Stato attuale del consenso" info="Contatti con almeno un consenso Mailchimp attualmente attivo; per ciascuna audience vale lo stato più recente." onClick={()=>setSelected({kind:'subscribers',title:'Iscritti alla mailing'})}/>
        <CrmKpiCard label="Campagne nel periodo" value={model.campaigns.length} note={model.totalCampaigns+' campagne importate complessive'} info="Campagne con destinatari importati e data di invio nel periodo selezionato." onClick={()=>setSelected({kind:'campaigns',title:'Campagne nel periodo'})}/>
        <CrmKpiCard label="Invii registrati nel periodo" value={model.sent} note={model.bounced+' rimbalzi esclusi'} info="Registrazioni con stato sent fornite da Mailchimp, escluse quelle con rimbalzo. Uno stesso contatto può ricevere più campagne. Non misura aperture o clic." onClick={()=>setSelected({kind:'sent',title:'Invii registrati nel periodo'})}/>
      </div>
    </section>
    <section className="panel crm-panel"><h3>Campagne Mailchimp</h3><p>Seleziona una campagna per vedere i destinatari e l’esito degli invii.</p><CrmDetailTable rows={model.campaigns} empty="Nessuna campagna importata nel periodo selezionato. Amplia l’intervallo per vedere lo storico." columns={[
      {key:'title',label:'Campagna',value:row=>row.title,render:row=><button type="button" className="crm-customer-link" onClick={()=>setSelected({kind:'recipients',title:row.title,rows:row.recipients})}>{row.title}</button>},
      {key:'date',label:'Data invio',value:row=>formatDate(row.sent_at)},
      {key:'recipients',label:'Destinatari',value:row=>row.recipients.length},
      {key:'sent',label:'Invii registrati',value:row=>row.sent},
      {key:'bounced',label:'Rimbalzi',value:row=>row.bounced},
      {key:'other',label:'Altri esiti',value:row=>row.other},
    ]}/></section>
    <section className="panel crm-panel"><h3>Contatti e iscrizione mailing</h3>{model.unlinked ? <p>{model.unlinked} identità senza anagrafica CRM collegata.</p> : null}<CrmDetailTable rows={model.contacts} columns={contactColumns} empty="Nessun contatto Mailchimp importato. Avvia Importa dati per acquisire i contatti."/></section>
    {selected ? <CrmKpiDialog title={selected.title} onClose={()=>setSelected(null)}>
      {['contacts','subscribers'].includes(selected.kind) ? <CrmDetailTable rows={selected.kind==='subscribers'?model.subscribers:model.contacts} columns={contactColumns}/> : selected.kind==='campaigns' ? <ul>{model.campaigns.map(row=><li key={row.id}><button type="button" className="crm-customer-link" onClick={()=>setSelected({kind:'recipients',title:row.title,rows:row.recipients})}>{row.title}</button> · {formatDate(row.sent_at)} · {row.sent} invii</li>)}</ul> : <CrmDetailTable rows={selected.rows || model.campaigns.flatMap(row=>row.recipients).filter(row=>row.delivery_status==='sent')} columns={[
        {key:'name',label:'Cognome e Nome',value:row=>row.name,render:row=>row.account_id ? <CrmCustomerLink crmType="online" accountId={row.account_id} name={row.name} period={period}/> : 'Anagrafica non collegata'},
        {key:'email',label:'Email',value:row=>row.email},
        {key:'title',label:'Campagna',value:row=>row.title},
        {key:'status',label:'Esito',value:row=>deliveryLabel(row.delivery_status)},
        {key:'date',label:'Data invio',value:row=>formatDate(row.sent_at)},
      ]}/>}
    </CrmKpiDialog> : null}
  </>;
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { CrmKpiCard, CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import { CrmPageHeader, CrmSectionNav } from './CrmWorkspaceUI';
import CrmPeriodFilter from './CrmPeriodFilter';
import CrmCustomerLink from './CrmCustomerLink';
import { crmNavigation } from './crmNavigation';
import { formatDate, formatMoney } from './crmConfig';
import { loadAllQueryRows, loadAllRpcRows } from './crmDataset';
import { beautyDetailEvents, postEventOrderValue } from './crmBeautyData';
import { crmFunctionError } from './crmFunctionError';

const valueColumn = (key, label) => ({ key, label, value: r => r[key] });
const moneyColumn = (key, label) => ({ key, label, value: r => formatMoney(r[key]), sortValue: r => Number(r[key] || 0) });
const dateColumn = (key, label) => ({ key, label, value: r => formatDate(r[key]), sortValue: r => r[key] });

export default function CrmB2BDashboard({ data, firstOrderSuggestions, loading, error, period, retry }) {
  const [selected, setSelected] = useState(null); const [details, setDetails] = useState({ rows: [], loading: false, error: '' });
  const [extra, setExtra] = useState({ lifecycle: null, beauty: null, errors: {} });
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setExtra({ lifecycle: null, beauty: null, errors: {} });
      const results = await Promise.allSettled([
        supabase.rpc('crm_b2b_lifecycle_summary').then(r => { if (r.error) throw r.error; return r.data; }),
        (async () => { const settings = await supabase.from('crm_workflow_settings').select('beauty_post_evento_giorni').eq('crm_tipo', 'b2b').maybeSingle(); if (settings.error) throw settings.error;
          const result = await supabase.functions.invoke('report-giornate-api', { body: { action: 'crm-beauty-dashboard', postDays: settings.data?.beauty_post_evento_giorni || 30, from: period.from, to: period.to } });
          if (result.error) throw await crmFunctionError(result.error); if (result.data?.error) throw new Error(result.data.error); return result.data;
        })(),
      ]);
      if (!active) return;
      const next = { errors: {} }; ['lifecycle', 'beauty'].forEach((key, i) => { next[key] = results[i].status === 'fulfilled' ? results[i].value : null; if (results[i].status === 'rejected') next.errors[key] = results[i].reason.message; }); setExtra(next);
    }, 0); return () => { active = false; clearTimeout(timer); };
  }, [period.from, period.to]);
  useEffect(() => {
    if (!selected) return;
    let active = true; const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDetails({ rows: [], loading: true, error: '' });
      try {
        let rows = [];
        if (selected.kind === 'customers') {
          const result = await loadAllRpcRows('crm_customer_metric_details', { p_crm_type: 'b2b', p_from: period.from, p_to: period.to, p_metric: selected.metric || 'all', p_search: null, p_customer_status: selected.status || 'active' });
          if (result.error) throw result.error; rows = result.data;
          if (selected.metric === 'all') {
            const prospects = await loadAllRpcRows('crm_prospect_customer_details', { p_crm_type: 'b2b', p_search: null, p_customer_status: selected.status || 'active' });
            if (prospects.error) throw prospects.error;
            rows = [...rows, ...prospects.data.map(r => ({ ...r, account_id: r.id, ragione_sociale: r.nome }))];
          }
        } else if (selected.kind === 'opportunities') {
          const result = await loadAllQueryRows((from, to) => supabase.from('crm_opportunities').select('*,crm_accounts!inner(id,nome,tipo,codice_cliente_mexal),crm_opportunity_stages(nome,finale)').eq('crm_accounts.tipo', 'b2b').order('id').range(from, to));
          if (result.error) throw result.error;
          rows = result.data.filter(r => !r.crm_opportunity_stages?.finale && (selected.metric !== 'overdue' || r.chiusura_prevista && r.chiusura_prevista < new Date().toISOString().slice(0, 10)));
        } else if (selected.kind === 'activities') {
          const result = await loadAllQueryRows((from, to) => supabase.from('crm_activities').select('*,crm_accounts(nome,codice_cliente_mexal),checklist_template:catalog_template_id(titolo)').eq('crm_tipo', 'b2b').order('id').range(from, to)); if (result.error) throw result.error;
          rows = result.data.filter(r => r.stato !== 'completata' && r.data_attivita && new Date(r.data_attivita) < new Date());
        } else if (selected.kind === 'lifecycle') {
          const result = await loadAllQueryRows((from, to) => supabase.rpc('crm_b2b_lifecycle_details').range(from, to).abortSignal(controller.signal));
          if (result.error) throw result.error;
          rows = result.data.filter(r => selected.metric === 'reorders' ? Number(r.numero_ordini) > 1 : r.classificazione === selected.metric);
        }
        if (active) setDetails({ rows, loading: false, error: '' });
      } catch (failure) { if (active) setDetails({ rows: [], loading: false, error: failure.message }); }
    }, 0); return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [selected, period.from, period.to]);
  const events = (extra.beauty?.events || []).filter(r => r.data >= period.from && r.data <= period.to);
  const executed = events.filter(r => r.stato === 'eseguita');
  const card = (label, value, note, info, selection) => <CrmKpiCard key={label} label={label} value={value ?? '—'} note={note} info={info} onClick={() => { setDetails({ rows: [], loading: true, error: '' }); setSelected({ label, ...selection }); }}/ >;
  const customer = (metric = 'all', status = 'active') => ({ kind: 'customers', metric, status });
  const clientColumn = { key: 'customer', label: 'Cliente', value: r => r.ragione_sociale || r.customer_name || r.crm_accounts?.nome || r.nome, render: r => <CrmCustomerLink crmType="b2b" customerCode={r.codice_cliente || r.customer_code || r.crm_accounts?.codice_cliente_mexal} accountId={r.account_id || r.crm_accounts?.id} name={r.ragione_sociale || r.customer_name || r.crm_accounts?.nome || r.nome} period={period}/> };
  function detail() {
    let rows = details.rows; let columns;
    if (selected.kind === 'beauty') {
      if (extra.errors.beauty) return <p role="alert">{extra.errors.beauty}</p>;
      if (!extra.beauty) return <p>Caricamento Beauty Days…</p>;
      rows = beautyDetailEvents(events, selected.metric).map(r => ({ ...r, order_value: r.impact?.order_value }));
      columns = [clientColumn, dateColumn('data', 'Data'), valueColumn('stato', 'Stato'), valueColumn('numero_totale_pezzi_venduti', 'Pezzi'), moneyColumn('fatturato_giornata', 'Fatturato giornata'), moneyColumn('order_value', 'Ordinato post-evento')];
    } else if (selected.kind === 'first') { rows = firstOrderSuggestions; columns = [clientColumn, valueColumn('opportunity_title', 'Progetto'), dateColumn('first_order_date', 'Primo ordine'), moneyColumn('first_order_value', 'Valore'), { key: 'open', label: 'Conferma', value: () => 'Apri progetto', render: r => <Link to={period.withPeriod(`/crm/b2b/pipeline/${r.opportunity_id}`)}>Apri progetto</Link> }];
    } else {
      if (details.loading) return <p role="status">Caricamento dettagli…</p>;
      if (details.error) return <p role="alert">{details.error}</p>;
      if (selected.kind === 'customers') columns = [clientColumn, valueColumn('codice_cliente', 'Codice'), valueColumn('agente_classificazione', 'Agente'), moneyColumn('invoice_total', 'Fatturato'), valueColumn('invoice_count', 'Fatture'), moneyColumn('order_total', 'Ordinato'), valueColumn('order_count', 'Ordini')];
      else if (selected.kind === 'opportunities') columns = [clientColumn, valueColumn('titolo', 'Progetto'), { key: 'stage', label: 'Fase', value: r => r.crm_opportunity_stages?.nome }, moneyColumn('valore', 'Valore'), valueColumn('probabilita', 'Probabilità %'), dateColumn('chiusura_prevista', 'Chiusura prevista'), { key: 'open', label: 'Dettaglio', value: () => 'Apri progetto', render: r => <Link to={period.withPeriod(`/crm/b2b/pipeline/${r.id}`)}>Apri progetto</Link> }];
      else if (selected.kind === 'activities') columns = [clientColumn, valueColumn('titolo', 'Attività'), { key: 'type', label: 'Voce checklist', value: r => r.checklist_template?.titolo || r.tipo }, dateColumn('data_attivita', 'Scadenza'), valueColumn('stato', 'Stato')];
      else columns = [clientColumn, valueColumn('classificazione', 'Classificazione'), dateColumn('ultimo_ordine_il', 'Ultimo ordine'), valueColumn('numero_ordini', 'Ordini storici'), valueColumn('frequenza_media_giorni', 'Frequenza media (giorni)'), dateColumn('contatto_consigliato_il', 'Riordino atteso')];
    }
    return <>{selected.kind === 'lifecycle' && <p>Situazione corrente, calcolata con le stesse soglie e lo stesso storico della card.</p>}<CrmDetailTable rows={rows} columns={columns}/></>;
  }
  const life = extra.lifecycle || {}; const lifeValue = name => extra.errors.lifecycle ? '—' : extra.lifecycle ? life[name] : '…';
  const beautyValue = value => extra.errors.beauty ? '—' : extra.beauty ? value : '…';
  return <div className="crm-page b2b-dashboard-page"><CrmPageHeader eyebrow="CRM B2B" title="Dashboard B2B" description="Clienti, attività commerciali e Beauty Days" actions={<CrmPeriodFilter period={period}/>}><CrmSectionNav items={crmNavigation('b2b')} period={period} label="Navigazione CRM B2B"/></CrmPageHeader>
    {error && <div role="alert" className="crm-message error">{error}<button onClick={retry}>Riprova</button></div>}
    {loading ? <p role="status">Caricamento KPI…</p> : <>
      <section className="b2b-kpi-section"><h2>1. Clienti, fatturato e ordini</h2><div className="crm-kpi-grid">
        {card('Clienti totali', data.crm_status?.total, 'Tutti gli stati CRM', 'Clienti visibili nel perimetro autorizzato, indipendentemente dallo stato CRM.', customer('all', 'all'))}
        {card('Clienti CRM attivi', data.crm_status?.active, 'Inclusi nelle viste operative', 'Clienti con stato CRM attivo.', customer())}
        {card('Clienti CRM non attivi', data.crm_status?.inactive, 'Storico conservato', 'Clienti disattivati nel CRM. Lo storico resta disponibile.', customer('all', 'inactive'))}
        {card('Clienti attivi nel periodo', data.customers_with_activity, 'Almeno un documento', 'Clienti con ordini o fatture nel periodo selezionato.', customer('active'))}
        {card('Nuovi clienti', data.new_customers, 'Prima vendita nel periodo', 'Clienti con prima vendita documentata nel periodo selezionato.', customer('new'))}
        {card('Fatturato', formatMoney(data.invoice_total), `${data.invoice_count || 0} fatture`, data.invoice_source_note || 'Somma del fatturato nel periodo selezionato.', customer('invoiced'))}
        {card('Ordinato', formatMoney(data.order_total), `${data.order_count || 0} ordini`, data.order_source_note || 'Somma dell’ordinato nel periodo selezionato.', customer('ordered'))}
        {card('Valore medio ordine', formatMoney(data.average_order_value), 'Periodo selezionato', 'Ordinato diviso per il numero di ordini nel periodo.', customer('ordered'))}
        {card('Clienti senza attività nel periodo', data.inactive_customers, 'Nessun documento da 90 giorni', 'Indicatore commerciale di inattività: non modifica lo stato attivo/non attivo del CRM.', customer('inactive'))}
      </div></section>
      <section className="b2b-kpi-section"><h2>2. Relazione commerciale e riordini</h2><div className="crm-kpi-grid">
        {[['Prospect','prospects','prospect','Clienti senza ordini documentati.'],['Primo ordine','first_order','primo_ordine','Clienti con un solo ordine.'],['Riordini','reorders','reorders','Clienti con almeno due ordini.'],['A rischio','at_risk','a_rischio','Clienti oltre la frequenza attesa, secondo le soglie configurate.'],['Dormienti','dormant','dormiente','Clienti oltre la soglia di dormienza configurata.'],['Persi','lost','perso','Clienti oltre la soglia di perdita configurata.']].map(([label, key, metric, info]) => card(label, lifeValue(key), 'Ciclo cliente · situazione attuale', info, { kind: 'lifecycle', metric }))}
      </div>{extra.errors.lifecycle && <p role="alert">{extra.errors.lifecycle}</p>}</section>
      <section className="b2b-kpi-section"><h2>3. Attività, progetti e Beauty Days</h2><div className="crm-kpi-grid">
        {card('Opportunità aperte', data.open_opportunities, 'Pipeline B2B', 'Opportunità nelle fasi non finali.', { kind: 'opportunities' })}
        {card('Valore pipeline', formatMoney(data.pipeline_value), 'Opportunità aperte', 'Somma del valore delle opportunità aperte.', { kind: 'opportunities' })}
        {card('Pipeline ponderata', formatMoney(data.weighted_pipeline), 'Valore × probabilità', 'Valore delle opportunità ponderato per probabilità di chiusura.', { kind: 'opportunities' })}
        {card('Progetti scaduti', data.overdue_opportunities, 'Chiusura prevista superata', 'Opportunità aperte con chiusura prevista già trascorsa.', { kind: 'opportunities', metric: 'overdue' })}
        {card('Follow-up scaduti', data.overdue_followups, 'Attività da completare', 'Attività non completate con scadenza trascorsa.', { kind: 'activities' })}
        {card('Primi ordini da confermare', firstOrderSuggestions.length, 'Rilevati da Mexal', 'Primi ordini rilevati: apri il progetto per verificare e confermare la chiusura.', { kind: 'first' })}
        {card('Clienti Beauty Days', beautyValue(new Set(events.map(e => e.customer_code)).size), 'Con giornate nel periodo', 'Clienti B2B visibili collegati a Beauty Days con almeno una giornata nel periodo.', { kind: 'beauty', metric: 'customers' })}
        {card('Beauty Days eseguiti', beautyValue(executed.length), 'Giornate nel periodo', 'Giornate promozionali eseguite nel periodo selezionato.', { kind: 'beauty', metric: 'executed' })}
        {card('Beauty Days pianificati', beautyValue(events.filter(e => e.stato === 'pianificata').length), 'Giornate nel periodo', 'Giornate promozionali pianificate nel periodo selezionato.', { kind: 'beauty', metric: 'planned' })}
        {card('Pezzi venduti Beauty Days', beautyValue(executed.reduce((s,e) => s + Number(e.numero_totale_pezzi_venduti || 0), 0)), 'Giornate eseguite', 'Pezzi dichiarati nei report delle giornate eseguite.', { kind: 'beauty', metric: 'units' })}
        {card('Fatturato Beauty Days', beautyValue(formatMoney(executed.reduce((s,e) => s + Number(e.fatturato_giornata || 0), 0))), 'Giornate eseguite', 'Fatturato dichiarato nei report delle giornate eseguite.', { kind: 'beauty', metric: 'revenue' })}
        {card('Ordinato post Beauty Days', beautyValue(formatMoney(postEventOrderValue(executed))), `${extra.beauty?.post_days || 30} giorni successivi`, 'Ordini successivi alle giornate eseguite. Ogni ordine viene conteggiato una sola volta nel totale, anche con eventi sovrapposti; non è attribuzione causale.', { kind: 'beauty', metric: 'post-revenue' })}
      </div>{extra.errors.beauty && <p role="alert">{extra.errors.beauty}</p>}</section>
    </>}
    {selected && <CrmKpiDialog key={`${selected.label}-${period.from}-${period.to}`} title={selected.label} subtitle={`CRM B2B · ${formatDate(period.from)} – ${formatDate(period.to)}`} onClose={() => setSelected(null)}>{detail()}</CrmKpiDialog>}
  </div>;
}

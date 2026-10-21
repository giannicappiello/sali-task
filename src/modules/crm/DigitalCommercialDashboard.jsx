import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { loadAllQueryRows, loadAllRpcRows } from './crmDataset';
import CrmPeriodFilter, { useCrmPeriod } from './CrmPeriodFilter';
import { CrmKpiCard, CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import { CrmPageHeader, CrmSectionNav } from './CrmWorkspaceUI';
import { crmNavigation } from './crmNavigation';
import CrmCustomerLink from './CrmCustomerLink';
import DigitalSalesDays from './DigitalSalesDays';
import { DIGITAL_CONNECTIONS, DATA_STATUS, connectionDataStatus } from './digitalConfig';
import { loadOnlineMailing } from './mailingData';
import { EMPTY_MAILING } from './mailingModel.js';
import { customerDisplayName, customerOrigin } from './customerIdentity';
import { formatDate, formatMoney } from './crmConfig';
import { marketplaceLabel } from './marketplaceLabel.js';
import { formatPurchaseAmount } from './customerPurchaseModel.js';
import { buildDigitalDashboard, displayAmounts } from './digitalDashboardModel.js';

const column = (key, label, value = row => row[key]) => ({ key, label, value });
const dateColumn = (key, label) => column(key, label, row => formatDate(row[key]));
const moneyColumn = (key, label) => ({ ...column(key, label, row => formatMoney(row[key])), sortValue: row => row[key] });
const EMPTY = { connections: [], accounts: [], orders: [], lines: [], opportunities: [], activities: [], commercial: {}, marketing: {}, warnings: [] };

async function readDashboard(from, to, channel, marketplace) {
  const result = await supabase.from('crm_external_connections').select('id,tipo,nome,provider,provider_code,stato,abilitata,ultimo_sync_il,import_state,marketplace_ids');
  if (result.error) throw result.error;
  const connections = result.data || [];
  const ids = connections.filter(row => !channel || row.tipo === channel).map(row => row.id);
  const noRows = { data: [], error: null };
  const end = new Date(`${to}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  const [orders, lines, identities, prospects, canonical, sources, commercial, marketing, opportunities, activities, mailing] = await Promise.all([
    ids.length ? loadAllQueryRows((start, last) => {
      let query = supabase.from('crm_external_orders').select('id,connection_id,account_id,external_id,ordered_at,stato,net_revenue,currency,marketplace,raw_summary').in('connection_id', ids).lt('ordered_at', end.toISOString());
      if (marketplace) query = query.eq('marketplace', marketplace);
      return query.order('ordered_at', { ascending: false }).order('id').range(start, last);
    }) : noRows,
    ids.length ? loadAllQueryRows((start, last) => {
      let query = supabase.from('crm_external_order_lines').select('id,order_id,external_line_id,external_sku,asin,product_id,quantity,line_revenue,metadati,crm_external_orders!inner(connection_id,marketplace,ordered_at)').in('crm_external_orders.connection_id', ids).gte('crm_external_orders.ordered_at', from).lt('crm_external_orders.ordered_at', end.toISOString());
      if (marketplace) query = query.eq('crm_external_orders.marketplace', marketplace);
      return query.order('id').range(start, last);
    }) : noRows,
    loadAllQueryRows((start, last) => supabase.from('crm_accounts').select('id,nome,fonte,codice_cliente_mexal,metadati').eq('tipo', 'online').order('id').range(start, last)),
    loadAllRpcRows('crm_prospect_customer_details', { p_crm_type: 'online', p_search: null, p_customer_status: 'all' }),
    loadAllRpcRows('crm_customer_metric_details', { p_crm_type: 'online', p_from: from, p_to: to, p_metric: 'all', p_search: null, p_customer_status: 'all' }),
    channel && ids.length ? loadAllQueryRows((start, last) => supabase.from('crm_external_customers').select('id,account_id').in('connection_id', ids).order('id').range(start, last)) : noRows,
    supabase.rpc('crm_dashboard_metrics', { p_crm_type: 'online', p_from: from, p_to: to, p_inactivity_days: 90 }),
    supabase.rpc('crm_digital_dashboard', { target_from: from, target_to: to, target_channel: channel || null, target_marketplace: marketplace || null }),
    loadAllQueryRows((start, last) => supabase.from('crm_opportunities').select('id,titolo,valore,probabilita,chiusura_prevista,crm_accounts!inner(id,nome,tipo),crm_opportunity_stages(nome,finale)').eq('crm_accounts.tipo', 'online').order('id').range(start, last)),
    loadAllQueryRows((start, last) => supabase.from('crm_activities').select('id,titolo,stato,tipo,data_attivita,crm_accounts(nome)').eq('crm_tipo', 'online').order('id').range(start, last)),
    loadOnlineMailing(),
  ]);
  for (const response of [orders, lines, identities, prospects, canonical, sources]) if (response.error) throw response.error;
  const identity = new Map(identities.data.map(row => [row.id, row]));
  const accounts = [...canonical.data.map(row => ({ ...row, id: row.crm_account_id || `mexal:${row.codice_cliente}`, entityKey: `mexal:${row.codice_cliente}`, nome: row.ragione_sociale, origine: 'Mexal', mailing: mailing.data.get(row.crm_account_id) || mailing.data.fallback || EMPTY_MAILING })),
    ...prospects.data.map(row => ({ ...row, entityKey: `crm:${row.id}`, nome: customerDisplayName(identity.get(row.id) || row), origine: customerOrigin(identity.get(row.id)), mailing: mailing.data.get(row.id) || mailing.data.fallback || EMPTY_MAILING }))];
  const scoped = new Set([...(sources.data || []).map(row => row.account_id), ...orders.data.map(row => row.account_id)]);
  const marketScoped = new Set(orders.data.map(row => row.account_id));
  return { loadedAt: Date.now(), connections, accounts: accounts.filter(row => (!channel || scoped.has(row.id)) && (!marketplace || marketScoped.has(row.id))), orders: orders.data, lines: lines.data,
    commercial: commercial.error ? null : commercial.data, marketing: marketing.error ? null : marketing.data,
    opportunities: opportunities.error ? null : opportunities.data, activities: activities.error ? null : activities.data,
    warnings: [commercial, marketing, opportunities, activities, mailing].filter(row => row.error).map(row => row.error.message) };
}

export default function DigitalCommercialDashboard({ analytics = false }) {
  const period = useCrmPeriod(); const { hasModuleAccess } = useAuth();
  const [params, setParams] = useSearchParams();
  const channel = params.get('channel') || '', marketplace = params.get('marketplace') || '';
  const [data, setData] = useState(EMPTY), [loading, setLoading] = useState(true), [error, setError] = useState(''), [version, setVersion] = useState(0), [selected, setSelected] = useState(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError(''); setSelected(null);
      readDashboard(period.from, period.to, channel, marketplace).then(next => { if (active) setData(next); }).catch(failure => { if (active) { setError(failure.message); setData(EMPTY); } }).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [period.from, period.to, channel, marketplace, version]);
  const model = useMemo(() => buildDigitalDashboard({ ...data, from: period.from, to: period.to }), [data, period.from, period.to]);
  function filter(key, value) { setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); if (key === 'channel') next.delete('marketplace'); return next; }, { replace: true }); }
  const channels = DIGITAL_CONNECTIONS.filter(row => hasModuleAccess(row.moduleCode));
  const marketplaces = [...new Set([...data.connections.filter(row => !channel || row.tipo === channel).flatMap(row => row.marketplace_ids || []), ...data.orders.map(row => row.marketplace).filter(Boolean)])];
  const active = model.customers.filter(row => row.crm_active !== false);
  const activePeriod = active.filter(row => row.order_count > 0);
  const newly = active.filter(row => row.first_purchase >= period.from && row.first_purchase <= period.to);
  const inactive = active.filter(row => row.days_since == null || row.days_since >= 90);
  const openProjects = data.opportunities?.filter(row => !row.crm_opportunity_stages?.finale);
  const overdueProjects = openProjects?.filter(row => row.chiusura_prevista && row.chiusura_prevista < new Date().toISOString().slice(0, 10));
  const overdueActivities = data.activities?.filter(row => row.stato !== 'completata' && row.data_attivita && Date.parse(row.data_attivita) < data.loadedAt);
  const moneyNote = `${model.amounts.known} ordini con importo · ${model.amounts.missing} senza importo`;
  const card = (label, value, note, info, selection) => <CrmKpiCard key={label} label={label} value={value ?? 'Dato non disponibile'} note={note} info={info} onClick={() => setSelected({ label, info, ...selection })}/>;
  const customers = rows => ({ kind: 'customers', rows });
  const productCard = (label, category, info) => { const rows = model.products.filter(row => row.category === category); return card(label, rows.length, 'Prodotti distinti nel periodo', info, { kind: 'products', rows }); };
  const customerColumn = { key: 'customer', label: 'Cliente', value: row => row.nome, render: row => <CrmCustomerLink crmType="online" customerKey={row.entityKey} name={row.nome} period={period}/> };
  function detail() {
    if (selected.kind === 'orders') return <DigitalSalesDays orders={selected.rows || model.periodOrders} loading={false}/>;
    if (selected.kind === 'customers') return <CrmDetailTable rows={selected.rows} columns={[customerColumn, column('origine', 'Origine'), column('mailing', 'Iscrizione mailing', row => row.mailing?.label || EMPTY_MAILING.label), column('received', 'Mailing ricevute', row => row.mailing?.received == null ? 'Dato non disponibile' : `${row.mailing.received}${row.mailing.partial ? ' (parziale)' : ''}`), { key: 'amount', label: 'Importo acquisti', value: row => displayAmounts(row.amounts) }, column('order_count', 'Ordini nel periodo'), column('history_count', 'Ordini storici'), dateColumn('ultimo_ordine_il', 'Ultimo ordine'), column('average_gap_days', 'Frequenza (giorni)', row => row.average_gap_days == null ? '—' : row.average_gap_days.toLocaleString('it-IT', { maximumFractionDigits: 1 })), dateColumn('expected_reorder_date', 'Riordino previsto')]}/>;
    if (selected.kind === 'products') return <CrmDetailTable rows={selected.rows} columns={[column('name', 'Prodotto'), column('code', 'Codice / ASIN'), column('quantity', 'Quantità', row => `${row.quantity.toLocaleString('it-IT')}${row.unknownQuantity ? ' (parziale)' : ''}`), column('documents', 'Ordini'), column('amount', 'Importo righe', row => displayAmounts(row.amounts)), { key: 'detail', label: 'Dettaglio', value: () => 'Righe ordine', render: row => <details><summary>Righe ordine</summary><CrmDetailTable rows={row.lines} columns={[column('external_id', 'Ordine'), dateColumn('ordered_at', 'Data'), column('marketplace', 'Marketplace', row => marketplaceLabel(row.marketplace)), column('quantity', 'Quantità'), column('line_revenue', 'Importo riga', row => formatPurchaseAmount(row.line_revenue, row.currency))]}/></details> }]}/>;
    if (selected.kind === 'projects') return data.opportunities == null ? <p>Dati progetti non disponibili.</p> : <CrmDetailTable rows={selected.rows} columns={[column('titolo', 'Progetto'), column('cliente', 'Cliente', row => row.crm_accounts?.nome), moneyColumn('valore', 'Valore'), column('probabilita', 'Probabilità %'), dateColumn('chiusura_prevista', 'Chiusura prevista'), { key: 'open', label: 'Dettaglio', value: () => 'Apri progetto', render: row => <Link to={period.withPeriod(`/crm/online/pipeline/${row.id}`)}>Apri progetto</Link> }]}/>;
    if (selected.kind === 'activities') return data.activities == null ? <p>Dati attività non disponibili.</p> : <CrmDetailTable rows={selected.rows} columns={[column('titolo', 'Attività'), column('cliente', 'Cliente', row => row.crm_accounts?.nome), column('tipo', 'Tipo'), dateColumn('data_attivita', 'Scadenza'), column('stato', 'Stato')]}/>;
    return <><p>{selected.info}</p><Link to={period.withPeriod(selected.path, { metric: selected.metric || null })}>Apri dettaglio</Link></>;
  }
  return <div className="crm-page b2b-dashboard-page">
    <CrmPageHeader eyebrow="CRM Online" title={analytics ? 'Analisi Digital' : 'Panoramica Digital'} description="Clienti, vendite e relazione commerciale multicanale">
      <CrmSectionNav items={crmNavigation('online')} period={period} label="Navigazione CRM Online"/>
    </CrmPageHeader>
    <div className="crm-digital-filters"><CrmPeriodFilter period={period} compact/><label>Canale<select value={channel} onChange={event => filter('channel', event.target.value)}><option value="">Tutti gli autorizzati</option>{channels.map(row => <option key={row.type} value={row.type}>{row.label}</option>)}</select></label><label>Marketplace<select value={marketplace} onChange={event => filter('marketplace', event.target.value)}><option value="">Tutti</option>{marketplaces.map(value => <option key={value} value={value}>{marketplaceLabel(value)}</option>)}</select></label><button type="button" className="secondary-action" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw size={16}/>Aggiorna</button></div>
    {error ? <p role="alert" className="crm-message error">{error}</p> : null}
    {data.warnings.length ? <p role="alert" className="crm-message warning">Alcuni indicatori non sono disponibili: {data.warnings.join(' · ')}</p> : null}
    {loading ? <p role="status" className="crm-loading">Caricamento KPI multicanale…</p> : error ? null : <>
      <section className="b2b-kpi-section"><h2>1. Clienti, fatturato e ordini</h2><div className="crm-kpi-grid">
        {card('Clienti totali', model.customers.length, 'Anagrafiche nel perimetro', 'Contatti unici visibili nel CRM, filtrati per fonte quando viene selezionato un canale. Gli acquirenti anonimi non vengono trasformati in anagrafiche.', customers(model.customers))}
        {card('Clienti CRM attivi', active.length, 'Inclusi nelle viste operative', 'Stato attivo del CRM; non indica un acquisto recente.', customers(active))}
        {card('Clienti CRM non attivi', model.customers.length - active.length, 'Storico conservato', 'Contatti con stato CRM non attivo.', customers(model.customers.filter(row => row.crm_active === false)))}
        {card('Clienti attivi nel periodo', activePeriod.length, 'Con acquisti identificati', 'Clienti CRM attivi con almeno un ordine valido importato nel periodo.', customers(activePeriod))}
        {card('Nuovi clienti', newly.length, 'Primo acquisto nello storico importato', 'Prima vendita identificata compresa nel periodo, rispetto allo storico disponibile fino alla data finale.', customers(newly))}
        {card('Fatturato Mexal', channel || marketplace ? 'Non attribuibile al canale' : formatMoney(data.commercial?.invoice_total), 'Fatture del CRM Online', 'Fatture Mexal del CRM Online. Tenute distinte dalle vendite importate per evitare doppi conteggi; non attribuibili ai filtri canale/marketplace.', { kind: 'link', path: '/crm/online/clienti', metric: 'invoiced' })}
        {card('Importo acquisti', displayAmounts(model.amounts), moneyNote, 'Somma nota degli ordini validi, netta IVA, con spedizione, sconti e rimborsi già inclusi. Importi mancanti indicati separatamente. Valute diverse non vengono sommate.', { kind: 'orders', rows: model.sales })}
        {card('Ordini', model.sales.length, `${model.unidentified} senza anagrafica collegata`, 'Tutti gli ordini validi dei canali selezionati, inclusi quelli Amazon senza anagrafica. Esclusi falliti, annullati e in attesa.', { kind: 'orders', rows: model.sales })}
        {card('Valore medio ordine', displayAmounts({ ...model.amounts, totals: model.amounts.totals.map(row => ({ ...row, amount: row.amount / model.sales.filter(order => (order.currency || 'EUR') === row.currency && order.net_revenue != null && Number.isFinite(Number(order.net_revenue))).length })) }), model.amounts.missing ? `Parziale: solo ${model.amounts.known} ordini con importo` : 'Importo / ordini per valuta', 'Media dei soli ordini con importo disponibile. La nota indica il sottoinsieme in caso di dati mancanti; le valute restano separate.', { kind: 'orders', rows: model.sales })}
        {productCard('Prodotti ordinati', 'ordered', 'Prodotti degli ordini validi ancora in lavorazione o da spedire. Quantità sommate anche senza UDM; spedizione esclusa dal conteggio prodotti.')}
        {productCard('Prodotti acquistati', 'purchased', 'Prodotti degli ordini completati, spediti o rimborsati. Quantità importate anche senza UDM; spedizioni escluse. Le quantità rese sono considerate solo se fornite dalla fonte.')}
        {productCard('Prodotti prenotati', 'reserved', 'Prodotti degli ordini in attesa o sospesi, esclusi dal totale acquisti fino alla conferma.')}
        {card('Clienti senza attività nel periodo', inactive.length, 'Nessun acquisto identificato da 90 giorni', 'CRM attivi senza acquisti validi nei 90 giorni precedenti la data finale, sullo storico importato. Non modifica lo stato CRM.', customers(inactive))}
      </div><p className="crm-source-notes">Sito, Amazon e altri marketplace autorizzati. Gli importi mancanti non valgono zero; {model.unidentified} ordini nel periodo non sono attribuibili a un’anagrafica. Prodotti conteggiati dalle righe disponibili, anche senza UDM.</p></section>
      <section className="b2b-kpi-section"><h2>2. Relazione commerciale e riordini</h2><div className="crm-kpi-grid">
        {[['Prospect', row => row.lifecycle === 'prospect'], ['Primo ordine', row => row.history_count === 1], ['Riordini', row => row.history_count > 1], ['A rischio', row => row.lifecycle === 'risk'], ['Dormienti', row => row.lifecycle === 'dormant'], ['Persi', row => row.lifecycle === 'lost']].map(([label, predicate]) => { const rows = active.filter(predicate); return card(label, rows.length, 'Storico fino alla data finale', 'Storico acquisti identificati. Frequenza media tra giorni di acquisto distinti; 90 giorni se assente. Per chi ha più ordini: a rischio tra 1 e 1,5 volte la frequenza, dormiente fino a 2 volte, perso oltre 2 volte. Il primo ordine resta una categoria separata.', customers(rows)); })}
      </div></section>
      <section className="b2b-kpi-section"><h2>3. Attività e progetti</h2><p>Pipeline e attività del CRM Online nel perimetro autorizzato, indipendenti dal filtro canale vendite.</p><div className="crm-kpi-grid">
        {card('Opportunità aperte', openProjects?.length, 'Pipeline Online', 'Progetti in fasi non finali.', { kind: 'projects', rows: openProjects })}
        {card('Valore pipeline', openProjects ? formatMoney(openProjects.reduce((sum, row) => sum + Number(row.valore || 0), 0)) : null, 'Opportunità aperte', 'Somma del valore delle opportunità aperte.', { kind: 'projects', rows: openProjects })}
        {card('Pipeline ponderata', openProjects ? formatMoney(openProjects.reduce((sum, row) => sum + Number(row.valore || 0) * Number(row.probabilita || 0) / 100, 0)) : null, 'Valore × probabilità', 'Valore dei progetti aperti ponderato per probabilità.', { kind: 'projects', rows: openProjects })}
        {card('Progetti scaduti', overdueProjects?.length, 'Chiusura prevista superata', 'Progetti aperti con data di chiusura trascorsa.', { kind: 'projects', rows: overdueProjects })}
        {card('Follow-up scaduti', overdueActivities?.length, 'Attività da completare', 'Attività non completate con scadenza trascorsa.', { kind: 'activities', rows: overdueActivities })}
      </div></section>
      <section className="b2b-kpi-section"><h2>4. Marketing</h2><div className="crm-kpi-grid">
        {card('Spesa marketing', formatMoney(data.marketing?.marketingSpend), 'Dati dei provider ADV', 'Spesa importata nel periodo e per i canali selezionati.', { kind: 'link', path: '/crm/online/adv' })}
        {card('ROAS', data.marketing?.roas == null ? null : `${Number(data.marketing.roas).toLocaleString('it-IT', { maximumFractionDigits: 2 })}×`, 'Ricavi attribuiti / spesa ADV', 'Solo attribuzione pubblicitaria fornita dai provider.', { kind: 'link', path: '/crm/online/adv' })}
      </div></section>
    </>}
    <section className="panel crm-panel"><h3>Stato fonti</h3><div className="crm-connection-grid">{channels.map(definition => { const matches = data.connections.filter(row => row.tipo === definition.type); return <article key={definition.type}><strong>{definition.label}</strong>{matches.length ? matches.map(row => <div key={row.id}><p>{row.nome || row.provider}</p><span className={`crm-data-status ${DATA_STATUS[connectionDataStatus(row)].className}`}>{DATA_STATUS[connectionDataStatus(row)].label}</span><small>{row.ultimo_sync_il ? `Ultimo sync ${new Date(row.ultimo_sync_il).toLocaleString('it-IT')}` : 'Nessuna sincronizzazione disponibile'}</small></div>) : <p>Dato non disponibile</p>}</article>; })}</div></section>
    {selected ? <CrmKpiDialog key={`${selected.label}:${period.from}:${period.to}`} title={selected.label} subtitle={`CRM Online · ${formatDate(period.from)} – ${formatDate(period.to)}`} onClose={() => setSelected(null)}><p>{selected.info}</p>{detail()}</CrmKpiDialog> : null}
  </div>;
}

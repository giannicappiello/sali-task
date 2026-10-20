import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DigitalSalesDays from './DigitalSalesDays';
import { customerPurchases, ordersInPeriod } from './customerPurchaseModel.js';
import { buildDigitalDashboard, displayAmounts } from './digitalDashboardModel.js';
import { EMPTY_MAILING } from './mailingModel.js';
import { customerOrigin } from './customerIdentity';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import WorkspaceProjectCreateDialog from '../../components/WorkspaceProjectCreateDialog';
import WorkspaceTaskDialog from '../../components/WorkspaceTaskDialog';
import { CrmKpiCard, CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import { CrmPageHeader } from './CrmWorkspaceUI';
import CrmPeriodFilter from './CrmPeriodFilter';
import { CrmCustomerStatusBadge } from './CrmCustomerStatus';
import CrmDeleteActivityButton from './CrmDeleteActivityButton';
import { useCustomerProductData } from './useCustomerProductData';
import { groupCustomerProducts, productQuantity } from './customerProducts';
import { loadAllQueryRows } from './crmDataset';
import { crmFunctionError } from './crmFunctionError';
import { crmTypeConfig, formatDate, formatMoney } from './crmConfig';

const col = (key, label, format) => ({ key, label, value: r => format ? format(r[key]) : r[key], sortValue: r => r[key] });
const date = (key, label = 'Data') => col(key, label, formatDate);
const money = (key, label = 'Importo') => col(key, label, v => v == null ? '—' : formatMoney(v));
const inPeriod = (value, period) => value && value.slice(0, 10) >= period.from && value.slice(0, 10) <= period.to;
const take = result => { if (result.error) throw result.error; return result.data || []; };
const docsColumns = [col('number', 'Documento'), date('date'), money('amount'), col('status', 'Stato')];

export default function CrmB2BAccount({ crmType = 'b2b', account, metrics: sourceMetrics, related, commercialSnapshot: sourceSnapshot, journey, period, warning, canWrite, load, onStatus }) {
  const config = crmTypeConfig(crmType);
  const isB2B = crmType === 'b2b'; const isOnline = crmType === 'online';
  const mailing = related.mailing || EMPTY_MAILING;
  const purchase = customerPurchases(related.externalOrders || [], period.from, period.to);
  const lifetime = customerPurchases(related.externalOrders || [], null, period.to);
  const metrics = isOnline ? { ...sourceMetrics, order_period_total: purchase.order_total, order_period_count: purchase.order_count, order_lifetime_total: lifetime.order_total, order_lifetime_count: lifetime.order_count, average_order_value: purchase.average_order_value, last_order_date: lifetime.ultimo_ordine_il } : sourceMetrics;
  const snapshot = isOnline ? { ...sourceSnapshot, orders: { average_days: purchase.average_gap_days, lifetime_count: lifetime.order_count }, b2b: { expected_reorder_date: purchase.expected_reorder_date, classification: 'Storico acquisti importati' } } : sourceSnapshot;
  const onlineProducts = useMemo(() => buildDigitalDashboard({ accounts: [], orders: related.externalOrders || [], lines: related.externalLines || [], from: period.from, to: period.to }).products, [related.externalOrders, related.externalLines, period.from, period.to]);
  const asProductLines = category => onlineProducts.filter(row => row.category === category).flatMap(row => row.lines.map((line, i) => ({ line_id: line.id, document_id: line.order_id, document_number: line.external_id, document_date: line.ordered_at.slice(0,10), document_status: 'Importato', product_code: row.code, description: row.name, quantity: line.quantity, unit: null, net_amount: line.line_revenue, line_position: i })));

  const { hasPermission, hasScreenAccess } = useAuth();
  const [selected, setSelected] = useState(null); const [createProject, setCreateProject] = useState(false); const [revision, setRevision] = useState(0);
  const [actionError, setActionError] = useState('');
  const [taskDialog, setTaskDialog] = useState({ open: false, phase: null });
  const [extra, setExtra] = useState({ loading: true, invoices: [], orders: [], beauty: [], projects: [], tasks: [], errors: {} });
  const key = account.codice_cliente_mexal ? `mexal:${account.codice_cliente_mexal}` : account.entityKey;
  const purchasedDb = useCustomerProductData(isOnline ? null : key, 'purchased', crmType); const orderedDb = useCustomerProductData(isOnline ? null : key, 'ordered', crmType);
  const purchased = isOnline ? { rows: asProductLines('purchased'), loading: false, error: '' } : purchasedDb;
  const ordered = isOnline ? { rows: asProductLines('ordered'), loading: false, error: '' } : orderedDb;
  const boughtProducts = useMemo(() => groupCustomerProducts(purchased.rows, period), [purchased.rows, period]);
  const orderedProducts = useMemo(() => groupCustomerProducts(ordered.rows, period), [ordered.rows, period]);
  useEffect(() => {
    let active = true;
    const code = account.codice_cliente_mexal;
    const timer = setTimeout(async () => {
      setExtra({ loading: true, invoices: [], orders: [], beauty: [], projects: [], tasks: [], errors: {} });
      const requests = {
        invoices: code ? loadAllQueryRows((from, to) => supabase.from('mexal_fatture_vendita').select('id,sigla,serie,numero,data_documento,totale_documento').eq('codice_cliente', code).order('id').range(from, to)).then(take) : Promise.resolve([]),
        orders: code ? loadAllQueryRows((from, to) => supabase.from('ordini_testate').select('id,numero_ordine_visualizzato,data_ordine,totale_documento,stato').eq('codice_cliente', code).order('id').range(from, to)).then(take) : Promise.resolve([]),
        tasks: loadAllQueryRows((from, to) => supabase.from('v4_fasi_progetto').select('*').eq('crm_customer_key', key).eq('crm_tipo', crmType).order('id').range(from, to)).then(take),
        projects: loadAllQueryRows((from, to) => supabase.from('v4_progetti').select('id,titolo,stato,deadline,crm_customer_key').eq('crm_customer_key', key).eq('crm_tipo', crmType).order('id').range(from, to)).then(take),
        beauty: (async () => {
          if (!code || !isB2B) return [];
          const settings = await supabase.from('crm_workflow_settings').select('beauty_post_evento_giorni').eq('crm_tipo', crmType).maybeSingle();
          if (settings.error) throw settings.error;
          const result = await supabase.functions.invoke('report-giornate-api', { body: { action: 'crm-beauty-customer', customerCode: code, postDays: settings.data?.beauty_post_evento_giorni || 30 } });
          if (result.error) throw await crmFunctionError(result.error);
          if (result.data?.error) throw new Error(result.data.error);
          return result.data?.events || [];
        })(),
      };
      const results = await Promise.allSettled(Object.values(requests));
      if (!active) return;
      const next = { loading: false, errors: {} };
      Object.keys(requests).forEach((name, i) => { next[name] = results[i].status === 'fulfilled' ? results[i].value : []; if (results[i].status === 'rejected') next.errors[name] = results[i].reason?.message || 'Dati non disponibili'; });
      setExtra(next);
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [account.codice_cliente_mexal, key, revision, crmType, isB2B]);
  const invoices = extra.invoices.map(r => ({ id: r.id, number: `${r.sigla} ${r.serie}/${r.numero}`, date: r.data_documento, amount: Number(r.totale_documento || 0), status: 'Sincronizzata' }));
  const orders = isOnline ? (related.externalOrders || []).map(r => ({ id:r.id,number:r.external_id,date:r.ordered_at.slice(0,10),amount:r.net_revenue,status:r.stato })) : extra.orders.map(r => ({ id: r.id, number: r.numero_ordine_visualizzato || 'Numero non disponibile', date: r.data_ordine, amount: Number(r.totale_documento || 0), status: r.stato }));
  const crmActivityIds = new Set(related.activities.map(r => r.id));
  const workspaceTasks = (extra.tasks || []).filter(r => !r.crm_activity_id || !crmActivityIds.has(r.crm_activity_id));
  const activityRows = [...related.activities.map(r => ({ ...r, type: r.checklist_template?.titolo || r.tipo?.replaceAll('_', ' ') })), ...workspaceTasks.map(r => ({ ...r, workspacePhase: r, type: r.titolo, data_attivita: r.deadline, stato: r.completato_at || ['evaso','evasa','completato','completata','chiuso','chiusa'].includes(String(r.stato || '').toLowerCase()) ? 'completata' : r.stato }))];
  const customerJourney = [...journey, ...workspaceTasks.map(r => ({ event_type: 'task', entity_id: r.id, event_at: r.created_at, title: r.titolo, detail: r.stato }))];
  const quantityLabel = products => `${productQuantity(products.flatMap(p => p.lines)).toLocaleString('it-IT')} quantità totale`;
  const latestDate = [metrics.last_invoice_date, metrics.last_order_date].filter(Boolean).sort().at(-1);
  const card = (id, label, value, note, info) => <CrmKpiCard key={id} label={label} value={value} note={note} info={info} onClick={() => setSelected({ id, label })}/>;
  const number = value => value == null ? '—' : Number(value).toLocaleString('it-IT');
  const productValue = (data, products) => data.loading ? '…' : data.error ? '—' : products.length;
  const operational = [
    isB2B && card('beauty', 'Beauty Days', extra.loading ? '…' : extra.errors.beauty ? '—' : extra.beauty.length, 'Appuntamenti e storico del cliente', 'Giornate Beauty Days collegate all’anagrafica del cliente. Il popup comprende stato, consulente, pezzi, fatturato e impatto successivo.'),
    card('activities', 'Attività', activityRows.length, `${activityRows.filter(r => r.stato !== 'completata').length} aperte · ${activityRows.filter(r => r.stato === 'completata').length} completate`, `Tutte le attività CRM del cliente. Le nuove attività provengono dalle checklist abilitate per ${config.label}.`),
    isOnline && card('mailing-status', 'Iscrizione mailing', mailing.label, 'Stato per audience Mailchimp', 'Ultimo consenso disponibile per ogni audience; una disiscrizione non viene sostituita da un’iscrizione precedente.'),
    isOnline && card('mailing-received', 'Mailing ricevute', mailing.received == null ? 'Dato non disponibile' : mailing.received, mailing.partial ? 'Storico importato parziale' : 'Storico report Mailchimp completo', 'Campagne distinte con esito sent nel report destinatari Mailchimp. I messaggi respinti sono esclusi; invio riuscito non certifica la lettura.'),
    !isB2B && !isOnline && card('samples', 'Campioni', related.activities.filter(r => ['campionatura', 'invio_campioni'].includes(r.tipo)).length, 'Attività di campionatura', 'Campionature e invii campioni registrati per questo cliente.'),
    !isB2B && !isOnline && card('quotes', 'Preventivi', related.activities.filter(r => r.tipo === 'preventivo').length, 'Attività di preventivazione', 'Preventivi registrati nelle attività del cliente.'),
    card('timeline', 'Timeline cliente', customerJourney.length, 'Eventi dello storico CRM', 'Eventi unificati del cliente, con data, tipologia e dettaglio, nel perimetro autorizzato.'),
    card('projects', 'Progetti', extra.loading ? '…' : extra.errors.projects ? '—' : extra.projects.length, 'Progetti Workspace collegati', 'Progetti Workspace associati a questo cliente. Le opportunità commerciali sono nella card Opportunità aperte.'),
    card('contacts', 'Contatti CRM', related.contacts.length, 'Referenti del cliente', 'Contatti collegati al cliente: nome, ruolo, email, telefono e referente principale.'),
    card('briefs', 'Brief', related.briefs.length, 'Brief collegati al cliente', 'Brief del cliente con titolo, stato e data di aggiornamento.'),
    card('notes', 'Note e documenti', account.metadati?.note ? '1 nota' : '—', 'Note cliente e documenti collegati', 'Note disponibili nella scheda. I documenti restano nella libreria Workspace e richiedono un collegamento autorizzato; un conteggio non disponibile non viene stimato.'),
    card('ai', 'Sintesi AI', 'Su richiesta', 'AI Business Assistant', 'Sintesi generata solo su richiesta, utilizzando i dati autorizzati del cliente.'),
  ];
  function detail() {
    const id = selected.id;
    let rows = []; let columns = []; let error = ''; let loading = false;
    if (id === 'mailing-status') {
      rows = mailing.audiences; columns = [col('source','Audience'),col('status','Stato'),date('captured_at','Consenso'),date('withdrawn_at','Disiscrizione')];
    } else if (id === 'mailing-received') {
      rows = mailing.deliveries; columns = [col('title','Campagna'),date('sent_at','Data invio'),col('delivery_status','Esito')];
    } else if (isOnline && ['order-period','order-lifetime','average','latest','frequency','reorder'].includes(id)) {
      return <DigitalSalesDays orders={id === 'order-period' || id === 'average' ? ordersInPeriod(related.externalOrders || [],period.from,period.to) : related.externalOrders || []} loading={false}/>;
    } else if (id.startsWith('invoice') || id.startsWith('order-') || id === 'average' || id === 'latest' || id === 'frequency' || id === 'reorder') {
      const isInvoice = id.startsWith('invoice') || id === 'latest' && latestDate === metrics.last_invoice_date;
      rows = isInvoice ? invoices : orders; columns = docsColumns; error = extra.errors[isInvoice ? 'invoices' : 'orders']; loading = extra.loading;
      if (id.endsWith('period') || id === 'average') rows = rows.filter(r => inPeriod(r.date, period));
      if (id === 'latest') rows = rows.filter(r => r.date === latestDate);
    } else if (id === 'purchased' || id === 'ordered-products') {
      const kind = id === 'purchased' ? 'purchased' : 'ordered';
      if (!isOnline && !hasScreenAccess(kind === 'purchased' ? 'crm.prodotti_acquistati' : 'crm.prodotti_ordinati')) return <p>Schermata prodotti non autorizzata per il tuo profilo.</p>;
      const data = kind === 'purchased' ? purchased : ordered; loading = data.loading; error = data.error;
      rows = kind === 'purchased' ? boughtProducts : orderedProducts;
      columns = [col('description', 'Prodotto'), col('code', 'Codice'), { key: 'quantity', label: 'Quantità', value: r => Number(r.quantity).toLocaleString('it-IT'), sortValue: r => r.quantity }, col('documents', 'Documenti'), { key: 'amount', label: 'Importo netto', value: r => `${formatMoney(r.amount.value)}${r.amount.unknown ? ' (parziale)' : ''}`, sortValue: r => r.amount.value }, { key: 'history', label: 'Dettaglio', value: () => 'Apri righe', render: r => <details><summary>Righe documento</summary><CrmDetailTable rows={r.lines} columns={[col('document_number', 'Documento'), date('document_date'), col('description', 'Prodotto'), col('quantity', 'Quantità'), col('unit', 'UM'), money('net_amount', 'Importo netto'), col('document_status', 'Stato')]}/></details> }];
    } else if (id === 'beauty') {
      rows = extra.beauty.map(r => ({ ...r, invoice_count: r.impact?.invoice_count, invoice_value: r.impact?.invoice_value, order_count: r.impact?.order_count, order_value: r.impact?.order_value })); error = extra.errors.beauty; loading = extra.loading;
      columns = [date('data'), col('stato', 'Stato'), col('consultant_name', 'Consulente'), col('numero_totale_pezzi_venduti', 'Pezzi'), money('fatturato_giornata', 'Fatturato giornata'), col('invoice_count', 'Fatture successive'), money('invoice_value', 'Fatturato successivo'), col('order_count', 'Ordini successivi'), money('order_value', 'Ordinato successivo')];
    } else if (id === 'activities' || id === 'overdue' || id === 'samples' || id === 'quotes') {
      rows = activityRows.filter(r => id === 'samples' ? ['campionatura', 'invio_campioni'].includes(r.tipo) : id === 'quotes' ? r.tipo === 'preventivo' : id !== 'overdue' || r.stato !== 'completata' && r.data_attivita && new Date(r.data_attivita) < new Date());
      columns = [col('titolo', 'Attività'), col('type', 'Voce checklist'), date('data_attivita'), col('stato', 'Stato'), { key: 'actions', label: 'Azioni', value: () => '', render: r => r.workspacePhase ? <button type="button" className="secondary-action" onClick={() => { setSelected(null); setTaskDialog({ open: true, phase: r.workspacePhase }); }}>Apri task</button> : <CrmDeleteActivityButton activity={r} canDelete={canWrite} onDeleted={load} onError={setActionError} compact/> }];
    } else if (id === 'timeline') { rows = customerJourney.map((r, i) => ({ ...r, id: `${r.event_type}-${r.entity_id}-${i}` })); columns = [date('event_at'), col('title', 'Evento'), col('event_type', 'Tipo'), col('detail', 'Dettaglio')];
    } else if (id === 'projects') { rows = extra.projects; error = extra.errors.projects; loading = extra.loading; columns = [col('titolo', 'Progetto'), col('stato', 'Stato'), date('deadline', 'Scadenza'), { key: 'open', label: 'Dettaglio', value: () => 'Apri progetto', render: r => <Link to={`/projects?project=${r.id}`}>Apri progetto</Link> }];
    } else if (id === 'opportunities' || id === 'weighted') { rows = related.opportunities.filter(r => !r.crm_opportunity_stages?.finale); columns = [col('titolo', 'Opportunità'), { key: 'stage', label: 'Fase', value: r => r.crm_opportunity_stages?.nome }, money('valore', 'Valore'), col('probabilita', 'Probabilità %'), { key: 'open', label: 'Dettaglio', value: () => 'Apri opportunità', render: r => <Link to={period.withPeriod(`${config.basePath}/pipeline/${r.id}`)}>Apri opportunità</Link> }];
    } else if (id === 'contacts') { rows = related.contacts; columns = [col('nome', 'Nome'), col('cognome', 'Cognome'), col('ruolo', 'Ruolo'), col('email', 'Email'), col('telefono', 'Telefono'), col('principale', 'Principale', v => v ? 'Sì' : 'No')];
    } else if (id === 'briefs') { rows = related.briefs; columns = [col('titolo', 'Titolo'), col('stato', 'Stato'), date('aggiornato_il', 'Aggiornato')];
    } else if (id === 'notes') { return <><h3>Note cliente</h3><p>{account.metadati?.note || 'Nessuna nota disponibile.'}</p><h3>Documenti</h3><p>I documenti restano nella libreria Workspace. Nessun elenco di documenti collegati è disponibile da questa scheda.</p></>;
    } else if (id === 'ai') { return <><p>La sintesi viene generata su richiesta nel perimetro autorizzato.</p><Link className="secondary-action" to="/crm/ai" state={{ accountId: account.crm_account_id, customerCode: account.codice_cliente_mexal, crmType }}>Apri AI Brief</Link></>;
    } else if (id === 'account') {
      rows = Object.entries({ 'Nome': account.metadati?.anagrafica?.nome, 'Cognome': account.metadati?.anagrafica?.cognome, 'Origine': customerOrigin(account), 'Ragione sociale': account.metadati?.anagrafica?.azienda || account.nome, 'PEC': account.metadati?.anagrafica?.pec, 'Codice univoco': account.metadati?.anagrafica?.codice_univoco, 'Codice fiscale': account.codice_fiscale, 'Codice cliente': account.codice_cliente_mexal, 'Stato CRM': account.crm_active ? 'Attivo' : 'Non attivo', 'Stato relazione': account.stato, 'Agente': account.agente_nome, 'Area CRM': config.label, 'Classificazione': [account.origine_classificazione, account.modalita_classificazione].filter(Boolean).join(' · '), 'Partita IVA': account.partita_iva, 'Paese / nazionalità': account.paese, 'Email': account.email, 'Telefono': account.telefono, 'Indirizzo': [account.indirizzo, account.cap, account.citta, account.provincia].filter(Boolean).join(' · '), 'Indirizzo di spedizione': [account.metadati?.anagrafica?.spedizione?.address_1,account.metadati?.anagrafica?.spedizione?.postcode,account.metadati?.anagrafica?.spedizione?.city,account.metadati?.anagrafica?.spedizione?.state].filter(Boolean).join(' · '), 'Valore CRM': formatMoney(account.valore_cliente) }).map(([name, value]) => ({ id: name, name, value: value || '—' })); columns = [col('name', 'Campo'), col('value', 'Valore')];
    }
    return <>{(id === 'activities' || id === 'overdue') && canWrite && <button type="button" className="primary-action" onClick={() => { setSelected(null); setTaskDialog({ open: true, phase: null }); }}>+ Nuova attività</button>}{loading ? <p role="status">Caricamento dettagli…</p> : error ? <p role="alert">{error}</p> : <CrmDetailTable rows={rows} columns={columns}/>}</>;
  }
  return <div className="crm-page b2b-account-page">
    <CrmPageHeader eyebrow={`CRM ${config.label}`} title={account.nome} description={[account.citta, account.agente_nome].filter(Boolean).join(' · ')} actions={<><CrmPeriodFilter period={period} compact/><Link className="secondary-action" to={period.withPeriod(`${config.basePath}/clienti`)}>Torna ai clienti</Link></>}><CrmCustomerStatusBadge active={account.crm_active}/></CrmPageHeader>
    {warning && <p className="crm-message warning">{warning}</p>}
    <div className="b2b-account-actions"><button className="secondary-action" onClick={() => setSelected({ id: 'account', label: 'Anagrafica cliente' })}>Anagrafica</button>{canWrite && <><button className="primary-action" onClick={() => setTaskDialog({ open: true, phase: null })}>+ Attività</button>{hasPermission('projects.write') && <button className="secondary-action" onClick={() => setCreateProject(true)}>+ Progetto</button>}<button className="secondary-action" onClick={onStatus}>{account.crm_active ? 'Disattiva cliente' : 'Riattiva cliente'}</button></>}</div>
    <section className="b2b-kpi-section"><h2>1. Fatturato, ordini e prodotti</h2><div className="crm-kpi-grid">
      {card('invoice-period', 'Fatturato nel periodo', formatMoney(metrics.invoice_period_total), `${number(metrics.invoice_period_count)} fatture emesse`, 'Somma del totale dei documenti di fatturazione del cliente nel periodo selezionato. Il numero indica i documenti registrati nella stessa fonte.')}
      {card('invoice-lifetime', 'Fatturato lifetime', formatMoney(metrics.invoice_lifetime_total), `${number(metrics.invoice_lifetime_count)} fatture emesse`, 'Totale e numero dei documenti di fatturazione dall’inizio dello storico disponibile.')}
      {card('order-period', isOnline ? 'Acquisti nel periodo' : 'Ordinato nel periodo', isOnline ? displayAmounts({ totals: purchase.order_total == null ? [] : [{amount:purchase.order_total,currency:purchase.currency}], missing:purchase.order_total == null ? 1 : 0 }) : formatMoney(metrics.order_period_total), `${number(metrics.order_period_count)} ordini effettuati`, isOnline ? 'Ordini validi importati da sito e marketplace: importi netti IVA, spedizione inclusa, sconti e rimborsi considerati. Gli importi sconosciuti restano non disponibili.' : 'Totale e numero degli ordini del cliente nel periodo selezionato, secondo la fonte Workspace/Mexal già utilizzata.')}
      {card('order-lifetime', isOnline ? 'Acquisti lifetime' : 'Ordinato lifetime', isOnline ? displayAmounts({ totals: lifetime.order_total == null ? [] : [{amount:lifetime.order_total,currency:lifetime.currency}], missing:lifetime.order_total == null ? 1 : 0 }) : formatMoney(metrics.order_lifetime_total), `${number(metrics.order_lifetime_count)} ordini effettuati`, 'Totale e numero degli ordini del cliente nell’intero storico disponibile.')}
      {card('average', 'Valore medio ordine', formatMoney(metrics.average_order_value), `Su ${number(metrics.order_period_count)} ordini`, 'Ordinato nel periodo diviso per il numero di ordini nello stesso periodo.')}
      {card('latest', 'Ultimo documento', formatDate(latestDate), 'Documento più recente', 'Data più recente tra fatture e ordini disponibili del cliente.')}
      {card('purchased', 'Prodotti acquistati', productValue(purchased, boughtProducts), quantityLabel(boughtProducts) || 'Prodotti distinti fatturati nel periodo', isOnline ? 'Prodotti degli ordini completati e spediti importati, con quantità anche senza UDM. Spedizioni escluse dal conteggio prodotti.' : 'Articoli distinti presenti nelle righe delle fatture del periodo. Quantità totali delle righe, importi netti e note di credito mantenuti.')}
      {card('ordered-products', 'Prodotti ordinati', productValue(ordered, orderedProducts), quantityLabel(orderedProducts) || 'Prodotti distinti negli ordini del periodo', 'Articoli distinti presenti nelle righe degli ordini del periodo. Quantità totali delle righe; ordini annullati esclusi dai totali monetari.')}
    </div></section>
    <section className="b2b-kpi-section"><h2>2. Relazione commerciale e riordini</h2><div className="crm-kpi-grid">
      {card('opportunities', 'Opportunità aperte', number(snapshot.opportunities?.open_count), formatMoney(snapshot.opportunities?.pipeline_value), 'Opportunità commerciali aperte del cliente e relativo valore.')}
      {card('weighted', 'Valore ponderato', formatMoney(snapshot.opportunities?.weighted_value), 'Pipeline del cliente', 'Somma del valore delle opportunità moltiplicato per la probabilità di chiusura.')}
      {card('overdue', 'Follow-up scaduti', number(snapshot.activities?.overdue_count), snapshot.activities?.next_at ? `Prossimo ${formatDate(snapshot.activities.next_at)}` : 'Prossimo passo mancante', 'Attività non completate la cui scadenza è già trascorsa.')}
      {card('frequency', 'Frequenza media ordini', snapshot.orders?.average_days ? `${snapshot.orders.average_days} gg` : '—', `${number(snapshot.orders?.lifetime_count)} ordini storici`, 'Intervallo medio storico tra gli ordini del cliente, secondo il calcolo CRM esistente.')}
      {(isB2B || isOnline) && card('reorder', 'Prossimo riordino atteso', formatDate(snapshot.b2b?.expected_reorder_date), snapshot.b2b?.classification?.replaceAll('_', ' ') || 'Prospect', 'Data attesa del prossimo riordino stimata dalla frequenza storica individuale.')}
    </div></section>
    <section className="b2b-kpi-section"><h2>3. Attività, timeline, progetti e CRM</h2><div className="crm-kpi-grid">{operational}</div></section>
    {selected && <CrmKpiDialog key={`${key}-${selected.id}`} title={selected.label} subtitle={`${account.nome} · ${selected.id.endsWith('lifetime') || ['beauty','frequency','reorder','activities','timeline','projects','contacts','briefs','account','opportunities','weighted','overdue','notes','ai'].includes(selected.id) ? 'Storico e situazione corrente' : `${formatDate(period.from)} – ${formatDate(period.to)}`}`} onClose={() => { setSelected(null); setActionError(''); }}>{actionError && <p role="alert">{actionError}</p>}{detail()}</CrmKpiDialog>}
    <WorkspaceTaskDialog open={taskDialog.open} phase={taskDialog.phase} crmType={crmType} initialCustomerKey={key} canManage={canWrite} onClose={() => setTaskDialog({ open: false, phase: null })} onSaved={() => { setRevision(v => v + 1); load(); }}/>
    <WorkspaceProjectCreateDialog open={createProject} crmType={crmType} initialCustomerKey={key} onClose={() => setCreateProject(false)} onSaved={() => { setCreateProject(false); setRevision(v => v + 1); load(); }}/>
  </div>;
}


import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { groupCustomerProducts, productQuantities } from './customerProducts';
import { loadAllQueryRows } from './crmDataset';
import { crmFunctionError } from './crmFunctionError';
import { crmTypeConfig, formatDate, formatMoney } from './crmConfig';

const col = (key, label, format) => ({ key, label, value: r => format ? format(r[key]) : r[key], sortValue: r => r[key] });
const date = (key, label = 'Data') => col(key, label, formatDate);
const money = (key, label = 'Importo') => col(key, label, v => v == null ? '—' : formatMoney(v));
const inPeriod = (value, period) => value && value.slice(0, 10) >= period.from && value.slice(0, 10) <= period.to;
const take = result => { if (result.error) throw result.error; return result.data || []; };
const docsColumns = [col('number', 'Documento'), date('date'), money('amount'), col('status', 'Stato')];

export default function CrmB2BAccount({ crmType = 'b2b', account, metrics, related, commercialSnapshot: snapshot, journey, period, warning, canWrite, load, onStatus }) {
  const config = crmTypeConfig(crmType);
  const isB2B = crmType === 'b2b';
  const { hasPermission, hasScreenAccess } = useAuth();
  const [selected, setSelected] = useState(null); const [createProject, setCreateProject] = useState(false); const [revision, setRevision] = useState(0);
  const [actionError, setActionError] = useState('');
  const [taskDialog, setTaskDialog] = useState({ open: false, phase: null });
  const [extra, setExtra] = useState({ loading: true, invoices: [], orders: [], beauty: [], projects: [], tasks: [], errors: {} });
  const key = account.codice_cliente_mexal ? `mexal:${account.codice_cliente_mexal}` : account.entityKey;
  const purchased = useCustomerProductData(key, 'purchased', crmType); const ordered = useCustomerProductData(key, 'ordered', crmType);
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
  const orders = extra.orders.map(r => ({ id: r.id, number: r.numero_ordine_visualizzato || 'Numero non disponibile', date: r.data_ordine, amount: Number(r.totale_documento || 0), status: r.stato }));
  const crmActivityIds = new Set(related.activities.map(r => r.id));
  const workspaceTasks = (extra.tasks || []).filter(r => !r.crm_activity_id || !crmActivityIds.has(r.crm_activity_id));
  const activityRows = [...related.activities.map(r => ({ ...r, type: r.checklist_template?.titolo || r.tipo?.replaceAll('_', ' ') })), ...workspaceTasks.map(r => ({ ...r, workspacePhase: r, type: r.titolo, data_attivita: r.deadline, stato: r.completato_at || ['evaso','evasa','completato','completata','chiuso','chiusa'].includes(String(r.stato || '').toLowerCase()) ? 'completata' : r.stato }))];
  const customerJourney = [...journey, ...workspaceTasks.map(r => ({ event_type: 'task', entity_id: r.id, event_at: r.created_at, title: r.titolo, detail: r.stato }))];
  const quantityLabel = products => productQuantities(products.flatMap(p => p.lines)).map(q => `${Number(q.quantity).toLocaleString('it-IT')} ${q.unit}`).join(' · ');
  const latestDate = [metrics.last_invoice_date, metrics.last_order_date].filter(Boolean).sort().at(-1);
  const card = (id, label, value, note, info) => <CrmKpiCard key={id} label={label} value={value} note={note} info={info} onClick={() => setSelected({ id, label })}/>;
  const number = value => value == null ? '—' : Number(value).toLocaleString('it-IT');
  const productValue = (data, products) => data.loading ? '…' : data.error ? '—' : products.length;
  const operational = [
    isB2B && card('beauty', 'Beauty Days', extra.loading ? '…' : extra.errors.beauty ? '—' : extra.beauty.length, 'Appuntamenti e storico del cliente', 'Giornate Beauty Days collegate all’anagrafica del cliente. Il popup comprende stato, consulente, pezzi, fatturato e impatto successivo.'),
    card('activities', 'Attività', activityRows.length, `${activityRows.filter(r => r.stato !== 'completata').length} aperte · ${activityRows.filter(r => r.stato === 'completata').length} completate`, `Tutte le attività CRM del cliente. Le nuove attività provengono dalle checklist abilitate per ${config.label}.`),
    !isB2B && card('samples', 'Campioni', related.activities.filter(r => ['campionatura', 'invio_campioni'].includes(r.tipo)).length, 'Attività di campionatura', 'Campionature e invii campioni registrati per questo cliente.'),
    !isB2B && card('quotes', 'Preventivi', related.activities.filter(r => r.tipo === 'preventivo').length, 'Attività di preventivazione', 'Preventivi registrati nelle attività del cliente.'),
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
    if (id.startsWith('invoice') || id.startsWith('order-') || id === 'average' || id === 'latest' || id === 'frequency' || id === 'reorder') {
      const isInvoice = id.startsWith('invoice') || id === 'latest' && latestDate === metrics.last_invoice_date;
      rows = isInvoice ? invoices : orders; columns = docsColumns; error = extra.errors[isInvoice ? 'invoices' : 'orders']; loading = extra.loading;
      if (id.endsWith('period') || id === 'average') rows = rows.filter(r => inPeriod(r.date, period));
      if (id === 'latest') rows = rows.filter(r => r.date === latestDate);
    } else if (id === 'purchased' || id === 'ordered-products') {
      const kind = id === 'purchased' ? 'purchased' : 'ordered';
      if (!hasScreenAccess(kind === 'purchased' ? 'crm.prodotti_acquistati' : 'crm.prodotti_ordinati')) return <p>Schermata prodotti non autorizzata per il tuo profilo.</p>;
      const data = kind === 'purchased' ? purchased : ordered; loading = data.loading; error = data.error;
      rows = kind === 'purchased' ? boughtProducts : orderedProducts;
      columns = [col('description', 'Prodotto'), col('code', 'Codice'), { key: 'quantity', label: 'Quantità / UM', value: r => r.quantities.map(q => `${q.quantity} ${q.unit}`).join(' · ') }, col('documents', 'Documenti'), { key: 'amount', label: 'Importo netto', value: r => `${formatMoney(r.amount.value)}${r.amount.unknown ? ' (parziale)' : ''}`, sortValue: r => r.amount.value }, { key: 'history', label: 'Dettaglio', value: () => 'Apri righe', render: r => <details><summary>Righe documento</summary><CrmDetailTable rows={r.lines} columns={[col('document_number', 'Documento'), date('document_date'), col('description', 'Prodotto'), col('quantity', 'Quantità'), col('unit', 'UM'), money('net_amount', 'Importo netto'), col('document_status', 'Stato')]}/></details> }];
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
      rows = Object.entries({ 'Ragione sociale': account.nome, 'Codice cliente': account.codice_cliente_mexal, 'Stato CRM': account.crm_active ? 'Attivo' : 'Non attivo', 'Stato relazione': account.stato, 'Agente': account.agente_nome, 'Area CRM': config.label, 'Classificazione': [account.origine_classificazione, account.modalita_classificazione].filter(Boolean).join(' · '), 'Partita IVA': account.partita_iva, 'Paese / nazionalità': account.paese, 'Email': account.email, 'Telefono': account.telefono, 'Indirizzo': [account.indirizzo, account.cap, account.citta, account.provincia].filter(Boolean).join(' · '), 'Valore CRM': formatMoney(account.valore_cliente) }).map(([name, value]) => ({ id: name, name, value: value || '—' })); columns = [col('name', 'Campo'), col('value', 'Valore')];
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
      {card('order-period', 'Ordinato nel periodo', formatMoney(metrics.order_period_total), `${number(metrics.order_period_count)} ordini effettuati`, 'Totale e numero degli ordini del cliente nel periodo selezionato, secondo la fonte Workspace/Mexal già utilizzata.')}
      {card('order-lifetime', 'Ordinato lifetime', formatMoney(metrics.order_lifetime_total), `${number(metrics.order_lifetime_count)} ordini effettuati`, 'Totale e numero degli ordini del cliente nell’intero storico disponibile.')}
      {card('average', 'Valore medio ordine', formatMoney(metrics.average_order_value), `Su ${number(metrics.order_period_count)} ordini`, 'Ordinato nel periodo diviso per il numero di ordini nello stesso periodo.')}
      {card('latest', 'Ultimo documento', formatDate(latestDate), 'Documento più recente', 'Data più recente tra fatture e ordini disponibili del cliente.')}
      {card('purchased', 'Prodotti acquistati', productValue(purchased, boughtProducts), quantityLabel(boughtProducts) || 'Prodotti distinti fatturati nel periodo', 'Articoli distinti presenti nelle righe delle fatture del periodo. Quantità separate per unità di misura, importi netti e note di credito mantenuti.')}
      {card('ordered-products', 'Prodotti ordinati', productValue(ordered, orderedProducts), quantityLabel(orderedProducts) || 'Prodotti distinti negli ordini del periodo', 'Articoli distinti presenti nelle righe degli ordini del periodo. Quantità separate per unità di misura; ordini annullati esclusi dai totali monetari.')}
    </div></section>
    <section className="b2b-kpi-section"><h2>2. Relazione commerciale e riordini</h2><div className="crm-kpi-grid">
      {card('opportunities', 'Opportunità aperte', number(snapshot.opportunities?.open_count), formatMoney(snapshot.opportunities?.pipeline_value), 'Opportunità commerciali aperte del cliente e relativo valore.')}
      {card('weighted', 'Valore ponderato', formatMoney(snapshot.opportunities?.weighted_value), 'Pipeline del cliente', 'Somma del valore delle opportunità moltiplicato per la probabilità di chiusura.')}
      {card('overdue', 'Follow-up scaduti', number(snapshot.activities?.overdue_count), snapshot.activities?.next_at ? `Prossimo ${formatDate(snapshot.activities.next_at)}` : 'Prossimo passo mancante', 'Attività non completate la cui scadenza è già trascorsa.')}
      {card('frequency', 'Frequenza media ordini', snapshot.orders?.average_days ? `${snapshot.orders.average_days} gg` : '—', `${number(snapshot.orders?.lifetime_count)} ordini storici`, 'Intervallo medio storico tra gli ordini del cliente, secondo il calcolo CRM esistente.')}
      {isB2B && card('reorder', 'Prossimo riordino atteso', formatDate(snapshot.b2b?.expected_reorder_date), snapshot.b2b?.classification?.replaceAll('_', ' ') || 'Prospect', 'Data attesa del prossimo riordino stimata dalla frequenza storica individuale.')}
    </div></section>
    <section className="b2b-kpi-section"><h2>3. Attività, timeline, progetti e CRM</h2><div className="crm-kpi-grid">{operational}</div></section>
    {selected && <CrmKpiDialog key={`${key}-${selected.id}`} title={selected.label} subtitle={`${account.nome} · ${selected.id.endsWith('lifetime') || ['beauty','frequency','reorder','activities','timeline','projects','contacts','briefs','account','opportunities','weighted','overdue','notes','ai'].includes(selected.id) ? 'Storico e situazione corrente' : `${formatDate(period.from)} – ${formatDate(period.to)}`}`} onClose={() => { setSelected(null); setActionError(''); }}>{actionError && <p role="alert">{actionError}</p>}{detail()}</CrmKpiDialog>}
    <WorkspaceTaskDialog open={taskDialog.open} phase={taskDialog.phase} crmType={crmType} initialCustomerKey={key} canManage={canWrite} onClose={() => setTaskDialog({ open: false, phase: null })} onSaved={() => { setRevision(v => v + 1); load(); }}/>
    <WorkspaceProjectCreateDialog open={createProject} crmType={crmType} initialCustomerKey={key} onClose={() => setCreateProject(false)} onSaved={() => { setCreateProject(false); setRevision(v => v + 1); load(); }}/>
  </div>;
}


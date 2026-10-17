import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { CrmPageHeader, CrmSectionNav } from '../CrmWorkspaceUI';
import CrmPeriodFilter, { useCrmPeriod } from '../CrmPeriodFilter';
import InfoTooltip from '../../../components/InfoTooltip';
import { useAuth } from '../../../contexts/AuthContext';
import { formatMoney } from '../crmConfig';
import { CLUB_NAVIGATION, CLUB_PATH, CLUB_SCREENS } from './clubModel';
import useClubRpc from './useClubRpc';
import ClubRequests from './ClubRequests';
import ClubConfiguration from './ClubConfiguration';
import ClubRewards from './ClubRewards';
import ClubMembers from './ClubMembers';
import './club.css';

function ClubDashboard() {
  const period = useCrmPeriod();
  const { hasScreenAccess } = useAuth();
  const { data, loading, error, reload } = useClubRpc('club_admin_dashboard', { date_from: period.from, date_to: period.to });
  const kpi = (label, key, money = false, note = '', path = '') => {
    const value = loading ? '…' : data ? money ? formatMoney(data[key]) : Number(data[key] || 0).toLocaleString('it-IT') : '—';
    const content = <><span>{label}<InfoTooltip label={label} text={note} /></span><strong>{value}</strong><small>{note}</small>{path && <em>Apri dettaglio →</em>}</>;
    return path ? <Link className="kpi-card crm-kpi" to={path} aria-label={`${label}: ${value}. Apri dettaglio`}>{content}</Link> : <article className="kpi-card crm-kpi">{content}</article>;
  };
  const requestsAllowed = hasScreenAccess(CLUB_SCREENS.requests, 'crm_online');
  return <>
    <div className="crm-toolbar"><CrmPeriodFilter period={period} compact /><button type="button" className="secondary-action crm-secondary" disabled={loading} onClick={reload}><RefreshCw size={16} />Aggiorna</button></div>
    {error && <div role="alert" className="crm-message error">{error}</div>}
    <div className="crm-kpi-grid">
      {kpi('Richieste da approvare', 'pending_requests', false, 'Tutte le richieste in attesa, indipendentemente dal periodo.', requestsAllowed ? `${CLUB_PATH}/richieste?stato=pending` : '')}
      {kpi('Richieste in lavorazione', 'processing_requests', false, 'Richieste approvate, pronte al ritiro o spedite.', requestsAllowed ? `${CLUB_PATH}/richieste?stato=processing` : '')}
      {kpi('Iscritti al Club', 'members', false, 'Totale iscritti al programma.')}
      {kpi('Nuovi iscritti', 'new_members', false, 'Iscrizioni nel periodo selezionato.')}
      {kpi('Acquisti registrati', 'sales', true, 'Spesa confermata nel periodo; acquisti stornati esclusi.')}
      {kpi('Cashback maturato', 'cashback_earned', true, 'Cashback sugli acquisti confermati nel periodo.')}
      {kpi('Budget disponibile', 'available_budget', true, 'Saldo disponibile complessivo, calcolato dai movimenti.')}
      {kpi('Budget riservato', 'reserved_budget', true, 'Budget impegnato nelle richieste non ancora concluse.')}
    </div>
    <section className="panel crm-panel"><h3>Regola attiva</h3>{loading ? <p>Caricamento…</p> : error ? <p>Configurazione non disponibile.</p> : data?.active_configuration ? <dl><div><dt>Nome</dt><dd>{data.active_configuration.name}</dd></div><div><dt>Cashback</dt><dd>{data.active_configuration.cashback_percent}%</dd></div></dl> : <p>Nessuna configurazione pubblicata e già in vigore.</p>}</section>
  </>;
}

export default function CrmClub({ page = 'dashboard' }) {
  const titles = { dashboard: 'SalidischiaClub', requests: 'Richieste Club', configuration: 'Configurazione Club', rewards: 'Catalogo premi Club', members: 'Clienti e movimenti Club' };
  const descriptions = { dashboard: 'Fidelity, cashback e richieste dei clienti Sali di Ischia.', requests: 'Verifica i dettagli e approva le richieste di rimborso o premio.', configuration: 'Percentuale cashback, modalità di rimborso, ritiro e spedizione.', rewards: 'Prodotti Workspace e premi disponibili per il riscatto.', members: 'Consumatori collegati al CRM BtoC e movimenti del budget.' };
  return <div className="crm-page club-page">
    <CrmPageHeader eyebrow="CRM BtoC · SalidischiaClub" title={titles[page]} description={descriptions[page]} actions={<Link className="secondary-action crm-secondary" to="/crm/online">CRM BtoC</Link>}><CrmSectionNav items={CLUB_NAVIGATION} label="Navigazione SalidischiaClub" /></CrmPageHeader>
    {page === 'dashboard' && <ClubDashboard />}
    {page === 'requests' && <ClubRequests />}
    {page === 'configuration' && <ClubConfiguration />}
    {page === 'rewards' && <ClubRewards />}
    {page === 'members' && <ClubMembers />}
  </div>;
}

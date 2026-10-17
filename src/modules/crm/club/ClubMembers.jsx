import { useState } from 'react';
import { Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate, formatMoney } from '../crmConfig';
import { CrmKpiDialog } from '../CrmKpiDetail';
import { MOVEMENT_LABELS } from './clubModel';
import useClubRpc from './useClubRpc';

function Movements({ member, onClose }) {
  const [page, setPage] = useState(0);
  const { data, error, loading } = useClubRpc('club_admin_movements', { target_member_id: member.id, page_offset: page * 25 });
  return <CrmKpiDialog title={`Movimenti · ${member.customer_name}`} subtitle={member.member_code} onClose={onClose}>{error && <p role="alert" className="crm-message error">{error}</p>}{loading ? <p>Caricamento movimenti…</p> : !error && <><div className="crm-table-wrap"><table className="crm-table" data-column-controls="off"><thead><tr><th>Data</th><th>Operazione</th><th>Disponibile</th><th>Riservato</th><th>Causale</th></tr></thead><tbody>{(data?.rows || []).map(row => <tr key={row.id}><td>{formatDate(row.created_at)}</td><td>{MOVEMENT_LABELS[row.kind]}</td><td>{formatMoney(row.available_delta)}</td><td>{formatMoney(row.reserved_delta)}</td><td>{row.reason}<small>{row.request_id || row.purchase_id}</small></td></tr>)}</tbody></table>{!data?.rows?.length && <p className="crm-empty">Nessun movimento.</p>}</div><div className="crm-pagination"><span>{data?.total || 0} movimenti</span><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>Precedente</button><button type="button" disabled={(page + 1) * 25 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>Successiva</button></div></>}</CrmKpiDialog>;
}
export default function ClubMembers() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [member, setMember] = useState(null);
  const { data, error, loading } = useClubRpc('club_admin_members', { search_text: query, page_offset: page * 25, page_size: 25 });
  return <>
    <form className="crm-filters" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setPage(0); }}><label><Search size={18} /><input aria-label="Cerca iscritti al Club" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} placeholder="Cliente, email, tessera o negozio" /></label><button className="secondary-action crm-secondary">Cerca</button></form>
    {error && <div role="alert" className="crm-message error">{error}</div>}{loading ? <div className="crm-loading">Caricamento iscritti…</div> : !error && <><div className="crm-table-wrap"><table className="crm-table" data-column-controls="off"><thead><tr><th>Cliente CRM BtoC</th><th>Tessera</th><th>Negozio di fiducia</th><th>Disponibile</th><th>Riservato</th><th>Utilizzato</th><th>Azioni</th></tr></thead><tbody>{(data?.rows || []).map(row => <tr key={row.id}><td><Link to={`/crm/online/clienti/${encodeURIComponent(`crm:${row.crm_account_id}`)}`}>{row.customer_name}</Link><small>{row.customer_email}</small><small>{row.active ? 'Attivo' : 'Sospeso'} · dal {formatDate(row.joined_at)}</small></td><td>{row.member_code}</td><td>{row.store_name || row.trusted_store_code || 'Non selezionato'}</td><td>{formatMoney(row.available)}</td><td>{formatMoney(row.reserved)}</td><td>{formatMoney(row.used)}</td><td><button type="button" className="crm-table-action" onClick={() => setMember(row)}>Movimenti</button></td></tr>)}</tbody></table>{!data?.rows?.length && <p className="crm-empty">Nessun iscritto al Club.</p>}</div><div className="crm-pagination"><span>{data?.total || 0} iscritti · Pagina {page + 1}</span><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>Precedente</button><button type="button" disabled={(page + 1) * 25 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>Successiva</button></div></>}
    {member && <Movements member={member} onClose={() => setMember(null)} />}
  </>;
}

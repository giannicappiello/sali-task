import { useState } from 'react';
import { CrmKpiDialog } from '../CrmKpiDetail';
import { supabase } from '../../../lib/supabaseClient';
import { clubError } from './clubModel';
import useClubRpc from './useClubRpc';
import { offerConditions, offerStatus } from '../../../../apps/salidischia-club/src/offerModel';

export default function ClubStorePromotions({ store, canWrite, onClose }) {
  const [page, setPage] = useState(0), [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const { data, error, loading, reload } = useClubRpc('club_my_store_offers', { page_offset: page * 20, target_store_code: store.store_code });
  async function suspend(row) {
    if (busy) return;setBusy(true);setFailure('');
    try { const { error: rejected } = await supabase.rpc('club_publish_store_offer', { target_id: row.id, expected_updated_at: row.updated_at, archive: true, target_store_code: store.store_code });if (rejected) throw rejected;await reload(); } catch (error) { setFailure(clubError(error)); } finally { setBusy(false); }
  }
  return <CrmKpiDialog title={`Offerte · ${store.name}`} onClose={() => { if (!busy) onClose(); }}>{(error || failure) && <p className="crm-message error" role="alert">{error || failure}</p>}<p>Offerte create dal negozio per i propri clienti di fiducia. La visibilità segue le date, l’adesione del negozio e lo stato della pubblicazione.</p>{loading ? <p>Caricamento offerte…</p> : <div className="crm-table-wrap"><table className="crm-table" data-column-controls="off"><thead><tr><th>Offerta</th><th>Condizioni</th><th>Stato</th><th>Periodo</th><th>Azioni</th></tr></thead><tbody>{data?.rows?.map(row => <tr key={row.id}><td><strong>{row.title}</strong><small>{row.description}</small></td><td>{offerConditions(row)}</td><td>{offerStatus(row)}</td><td>{new Date(row.starts_at).toLocaleString('it-IT')}{row.ends_at && <small>Fino al {new Date(row.ends_at).toLocaleString('it-IT')}</small>}</td><td>{canWrite && row.status === 'published' && <button type="button" className="secondary-action crm-secondary" disabled={busy} onClick={() => void suspend(row)}>Sospendi offerta</button>}</td></tr>)}</tbody></table>{!data?.rows?.length && <p className="crm-empty">Nessuna offerta creata dal negozio.</p>}</div>}{(page > 0 || data?.total > 20) && <div className="crm-toolbar"><button className="secondary-action crm-secondary" disabled={!page || loading || busy} onClick={() => setPage(page - 1)}>Precedenti</button><span>Pagina {page + 1}</span><button className="secondary-action crm-secondary" disabled={loading || busy || (page + 1) * 20 >= data?.total} onClick={() => setPage(page + 1)}>Successivi</button></div>}</CrmKpiDialog>;
}

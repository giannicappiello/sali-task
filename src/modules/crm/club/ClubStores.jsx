import ClubStorePromotions from './ClubStorePromotions';
import { useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { CLUB_SCREENS, clubError } from './clubModel';
import useClubRpc from './useClubRpc';

function Settings({ data, allowed, execute }) {
  const [owner, setOwner] = useState(data.settings.crm_owner_id || ''), [email, setEmail] = useState(data.settings.support_email || '');
  return <section className="panel crm-panel"><h3>Responsabile CRM e assistenza</h3><form className="club-form" onSubmit={e => { e.preventDefault(); void execute('club_admin_public_settings', { payload: { crm_owner_id: owner, support_email: email } }); }}><fieldset disabled={!allowed} className="club-fields"><div className="crm-form-grid"><label>Responsabile dei clienti Club<select required value={owner} onChange={e => setOwner(e.target.value)}><option value="">Seleziona amministratore</option>{data.owners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Email assistenza<input type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label></div>{allowed && <button className="primary-action crm-primary">Salva impostazioni</button>}</fieldset></form><p>Regolamento e privacy si gestiscono nella scheda Regolamento.</p></section>;
}
export default function ClubStores() {
  const { data, error, loading, reload } = useClubRpc('club_admin_stores');
  const { canUseScreen } = useAuth();
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [query, setQuery] = useState(''), [store, setStore] = useState(''), [email, setEmail] = useState(''), [invitation, setInvitation] = useState('');
  const [promotions, setPromotions] = useState(null);
  const lock = useRef(false);
  const canWrite = canUseScreen(CLUB_SCREENS.stores, 'scrittura');
  async function execute(name, parameters) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFailure('');
    try {
      const result = await supabase.rpc(name, parameters);
      if (result.error) throw result.error;
      if (name === 'club_admin_invite_store') setInvitation(`https://club.salidischia.it/?invito=${result.data}`);
      else await reload();
    } catch (err) { setFailure(clubError(err)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>{promotions && <ClubStorePromotions store={promotions} canWrite={canWrite} onClose={() => setPromotions(null)} />}{(error || failure) && <p role="alert" className="crm-message error">{error || failure}</p>}{loading ? <p>Caricamento negozi…</p> : data && <><Settings key={data.settings.updated_at} data={data} allowed={!busy && canUseScreen(CLUB_SCREENS.stores, 'amministrazione')} execute={execute} /><section className="panel crm-panel club-form"><h3>Negozi aderenti</h3><label>Cerca negozio<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Negozio CRM BtoB</th><th>Codice</th><th>Operatori attivi</th><th>Adesione al Club</th><th>Offerte</th></tr></thead><tbody>{data.stores.filter(item => `${item.name} ${item.store_code}`.toLowerCase().includes(query.toLowerCase())).map(item => <tr key={item.store_code}><td>{item.name}</td><td>{item.store_code}</td><td>{item.operators}</td><td><button className="secondary-action crm-secondary" disabled={busy || !canWrite} onClick={() => void execute('club_admin_enable_store', { target_store_code: item.store_code, is_enabled: !item.enabled })}>{item.enabled ? 'Disabilita' : 'Abilita'}</button></td><td><button type="button" className="secondary-action crm-secondary" disabled={busy} onClick={() => setPromotions(item)}>Offerte</button></td></tr>)}</tbody></table></div>{!data.stores.length && <p>Nessun negozio classificato CRM BtoB disponibile.</p>}</section>{canWrite && <section className="panel crm-panel"><h3>Invita un operatore del negozio</h3><form className="club-form" onSubmit={e => { e.preventDefault(); setInvitation(''); void execute('club_admin_invite_store', { target_store_code: store, email_address: email }); }}><fieldset className="club-fields" disabled={busy}><div className="crm-form-grid"><label>Negozio abilitato<select required value={store} onChange={e => { setStore(e.target.value); setInvitation(''); }}><option value="">Seleziona negozio</option>{data.stores.filter(item => item.enabled).map(item => <option key={item.store_code} value={item.store_code}>{item.name}</option>)}</select></label><label>Email operatore<input required type="email" value={email} onChange={e => { setEmail(e.target.value); setInvitation(''); }} /></label></div><button className="primary-action crm-primary">Genera invito</button></fieldset></form>{invitation && <label className="club-form">Link di invito<input readOnly value={invitation} onFocus={e => e.target.select()} /></label>}<p>L’invito vale sette giorni e può essere usato una sola volta dall’indirizzo email indicato. Condividi il link con l’operatore.</p></section>}<section className="panel crm-panel"><h3>Accessi dei negozi</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Email</th><th>Negozio</th><th>Stato</th><th>Azione</th></tr></thead><tbody>{data.operators.map(item => <tr key={item.id}><td>{item.email}</td><td>{data.stores.find(s => s.store_code === item.store_code)?.name || item.store_code}</td><td>{item.active ? 'Attivo' : 'Sospeso'}</td><td><button className="secondary-action crm-secondary" disabled={busy || !canWrite} onClick={() => void execute('club_admin_operator', { target_auth_id: item.id, is_active: !item.active })}>{item.active ? 'Sospendi' : 'Riattiva'}</button></td></tr>)}</tbody></table></div>{!data.operators.length && <p>Nessun operatore ha ancora attivato il proprio accesso.</p>}</section></>}</>;
}

import { useAction } from './useAction';
import { usePortalRpc } from './usePortalApi';
import { useState } from 'react';
import useAsync from './useAsync';
import { Alert } from './ui';

export default function Onboarding({ info, invite, onComplete }) {
  const rpc = usePortalRpc();
  const identity = useAsync('club_enrollment_identity', { invitation_token: invite || null });
  const [shopName, setShopName] = useState(null);
  const retailer = identity.data?.kind === 'store';
  const [firstName, setFirstName] = useState(null), [lastName, setLastName] = useState(null);
  const [phone, setPhone] = useState(''), [accepted, setAccepted] = useState(false), [profiling, setProfiling] = useState(false);
  const first = firstName ?? identity.data?.first_name ?? '', last = lastName ?? identity.data?.last_name ?? '';
  const { busy, error, run } = useAction();
  async function submit(event) {
    event.preventDefault();
    const result = await run(() => rpc(retailer ? 'club_enroll_retailer' : 'club_enroll_member', { ...(retailer ? { shop_name: (shopName ?? identity.data?.shop_name ?? '').trim(), invitation_token: invite || null } : {}), first_name: first.trim(), last_name: last.trim(), email_address: identity.data?.email || '', phone_number: phone.trim(), accept_program: accepted, profiling, expected_terms_url: info.terms_url, expected_privacy_url: info.privacy_url }));
    if (result.ok) { sessionStorage.removeItem('club-invitation');history.replaceState(null, '', '/');await onComplete(); }
  }
  return <section className="panel form-panel"><span className="eyebrow">SALI DI ISCHIA CLUB</span><h1>{retailer ? 'Completa l’iscrizione del negozio.' : 'Iniziamo da te.'}</h1><p>{retailer ? 'Conferma i dati del referente e completa l’adesione del tuo negozio al Club.' : 'Completa l’iscrizione per avere la tua Fidelity e scegliere il negozio di fiducia.'}</p><Alert error={error || identity.error} />{identity.error && <button type="button" className="text-button" onClick={identity.reload}>Riprova a caricare i dati</button>}<form className="form-stack" onSubmit={submit}><fieldset disabled={busy}>{<>{retailer && <div className="notice"><strong>{identity.data.legal_name}</strong></div>}<div className="form-grid"><label>Nome<input required minLength={1} maxLength={100} autoComplete="given-name" value={first} onChange={e => setFirstName(e.target.value)} /></label><label>Cognome<input required minLength={1} maxLength={100} autoComplete="family-name" value={last} onChange={e => setLastName(e.target.value)} /></label></div><label>Email<input required type="email" autoComplete="email" maxLength={254} readOnly value={identity.data?.email || ''} /><small>L’indirizzo verificato del tuo account Club.</small></label>{retailer && <label>Nome Negozio<input maxLength={120} autoComplete="organization" value={shopName ?? identity.data?.shop_name ?? ''} onChange={e => setShopName(e.target.value)} /><small>Il nome con cui i clienti troveranno il tuo negozio.</small></label>}<label>Telefono (facoltativo)<input type="tel" maxLength={30} autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>{info?.registration_available ? <><label className="check"><input required type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>Ho letto l’<a href={info.privacy_url} target="_blank" rel="noopener noreferrer">informativa privacy</a> e accetto le <a href={info.terms_url} target="_blank" rel="noopener noreferrer">condizioni del programma</a>.</span></label><label className="check"><input required type="checkbox" checked={profiling} onChange={e => setProfiling(e.target.checked)} /><span>Acconsento alla profilazione per proposte personalizzate.</span></label></> : <p className="notice">Il programma sta per aprire. Torna qui quando le iscrizioni saranno disponibili.</p>}</>}<button className="button primary full" disabled={busy || !info?.registration_available || identity.loading || !identity.data?.email}>{busy ? 'Attivazione…' : retailer ? 'Completa iscrizione negozio' : 'Crea la mia Fidelity'}</button></fieldset></form></section>;
}

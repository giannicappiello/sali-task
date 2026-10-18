import { useAction } from './useAction';
import { usePortalRpc } from './usePortalApi';
import { useState } from 'react';
import useAsync from './useAsync';
import { Alert } from './ui';

export default function Onboarding({ info, invite, onComplete }) {
  const rpc = usePortalRpc();
  const identity = useAsync('club_enrollment_identity', {}, !invite);
  const [firstName, setFirstName] = useState(null), [lastName, setLastName] = useState(null);
  const [phone, setPhone] = useState(''), [accepted, setAccepted] = useState(false), [profiling, setProfiling] = useState(false);
  const first = firstName ?? identity.data?.first_name ?? '', last = lastName ?? identity.data?.last_name ?? '';
  const { busy, error, run } = useAction();
  async function submit(event) {
    event.preventDefault();
    const result = await run(() => invite ? rpc('club_claim_store_invite', { invitation_token: invite }) : rpc('club_enroll_member', { first_name: first.trim(), last_name: last.trim(), email_address: identity.data?.email || '', phone_number: phone.trim(), accept_program: accepted, profiling, expected_terms_url: info.terms_url, expected_privacy_url: info.privacy_url }));
    if (result.ok) { sessionStorage.removeItem('club-invitation');history.replaceState(null, '', '/');await onComplete(); }
  }
  return <section className="panel form-panel"><span className="eyebrow">SALI DI ISCHIA CLUB</span><h1>{invite ? 'Attiva il tuo negozio.' : 'Iniziamo da te.'}</h1><p>{invite ? 'Il tuo account verrà collegato al negozio indicato nell’invito.' : 'Completa l’iscrizione per avere la tua Fidelity e scegliere il negozio di fiducia.'}</p><Alert error={error || identity.error} />{identity.error && <button type="button" className="text-button" onClick={identity.reload}>Riprova a caricare i dati</button>}<form className="form-stack" onSubmit={submit}><fieldset disabled={busy}>{!invite && <><div className="form-grid"><label>Nome<input required minLength={1} maxLength={100} autoComplete="given-name" value={first} onChange={e => setFirstName(e.target.value)} /></label><label>Cognome<input required minLength={1} maxLength={100} autoComplete="family-name" value={last} onChange={e => setLastName(e.target.value)} /></label></div><label>Email<input required type="email" autoComplete="email" maxLength={254} readOnly value={identity.data?.email || ''} /><small>L’indirizzo verificato del tuo account Club.</small></label><label>Telefono (facoltativo)<input type="tel" maxLength={30} autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>{info?.registration_available ? <><label className="check"><input required type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>Ho letto l’<a href={info.privacy_url} target="_blank" rel="noopener noreferrer">informativa privacy</a> e accetto le <a href={info.terms_url} target="_blank" rel="noopener noreferrer">condizioni del programma</a>.</span></label><label className="check"><input required type="checkbox" checked={profiling} onChange={e => setProfiling(e.target.checked)} /><span>Acconsento alla profilazione per proposte personalizzate.</span></label></> : <p className="notice">Il programma sta per aprire. Torna qui quando le iscrizioni saranno disponibili.</p>}</>}<button className="button primary full" disabled={busy || (!invite && (!info?.registration_available || identity.loading || !identity.data?.email))}>{busy ? 'Attivazione…' : invite ? 'Attiva accesso negozio' : 'Crea la mia Fidelity'}</button></fieldset></form></section>;
}

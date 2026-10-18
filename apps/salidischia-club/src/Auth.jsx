import RetailerSignup from './RetailerSignup';
import { useAction } from './useAction';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { usePortalAuth } from './usePortalApi';
import { Alert } from './ui';

export default function Auth({ info, invite = '' }) {
  const auth = usePortalAuth();
  const [mode, setMode] = useState('login'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [firstName, setFirstName] = useState(''), [lastName, setLastName] = useState(''), [feedback, setFeedback] = useState('');
  const [kind, setKind] = useState(null), [staff, setStaff] = useState(false);
  const { busy, error, run } = useAction();
  async function submit(event) {
    event.preventDefault(); setFeedback('');
    await run(async () => {
      const emailAddress = email.trim();
      if (mode === 'signup') {
        const redirect = new URL('/', location.origin); if (invite) redirect.searchParams.set('invito', invite);
        const { data, error: failure, preview } = await auth.signUp({ email: emailAddress, password, options: { emailRedirectTo: redirect.href, data: { club_app: 'salidischia-club', nome: `${firstName.trim()} ${lastName.trim()}`, first_name: firstName.trim(), last_name: lastName.trim() } } });
        if (failure) throw failure;
        if (preview) setFeedback('Iscrizione simulata: nessun account creato e nessuna email inviata.');
        else if (!data.session) setFeedback('Controlla la tua email e conferma l’indirizzo per proseguire. Se hai già un account, usa Accedi.');
      } else if (mode === 'reset') {
        const { error: failure, preview } = await auth.resetPasswordForEmail(emailAddress, { redirectTo: location.origin + '/?recupero=1' });
        if (failure) throw failure;setFeedback(preview ? 'Recupero simulato: nessuna email inviata.' : 'Se l’indirizzo è associato a un account, riceverai un’email per recuperare la password.');
      } else { const { error: failure, preview } = await auth.signInWithPassword({ email: emailAddress, password });if (failure) throw failure;if (preview) setFeedback('Accesso simulato riuscito. Usa il selettore in alto per provare Cliente o Negozio.'); }
    });
  }
  const registrationAvailable = !!info?.registration_available || !!invite;
  return <section className="auth-panel" aria-label="Accesso al Club"><span className="eyebrow">{invite ? 'AREA NEGOZIANTE' : 'LA TUA FIDELITY'}</span><h2>{staff && mode === 'login' ? 'Accesso Staff Workspace.' : mode === 'signup' ? 'Entra nel Club.' : mode === 'reset' ? 'Ritrova il tuo accesso.' : 'Bentornata. Bentornato.'}</h2><p className="muted">{invite ? 'Usa l’indirizzo email a cui è destinato l’invito del tuo negozio.' : 'Clienti e negozi: account Club. Staff: credenziali Workspace.'}</p>
    <div className="segmented" aria-label="Accesso o iscrizione"><button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>Accedi</button><button type="button" aria-pressed={mode === 'signup'} onClick={() => { setMode('signup');setKind(null);setStaff(false);setFeedback(''); }}>Iscriviti</button></div>
    {!registrationAvailable && <p className="notice">Stiamo preparando l’apertura delle iscrizioni. Potrai registrarti qui appena il programma sarà disponibile.</p>}
    <Alert error={error} /><Alert>{feedback}</Alert>
    {mode === 'signup' && !kind ? <div className="signup-choices"><p>Come vuoi entrare nel Club?</p><button type="button" className="button full" disabled={!registrationAvailable} onClick={() => setKind('store')}>Rivenditore Ufficiale Sali di Ischia</button><button type="button" className="button full" disabled={!registrationAvailable} onClick={() => setKind('consumer')}>Consumatore</button><button type="button" className="button full" onClick={() => { setMode('login');setStaff(true);setKind(null);setEmail('');setPassword('');setFeedback(''); }}>Membro Staff</button></div> : mode === 'signup' && kind === 'store' ? <RetailerSignup onBack={() => setKind(null)} /> : <>{mode === 'signup' && <button type="button" className="text-button" onClick={() => setKind(null)}>Cambia tipo di iscrizione</button>}{staff && mode === 'login' && <p>Agenti, beauty, responsabili e backoffice: usa le stesse credenziali Workspace.</p>}<form onSubmit={submit} className="form-stack"><fieldset disabled={busy}>{mode === 'signup' && <div className="form-grid"><label>Nome<input required autoComplete="given-name" maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} /></label><label>Cognome<input required autoComplete="family-name" maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} /></label></div>}<label>Email<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>{mode !== 'reset' && <label>Password<input required type="password" minLength={mode === 'signup' ? 6 : 1} maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />{mode === 'signup' && <small>Almeno 6 caratteri.</small>}</label>}<button className="button primary full" disabled={busy || (mode === 'signup' && !registrationAvailable)}>{busy ? 'Attendi…' : mode === 'signup' ? 'Crea il tuo account' : mode === 'reset' ? 'Invia email di recupero' : 'Accedi al Club'}<ArrowRight size={18} /></button></fieldset></form></>}
    <button type="button" className="text-button" onClick={() => setMode(mode === 'reset' ? 'login' : 'reset')}>{mode === 'reset' ? 'Torna all’accesso' : 'Hai dimenticato la password?'}</button>
    <div className="legal-links">{info?.privacy_url && <a href={info.privacy_url} target="_blank" rel="noopener noreferrer">Privacy</a>}{info?.terms_url && <a href={info.terms_url} target="_blank" rel="noopener noreferrer">Condizioni del Club</a>}</div>
  </section>;
}
export function Recovery({ onDone }) {
  const auth = usePortalAuth();
  const [password, setPassword] = useState('');const { busy, error, run } = useAction();
  return <section className="panel form-panel"><h1>La tua nuova password</h1><Alert error={error} /><form className="form-stack" onSubmit={async e => { e.preventDefault(); const result = await run(async () => { const { error: failure } = await auth.updateUser({ password });if (failure) throw failure; });if (result.ok) onDone(); }}><label>Nuova password<input required type="password" minLength={6} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="button primary" disabled={busy}>Salva nuova password</button></form></section>;
}

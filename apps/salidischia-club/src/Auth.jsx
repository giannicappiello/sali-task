import { useAction } from './useAction';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { usePortalAuth } from './usePortalApi';
import { Alert } from './ui';

export default function Auth({ info, invite = '' }) {
  const auth = usePortalAuth();
  const [mode, setMode] = useState('login'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(''), [feedback, setFeedback] = useState('');
  const { busy, error, run } = useAction();
  async function submit(event) {
    event.preventDefault(); setFeedback('');
    await run(async () => {
      const emailAddress = email.trim();
      if (mode === 'signup') {
        const redirect = new URL('/', location.origin); if (invite) redirect.searchParams.set('invito', invite);
        const { data, error: failure, preview } = await auth.signUp({ email: emailAddress, password, options: { emailRedirectTo: redirect.href, data: { club_app: 'salidischia-club', nome: name.trim() } } });
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
  return <section className="auth-panel" aria-label="Accesso al Club"><span className="eyebrow">{invite ? 'AREA NEGOZIANTE' : 'LA TUA FIDELITY'}</span><h2>{mode === 'signup' ? 'Entra nel Club.' : mode === 'reset' ? 'Ritrova il tuo accesso.' : 'Bentornata. Bentornato.'}</h2><p className="muted">{invite ? 'Usa l’indirizzo email a cui è destinato l’invito del tuo negozio.' : 'Un account dedicato a Sali di Ischia Club.'}</p>
    <div className="segmented" aria-label="Accesso o iscrizione"><button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>Accedi</button><button type="button" aria-pressed={mode === 'signup'} disabled={!registrationAvailable} onClick={() => setMode('signup')}>Iscriviti</button></div>
    {!registrationAvailable && <p className="notice">Stiamo preparando l’apertura delle iscrizioni. Potrai registrarti qui appena il programma sarà disponibile.</p>}
    <Alert error={error} /><Alert>{feedback}</Alert>
    <form onSubmit={submit} className="form-stack"><fieldset disabled={busy}>{mode === 'signup' && <label>Nome e cognome<input required autoComplete="name" maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>}<label>Email<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>{mode !== 'reset' && <label>Password<input required type="password" minLength={mode === 'signup' ? 10 : 1} maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />{mode === 'signup' && <small>Almeno 10 caratteri.</small>}</label>}<button className="button primary full" disabled={busy || (mode === 'signup' && !registrationAvailable)}>{busy ? 'Attendi…' : mode === 'signup' ? 'Crea il tuo account' : mode === 'reset' ? 'Invia email di recupero' : 'Accedi al Club'}<ArrowRight size={18} /></button></fieldset></form>
    <button type="button" className="text-button" onClick={() => setMode(mode === 'reset' ? 'login' : 'reset')}>{mode === 'reset' ? 'Torna all’accesso' : 'Hai dimenticato la password?'}</button>
    <div className="legal-links">{info?.privacy_url && <a href={info.privacy_url} target="_blank" rel="noopener noreferrer">Privacy</a>}{info?.terms_url && <a href={info.terms_url} target="_blank" rel="noopener noreferrer">Condizioni del Club</a>}</div>
  </section>;
}
export function Recovery({ onDone }) {
  const auth = usePortalAuth();
  const [password, setPassword] = useState('');const { busy, error, run } = useAction();
  return <section className="panel form-panel"><h1>La tua nuova password</h1><Alert error={error} /><form className="form-stack" onSubmit={async e => { e.preventDefault(); const result = await run(async () => { const { error: failure } = await auth.updateUser({ password });if (failure) throw failure; });if (result.ok) onDone(); }}><label>Nuova password<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="button primary" disabled={busy}>Salva nuova password</button></form></section>;
}

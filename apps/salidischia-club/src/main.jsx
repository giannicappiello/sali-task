import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LogOut } from 'lucide-react';
import { supabase } from './client';
import useAsync from './useAsync';
import { Alert, InstallApp, Loading } from './ui';
import Auth, { Recovery } from './Auth';
import Onboarding from './Onboarding';
import MemberPortal from './MemberPortal';
import StorePortal from './StorePortal';
import Regulation from './Regulation';
import './style.css';

function Account({ publicInfo, invite }) {
  const { data, error, loading, reload } = useAsync('club_session');
  if (loading) return <Loading />;
  if (error) return <section className="panel form-panel"><h1>Verifica il tuo accesso</h1><Alert error={error} /><p>Gli accessi Club sono dedicati a clienti e negozi aderenti.</p><button className="button" onClick={() => supabase.auth.signOut()}>Esci e usa un altro account</button></section>;
  if (data?.role === 'store') return <StorePortal />;
  if (data?.role === 'member') return <MemberPortal />;
  return <Onboarding info={publicInfo} invite={invite} onComplete={reload} />;
}
function App() {
  const { data: info, error: publicError, loading: publicLoading } = useAsync('club_public_info');
  const [session, setSession] = useState(null), [checking, setChecking] = useState(true), [recovery, setRecovery] = useState(false);
  const [invite] = useState(() => { const token = new URLSearchParams(location.search).get('invito');if (token) sessionStorage.setItem('club-invitation', token);return token || sessionStorage.getItem('club-invitation') || ''; });
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session);setChecking(false); } });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => { if (!active) return;setSession(nextSession);setChecking(false);if (event === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => { active = false;data.subscription.unsubscribe(); };
  }, []);
  return <div className="club-app"><header className="app-header"><a className="brand" href="/" aria-label="Sali di Ischia Club, pagina iniziale"><img src="/logo.png" alt="Sali di Ischia" /><span>CLUB<small>FIDELITY & CASHBACK</small></span></a><div className="header-actions"><InstallApp />{session && <button type="button" className="icon-button" aria-label="Esci dal Club" onClick={() => supabase.auth.signOut()}><LogOut size={20} /></button>}</div></header>
    <main>{publicError && <Alert error={publicError} />}{location.pathname.startsWith('/regolamento') ? <Regulation /> : checking || publicLoading ? <Loading /> : recovery && session ? <Recovery onDone={() => { setRecovery(false);history.replaceState(null, '', '/'); }} /> : session ? <Account key={session.user.id} publicInfo={info} invite={invite} /> : <>
      <div className="landing"><section className="brand-story"><div className="story-art"><img src="/catalog-hero.webp" alt="Trattamento cosmetico e dettagli delle acque termali, dal catalogo Sali di Ischia" /><div className="story-stamp"><img src="/catalog-logo.png" alt="Sali di Ischia" /></div></div><div className="story-copy"><span className="eyebrow">IL TUO RITUALE, UN NUOVO VALORE</span><h1>La bellezza<br />di farne parte.</h1><p>I tuoi acquisti Sali di Ischia diventano un budget da dedicare a te. Una Fidelity personale, un negozio di fiducia e nuovi vantaggi da scoprire.</p>{info?.program && <div className="program-rate"><strong>{info.program.cashback_percent}%</strong><span>di cashback sugli acquisti validi<br />secondo le condizioni del programma</span></div>}<div className="story-steps"><span><b>01</b>Scegli il tuo negozio</span><span><b>02</b>Accumula cashback</span><span><b>03</b>Scegli il tuo premio</span></div></div></section><Auth info={info} invite={invite} /></div>
    </>}</main><footer className="site-footer"><span>SALI DI ISCHIA · CLUB</span><div><a href="/regolamento">Regolamento e privacy</a><a href="https://www.salidischia.it" target="_blank" rel="noopener noreferrer">Scopri Sali di Ischia</a>{info?.privacy_url && <a href={info.privacy_url} target="_blank" rel="noopener noreferrer">Privacy</a>}{info?.terms_url && <a href={info.terms_url} target="_blank" rel="noopener noreferrer">Condizioni</a>}{info?.support_email && <a href={`mailto:${info.support_email}`}>Assistenza</a>}</div></footer></div>;
}
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

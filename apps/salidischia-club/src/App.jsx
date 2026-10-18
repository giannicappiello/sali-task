import { CartProvider, CartButton } from './OrderCart';
import { Suspense, lazy, useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { supabase } from './client';
import useAsync from './useAsync';
import { Alert, InstallApp, Loading } from './ui';
import { Recovery } from './Auth';
import ClubLanding from './ClubLanding';
import Onboarding from './Onboarding';
import MemberPortal from './MemberPortal';
import StorePortal from './StorePortal';
import Regulation from './Regulation';
import AppUpdate from './AppUpdate';
import './style.css';
import './club-content.css';
import ClubCatalog from './ClubCatalog';
import ShopOffers from './ShopOffers';
import './store-offers.css';
import ClubFeed from './ClubFeed';
import ClubHomeContent from './ClubHomeContent';

const AdminPortal = lazy(() => import('./AdminPortal'));

function Account({ publicInfo, invite }) {
  const { data, error, loading, reload } = useAsync('club_session');
  if (loading) return <Loading />;
  if (error) return <section className="panel form-panel"><h1>Verifica il tuo accesso</h1><Alert error={error} /><p>Il Club usa account dedicati per clienti e negozi e i permessi Workspace per lo staff.</p><button className="button" onClick={() => supabase.auth.signOut()}>Esci e usa un altro account</button></section>;
  if (data?.role === 'admin' || data?.role === 'staff') return <Suspense fallback={<Loading />}><AdminPortal name={data.name} role={data.role} permissions={data.permissions} workspaceRole={data.workspace_role} /></Suspense>;
  if (data?.role === 'store') return <StorePortal />;
  if (data?.role === 'member') return <MemberPortal />;
  return <Onboarding info={publicInfo} invite={invite} onComplete={reload} />;
}
export default function App() {
  const { data: info, error: publicError, loading: publicLoading } = useAsync('club_public_info');
  const [session, setSession] = useState(null), [checking, setChecking] = useState(true), [recovery, setRecovery] = useState(false);
  const [invite] = useState(() => { const token = new URLSearchParams(location.search).get('invito');if (token) sessionStorage.setItem('club-invitation', token);return token || sessionStorage.getItem('club-invitation') || ''; });
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session);setChecking(false); } });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => { if (!active) return;setSession(nextSession);setChecking(false);if (event === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => { active = false;data.subscription.unsubscribe(); };
  }, []);
  return <CartProvider owner={session?.user?.id}><div className="club-app"><header className="app-header"><a className="brand" href="/" aria-label="Sali di Ischia Club, pagina iniziale"><img src="/logo.png" alt="Sali di Ischia" /><span>CLUB<small>FIDELITY & CASHBACK</small></span></a><div className="header-actions"><CartButton /><InstallApp />{session && <button type="button" className="icon-button" aria-label="Esci dal Club" onClick={() => supabase.auth.signOut()}><LogOut size={20} /></button>}</div></header>
    <nav className="public-content-nav" aria-label="Scopri il Club"><a href="/prodotti">Prodotti</a><a href="/novita">Novità e offerte</a><a href="/comunicazioni">Comunicazioni</a></nav><AppUpdate /><main>{publicError && <Alert error={publicError} />}{location.pathname.startsWith('/offerte-negozio') ? <ShopOffers /> : location.pathname.startsWith('/prodotti') ? <ClubCatalog /> : location.pathname.startsWith('/novita') ? <ClubFeed /> : location.pathname.startsWith('/comunicazioni') ? <ClubFeed contentKind="communication" /> : location.pathname.startsWith('/regolamento') ? <Regulation /> : checking || publicLoading ? <Loading /> : recovery && session ? <Recovery onDone={() => { setRecovery(false);history.replaceState(null, '', '/'); }} /> : session ? <Account key={session.user.id} publicInfo={info} invite={invite} /> : <>
      <ClubLanding info={info} invite={invite} /><ClubHomeContent />
    </>}</main><footer className="site-footer"><span>SALI DI ISCHIA · CLUB</span><div><a href="/regolamento">Regolamento e privacy</a><a href="https://www.salidischia.it" target="_blank" rel="noopener noreferrer">Scopri Sali di Ischia</a>{info?.privacy_url && <a href={info.privacy_url} target="_blank" rel="noopener noreferrer">Privacy</a>}{info?.terms_url && <a href={info.terms_url} target="_blank" rel="noopener noreferrer">Condizioni</a>}{info?.support_email && <a href={`mailto:${info.support_email}`}>Assistenza</a>}</div></footer></div></CartProvider>;
}


import { Search, ArrowRight } from 'lucide-react';
import ClubFeed from './ClubFeed';
import ShopOffers from './ShopOffers';
import './club-content.css';

export default function ClubHomeContent({ onSearch, onChooseStore }) {
  return <div className="club-home-content"><section className="catalog-invitation"><div><span className="eyebrow">IL TUO PROSSIMO RITUALE</span><h2>Scopri i prodotti Sali di Ischia.</h2><p>Ricerca rapida, categorie e materiali per conoscere ogni prodotto.</p></div><form className="catalog-quick-search" action="/prodotti" onSubmit={onSearch ? e => { e.preventDefault(); onSearch(new FormData(e.currentTarget).get('q')); } : undefined}><label><Search size={18} /><input name="q" type="search" aria-label="Cerca rapidamente un prodotto" maxLength={200} placeholder="Nome, codice o parola chiave" /></label><button className="button primary">Cerca<ArrowRight size={16} /></button></form><a className="text-button" href="/prodotti">Esplora tutte le categorie<ArrowRight size={16} /></a></section><ShopOffers compact onChooseStore={onChooseStore} /><ClubFeed compact /><ClubFeed compact contentKind="communication" /></div>;
}

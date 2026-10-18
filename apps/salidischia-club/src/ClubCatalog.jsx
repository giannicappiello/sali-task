import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import useAsync from './useAsync';
import useMediaUrls from './useMediaUrls';
import { MediaCover, MediaGallery } from './ClubMedia';
import { Alert, Loading, Modal } from './ui';
import { categoryPath, safeWebsiteUrl } from './catalogModel';
import './club-content.css';
import { ProductPrice, StoreOfferDetail } from './ShopOffers';

export function ProductDetail({ id, onClose }) {
  const [offer, setOffer] = useState(null);
  const { data, error, loading } = useAsync('club_catalog_product', { target_id: id });
  const materials = useMediaUrls(data?.media || []);
  const cover = data?.media?.find(item => item.cover && item.kind === 'immagine');
  const website = safeWebsiteUrl(data?.website_url);
  return <Modal title="Scheda prodotto" onClose={onClose}><Alert error={error} />{loading ? <Loading /> : data ? <article className="catalog-detail"><MediaCover src={cover ? materials.urls[cover.id] : data.image_url} title={data.name} /><span className="eyebrow">SALI DI ISCHIA · {data.code}</span><h2>{data.name}</h2><ProductPrice pricing={data.pricing} onOffer={setOffer} /><div className="document-copy">{data.description ? data.description.split(/\n\s*\n/).map((text, index) => <p key={index}>{text}</p>) : <p>La descrizione di questo prodotto è in preparazione.</p>}</div>{website && <a className="button" href={website} target="_blank" rel="noopener noreferrer">Scopri sul sito Sali di Ischia<ArrowRight size={16} /></a>}<MediaGallery media={data.media} {...materials} />{offer && <StoreOfferDetail offer={offer} onClose={() => setOffer(null)} />}</article> : !error && <p>Prodotto non disponibile.</p>}</Modal>;
}

export default function ClubCatalog({ onBack, initialSearch = '' }) {
  const [search, setSearch] = useState(() => initialSearch || new URLSearchParams(location.search).get('q') || '');
  const [query, setQuery] = useState(search), [category, setCategory] = useState(''), [page, setPage] = useState(0);
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('prodotto') || null);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const categories = useAsync('club_catalog_categories');
  const { data, error, loading } = useAsync('club_catalog_products', { search_text: query, category_id: category ? Number(category) : null, page_offset: page * 24 });
  const covers = (data?.rows || []).flatMap(row => row.media.filter(item => item.cover));
  const materials = useMediaUrls(covers);
  const all = categories.data || [];
  return <section className="club-catalog">{onBack ? <button className="text-button" onClick={onBack}><ArrowLeft size={16} />Torna al Club</button> : <a className="text-button" href="/"><ArrowLeft size={16} />Torna al Club</a>}<div className="page-heading"><span className="eyebrow">IL MONDO SALI DI ISCHIA</span><h1>Il tuo rituale di bellezza.</h1><p>Esplora i prodotti, scopri come utilizzarli e consulta i materiali disponibili.</p></div><div className="catalog-search"><label><Search size={20} /><input type="search" aria-label="Ricerca rapida prodotti" placeholder="Cerca nome, codice o parola chiave…" maxLength={200} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><label>Categoria<select aria-label="Categoria prodotti" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="">Tutte le categorie</option>{[...all].sort((a, b) => categoryPath(a, all).localeCompare(categoryPath(b, all), 'it')).map(item => <option value={item.id} key={item.id}>{categoryPath(item, all)}</option>)}</select></label></div><div className="category-chips" aria-label="Categorie principali"><button className={!category ? 'active' : ''} onClick={() => { setCategory(''); setPage(0); }}>Tutti</button>{all.filter(item => !item.parent_id).map(item => <button className={String(item.id) === category ? 'active' : ''} key={item.id} onClick={() => { setCategory(String(item.id)); setPage(0); }}>{item.name}</button>)}</div><Alert error={error || categories.error} /><p className="subtle" aria-live="polite">{loading ? 'Ricerca in corso…' : `${data?.total || 0} prodotti trovati`}</p>{loading ? <Loading /> : <div className="catalog-grid">{data?.rows?.map(item => { const cover = item.media.find(m => m.cover && m.kind === 'immagine'); return <button type="button" className="catalog-product" key={item.id} onClick={() => setSelected(item.id)}><MediaCover src={cover ? materials.urls[cover.id] : item.image_url} title={item.name} /><div><span className="eyebrow">{item.category_ids.map(id => all.find(c => c.id === id)?.name).filter(Boolean).slice(0, 2).join(' · ') || 'Sali di Ischia'}</span><h2>{item.name}</h2><small>{item.code}</small><ProductPrice compact pricing={item.pricing} /><p>{item.description}</p><span className="text-button">Scopri il prodotto<ArrowRight size={15} /></span></div></button>; })}</div>}{!loading && !data?.rows?.length && !error && <p className="empty">Nessun prodotto corrisponde alla ricerca. Prova un altro nome o una categoria diversa.</p>}{(page > 0 || (data?.total || 0) > 24) && <div className="pagination"><button className="button" disabled={!page || loading} onClick={() => setPage(page - 1)}>Precedenti</button><span>Pagina {page + 1}</span><button className="button" disabled={loading || (page + 1) * 24 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>Successivi</button></div>}{selected && <ProductDetail id={selected} onClose={() => setSelected(null)} />}</section>;
}

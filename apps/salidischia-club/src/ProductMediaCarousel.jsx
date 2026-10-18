import { lazy, Suspense, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Play, ExternalLink } from 'lucide-react';
import { MediaCover } from './ClubMedia';
import './product-media.css';

const PdfPreview = lazy(() => import('./PdfPreview'));
const kindLabel = kind => kind === 'pdf' ? 'PDF' : kind === 'video' ? 'Video' : kind === 'immagine' ? 'Foto' : 'Documento';

export default function ProductMediaCarousel({ media = [], urls, loading, error, reload, image, title }) {
  const [selected, setSelected] = useState(null), thumbs = useRef(null), touch = useRef(null);
  const items = media.filter(item => !(item.cover && item.kind === 'immagine'));
  const index = Math.max(0, items.findIndex(item => item.id === selected)), item = items[index], url = item && urls[item.id];
  function select(next) {
    const position = (next + items.length) % items.length;
    setSelected(items[position].id);
    thumbs.current?.children[position]?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
  }
  return <section className={`product-media-layout${items.length ? '' : ' product-media-single'}`} aria-label="Foto e materiali del prodotto">
    <div className="product-main-photo"><MediaCover src={image} title={title} /></div>
    {items.length > 0 && <section className="product-carousel" aria-label="Materiali del prodotto" aria-roledescription="carosello" onKeyDown={event => { if (event.target.closest('button, a, video')) return;if (event.key === 'ArrowRight') { event.preventDefault();select(index + 1); }if (event.key === 'ArrowLeft') { event.preventDefault();select(index - 1); } }}>
      <div className="product-carousel-heading"><h3>Foto, video e documenti</h3><span aria-live="polite">{index + 1} / {items.length}</span></div>
      <div className="product-preview" tabIndex={0} onTouchStart={e => {touch.current = e.touches[0].clientX;}} onTouchEnd={e => {if (touch.current !== null) {const delta = e.changedTouches[0].clientX - touch.current;if (Math.abs(delta) > 70 && item.kind !== 'pdf' && item.kind !== 'video') select(index + (delta < 0 ? 1 : -1));touch.current = null;}}}>
        {url ? item.kind === 'immagine' ? <img src={url} alt={item.title} /> : item.kind === 'video' ? <video key={item.id} src={url} controls playsInline preload="metadata" aria-label={item.title} /> : item.kind === 'pdf' ? <Suspense fallback={<p role="status">Caricamento anteprima PDF…</p>}><PdfPreview key={item.id} id={item.id} title={item.title} /></Suspense> : <div className="product-file-preview"><FileText size={48} /><p>{item.title}</p><p className="subtle">Apri il file per consultare questo formato.</p></div> : <p role="status">{loading ? 'Caricamento materiali…' : 'Anteprima temporaneamente non disponibile.'}</p>}
      </div>
      <div className="product-carousel-controls"><button type="button" className="icon-button" aria-label="Materiale precedente" disabled={items.length < 2} onClick={() => select(index - 1)}><ChevronLeft size={20} /></button><div><strong>{item.title}</strong><small>{item.section || kindLabel(item.kind)}</small></div><button type="button" className="icon-button" aria-label="Materiale successivo" disabled={items.length < 2} onClick={() => select(index + 1)}><ChevronRight size={20} /></button></div>
      {url && <a className="text-button" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Apri {kindLabel(item.kind).toLowerCase()} completo</a>}
      <div className="product-thumbnails" ref={thumbs} aria-label="Seleziona un materiale">{items.map((entry, position) => <button key={entry.id} type="button" aria-label={`Mostra ${entry.title}`} aria-pressed={position === index} onClick={() => select(position)}>{entry.kind === 'immagine' && urls[entry.id] ? <img src={urls[entry.id]} alt="" loading="lazy" /> : entry.kind === 'video' ? <Play size={24} /> : <FileText size={24} />}<span>{entry.title}</span><small>{kindLabel(entry.kind)}</small></button>)}</div>
      {error && <p role="alert">{error}</p>}{!loading && <button type="button" className="text-button" onClick={reload}>Ricarica materiali</button>}
    </section>}
  </section>;
}

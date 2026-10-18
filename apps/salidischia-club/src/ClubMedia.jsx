import { FileText, ImageOff } from 'lucide-react';

export function MediaCover({ src, title, className = '' }) {
  return src ? <img className={`content-cover ${className}`} src={src} alt={title} loading="lazy" /> : <div className={`content-cover content-placeholder ${className}`}><ImageOff size={30} /><span>Immagine non disponibile</span></div>;
}
export function MediaGallery({ media, urls, loading, error, reload }) {
  return <section className="content-media"><h3>Foto, video e documenti</h3>{loading && <p role="status">Caricamento materiali…</p>}{error && <p role="alert">{error}</p>}{media?.map(item => <article key={item.id}><h4>{item.title}</h4>{urls[item.id] ? item.kind === 'immagine' ? <a href={urls[item.id]} target="_blank" rel="noopener noreferrer"><img src={urls[item.id]} alt={item.title} loading="lazy" /></a> : item.kind === 'video' ? <video controls playsInline preload="metadata" src={urls[item.id]} aria-label={item.title} /> : <a className="button" href={urls[item.id]} target="_blank" rel="noopener noreferrer"><FileText size={18} />{item.kind === 'pdf' ? 'Apri PDF' : 'Apri documento'}</a> : !loading && <p className="subtle">Materiale temporaneamente non disponibile.</p>}</article>)}{media?.length > 0 && <button type="button" className="text-button" onClick={reload}>Ricarica materiali</button>}{!media?.length && <p className="subtle">I materiali di questo contenuto compariranno qui quando disponibili.</p>}</section>;
}

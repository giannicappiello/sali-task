import { useState } from 'react';
import { ArrowRight, Megaphone, Sparkles } from 'lucide-react';
import useAsync from './useAsync';
import useMediaUrls from './useMediaUrls';
import { MediaCover, MediaGallery } from './ClubMedia';
import { Alert, Loading, Modal } from './ui';
import { date } from './client';
import { contentLabels } from './catalogModel';
import './club-content.css';

function PostDetail({ id, onClose }) {
  const { data, error, loading } = useAsync('club_post', { target_id: id });
  const materials = useMediaUrls(data?.media || []);
  return <Modal title="Novità e comunicazioni" onClose={onClose}><Alert error={error} />{loading ? <Loading /> : data ? <article className="post-detail"><span className="eyebrow">{contentLabels[data.kind]} · {date(data.starts_at)}</span><h2>{data.title}</h2>{data.summary && <p className="post-summary">{data.summary}</p>}<div className="document-copy">{data.body.split(/\n\s*\n/).map((text, i) => text.startsWith('## ') ? <h3 key={i}>{text.slice(3)}</h3> : <p key={i}>{text}</p>)}</div>{data.ends_at && <p className="subtle">Disponibile fino al {new Date(data.ends_at).toLocaleString('it-IT')}</p>}{data.media.length > 0 && <MediaGallery media={data.media} {...materials} />}{data.products.length > 0 && <section><h3>Prodotti da scoprire</h3>{data.products.map(item => <a className="button" key={item.id} href={`/prodotti?prodotto=${item.id}`}>{item.name}<ArrowRight size={15} /></a>)}</section>}</article> : !error && <p>Questo contenuto non è più disponibile.</p>}</Modal>;
}

export default function ClubFeed({ contentKind = 'highlights', compact = false }) {
  const [kind, setKind] = useState(contentKind), [page, setPage] = useState(0), [selected, setSelected] = useState(null);
  const { data, loading, error } = useAsync('club_feed', { content_kind: kind, page_offset: page * 12 });
  const rows = compact ? (data?.rows || []).slice(0, 3) : data?.rows || [];
  const materials = useMediaUrls(rows.flatMap(row => row.media.filter(item => item.cover)));
  const communications = contentKind === 'communication';
  return <section className="club-feed"><div className="feed-heading"><div><span className="eyebrow">{communications ? 'RESTA IN CONTATTO' : 'DA SCOPRIRE NEL CLUB'}</span>{compact ? <h2>{communications ? 'Comunicazioni' : 'Novità e offerte'}</h2> : <h1>{communications ? 'Le comunicazioni del Club.' : 'Novità e offerte.'}</h1>}</div>{compact && <a className="text-button" href={communications ? '/comunicazioni' : '/novita'}>Vedi tutte<ArrowRight size={16} /></a>}</div>{!compact && !communications && <div className="segmented">{[['highlights', 'Tutte'], ['news', 'Novità'], ['offer', 'Offerte']].map(([value, label]) => <button key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setPage(0); }}>{label}</button>)}</div>}<Alert error={error} />{loading ? <Loading /> : <div className="feed-grid">{rows.map(row => { const cover = row.media.find(item => item.cover && item.kind === 'immagine'); return <button className="feed-card" type="button" key={row.id} onClick={() => setSelected(row.id)}>{cover ? <MediaCover src={materials.urls[cover.id]} title={row.title} /> : <div className="feed-art">{row.kind === 'communication' ? <Megaphone size={34} /> : <Sparkles size={34} />}</div>}<div><span className="eyebrow">{contentLabels[row.kind]} · {date(row.starts_at)}</span><h3>{row.title}</h3><p>{row.summary}</p><span className="text-button">Leggi<ArrowRight size={15} /></span></div></button>; })}</div>}{!loading && !rows.length && !error && <div className="feed-empty"><p>{communications ? 'Le comunicazioni pubblicate dal Club saranno disponibili qui.' : 'Le prossime novità e offerte del Club compariranno qui.'}</p></div>}{!compact && (page > 0 || (data?.total || 0) > 12) && <div className="pagination"><button className="button" disabled={!page || loading} onClick={() => setPage(page - 1)}>Precedenti</button><span>Pagina {page + 1}</span><button className="button" disabled={loading || (page + 1) * 12 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>Successivi</button></div>}{selected && <PostDetail id={selected} onClose={() => setSelected(null)} />}</section>;
}

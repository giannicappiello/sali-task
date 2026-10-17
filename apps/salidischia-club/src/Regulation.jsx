import { useState } from 'react';
import { date } from './client';
import { Alert, Loading } from './ui';
import useAsync from './useAsync';

export default function Regulation() {
  const [kind, setKind] = useState(() => new URLSearchParams(location.search).get('documento') === 'privacy' ? 'privacy' : 'program');
  const [version, setVersion] = useState(() => new URLSearchParams(location.search).get('version') || null);
  const { data, error, loading } = useAsync('club_public_document', { document_kind: kind, document_version: version });
  function choose(value) { setKind(value);setVersion(null);history.replaceState(null, '', '/regolamento?documento=' + value); }
  return <section className="regulation-page"><div className="page-heading"><span className="eyebrow">SALI DI ISCHIA CLUB</span><h1>Regolamento e privacy.</h1><p>Le informazioni del programma, sempre consultabili.</p></div><div className="segmented"><button type="button" aria-pressed={kind === 'program'} onClick={() => choose('program')}>Regolamento</button><button type="button" aria-pressed={kind === 'privacy'} onClick={() => choose('privacy')}>Privacy</button></div><Alert error={error} />{loading ? <Loading /> : data ? <article className="panel document-copy"><h2>{data.title}</h2><p className="subtle">Versione pubblicata il {date(data.published_at)} · {data.id}</p>{data.body.split(/\n\s*\n/).map((paragraph, index) => paragraph.startsWith('## ') ? <h3 key={index}>{paragraph.slice(3)}</h3> : paragraph.startsWith('# ') ? <h2 key={index}>{paragraph.slice(2)}</h2> : <p key={index}>{paragraph}</p>)}</article> : !error && <p className="notice">Il documento è in preparazione. Sarà disponibile qui prima dell’apertura delle iscrizioni.</p>}<a className="button" href="/">Torna al Club</a></section>;
}

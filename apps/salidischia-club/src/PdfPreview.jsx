import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { usePortalAuth } from './usePortalApi';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ id, title }) {
  const auth = usePortalAuth(), canvas = useRef(null), container = useRef(null);
  const [pdf, setPdf] = useState(null), [page, setPage] = useState(1), [width, setWidth] = useState(300);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, Math.floor(entries[0].contentRect.width))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true, task;
    const controller = new AbortController();
    async function load() {
      try {
        const {data} = await auth.getSession();
        const headers = {'Content-Type':'application/json'};
        if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
        const response = await fetch('/api/club-pdf-preview', {method:'POST',headers,body:JSON.stringify({document_id:id}),signal:controller.signal});
        if (!response.ok) throw Error((await response.json()).error || 'Anteprima PDF non disponibile.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!active) return;
        task = getDocument({data:bytes,isEvalSupported:false});
        const document = await task.promise;
        if (active) { setPdf(document);setPage(1); }
      } catch (failure) { if (active) { setError(failure.message);setLoading(false); } }
    }
    void load();
    return () => { active = false;controller.abort();void task?.destroy(); };
  }, [id, auth]);
  useEffect(() => {
    if (!pdf) return;
    let active = true, render;
    async function draw() {
      try {
        const sheet = await pdf.getPage(page);
        if (!active) return;
        setLoading(true);setError('');
        const viewport = sheet.getViewport({scale:width / sheet.getViewport({scale:1}).width});
        const ratio = Math.min(window.devicePixelRatio || 1, 2), node = canvas.current;
        node.width = Math.floor(viewport.width * ratio);node.height = Math.floor(viewport.height * ratio);
        render = sheet.render({canvasContext:node.getContext('2d'),viewport,transform:ratio === 1 ? undefined : [ratio,0,0,ratio,0,0]});
        await render.promise;
        if (active) setLoading(false);
      } catch (failure) { if (active) { setError(failure.message);setLoading(false); } }
    }
    void draw();
    return () => { active = false;render?.cancel(); };
  }, [pdf, page, width]);
  return <div className="product-pdf" ref={container}>{loading && <p role="status">Caricamento anteprima PDF…</p>}{error && <p role="alert">{error}</p>}{pdf && <div className="pdf-page-controls"><button type="button" className="icon-button" aria-label="Pagina PDF precedente" disabled={page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={18} /></button><span>Pagina {page} di {pdf.numPages}</span><button type="button" className="icon-button" aria-label="Pagina PDF successiva" disabled={page >= pdf.numPages} onClick={() => setPage(n => n + 1)}><ChevronRight size={18} /></button></div>}<canvas ref={canvas} aria-label={`${title}, pagina ${page}`} role="img" hidden={!!error} /></div>;
}

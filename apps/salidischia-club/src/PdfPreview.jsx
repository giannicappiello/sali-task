import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GlobalWorkerOptions, PDFDataRangeTransport, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './client';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ id, title }) {
  const auth = supabase.auth, canvas = useRef(null), container = useRef(null);
  const [pdf, setPdf] = useState(null), [page, setPage] = useState(1), [width, setWidth] = useState(300);
  const [thumbnail, setThumbnail] = useState('');
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
        async function readSlice(start, end) {
          const response = await fetch('/api/club-pdf-preview', {method:'POST',headers,body:JSON.stringify({document_id:id,start,end}),signal:controller.signal});
          if (!response.ok) throw Error((await response.json()).error || 'Anteprima PDF non disponibile.');
          const length = Number(/\/(\d+)$/.exec(response.headers.get('content-range') || '')?.[1]);
          if (!length) throw Error('Anteprima PDF non disponibile.');
          return {bytes:new Uint8Array(await response.arrayBuffer()),length};
        }
        async function readRange(start, end) {
          if (end - start <= 1048576) return readSlice(start,end);
          const slices = [];
          for (let begin = start;begin < end;begin += 1048576) slices.push([begin,Math.min(end,begin + 1048576)]);
          const parts = [];
          for (let i = 0;i < slices.length;i += 4) parts.push(...await Promise.all(slices.slice(i,i + 4).map(([begin,finish]) => readSlice(begin,finish))));
          const bytes = new Uint8Array(parts.reduce((total,part) => total + part.bytes.length,0));
          let offset = 0;for (const part of parts) {bytes.set(part.bytes,offset);offset += part.bytes.length;}
          return {bytes,length:parts[0].length};
        }
        const first = await readRange(0,262144);
        if (!active) return;
        if (first.length > 20 * 1024 * 1024) {
          const embedded = /<xmpGImg:image>([\s\S]*?)<\/xmpGImg:image>/i.exec(new TextDecoder().decode(first.bytes))?.[1];
          const jpeg = embedded?.replace(/&#x0*a;|&#0*10;|\s/gi,'');
          if (jpeg && jpeg.length < 300000 && /^[A-Za-z0-9+/]+={0,2}$/.test(jpeg)) {
            setThumbnail('data:image/jpeg;base64,' + jpeg);setLoading(false);return;
          }
        }
        class DocumentRange extends PDFDataRangeTransport {
          requestDataRange(begin, end) {
            void readRange(begin,end).then(({bytes}) => {if (active) this.onDataRange(begin,bytes);}).catch(failure => {if (active) {setError(failure.message);setLoading(false);void task?.destroy();}});
          }
          abort() { controller.abort(); }
        }
        // No progressive stream follows the initial block; remaining bytes arrive through ranges.
        const range = new DocumentRange(first.length,first.bytes,true);
        task = getDocument({range,rangeChunkSize:262144,disableAutoFetch:true,disableStream:true,isEvalSupported:false});
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
  return <div className="product-pdf" ref={container}>{loading && <p role="status">Caricamento anteprima PDF…</p>}{error && <p role="alert">{error}</p>}{pdf && <div className="pdf-page-controls"><button type="button" className="icon-button" aria-label="Pagina PDF precedente" disabled={page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={18} /></button><span>Pagina {page} di {pdf.numPages}</span><button type="button" className="icon-button" aria-label="Pagina PDF successiva" disabled={page >= pdf.numPages} onClick={() => setPage(n => n + 1)}><ChevronRight size={18} /></button></div>}{thumbnail && <><img className="pdf-embedded-thumbnail" src={thumbnail} alt={`Anteprima PDF: ${title}`} /><p className="subtle">Anteprima del documento. Apri il PDF completo per consultarlo in dettaglio.</p></>}<canvas ref={canvas} aria-label={`${title}, pagina ${page}`} role="img" hidden={!!error || !!thumbnail} /></div>;
}

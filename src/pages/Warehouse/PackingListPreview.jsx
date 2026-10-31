import {useEffect,useRef,useState} from 'react';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

function PdfPage({pdf,number,zoom}) {
  const host=useRef(null),canvas=useRef(null);
  const [width,setWidth]=useState(0),[error,setError]=useState(''),[visible,setVisible]=useState(false);
  useEffect(()=>{
    const element=host.current;
    const observer=new ResizeObserver(()=>setWidth(Math.floor(element.clientWidth)));
    observer.observe(element);setWidth(Math.floor(element.clientWidth));
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{root:host.current.closest('.op-pdf-pages'),rootMargin:'400px'});
    observer.observe(host.current);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!width || !visible)return;
    let active=true,render;
    void (async()=>{
      try {
        const page=await pdf.getPage(number);
        if(!active)return;
        const base=page.getViewport({scale:1});
        const viewport=page.getViewport({scale:width/base.width*Math.min(window.devicePixelRatio || 1,2)});
        const target=canvas.current;
        target.width=Math.ceil(viewport.width);target.height=Math.ceil(viewport.height);
        render=page.render({canvasContext:target.getContext('2d'),viewport});
        await render.promise;
      }catch(cause){if(active && cause.name!=='RenderingCancelledException')setError('Pagina non visualizzabile: '+cause.message);}
    })();
    return ()=>{active=false;render?.cancel();};
  },[pdf,number,width,visible]);
  return <article className="op-pdf-page" ref={host} style={{width:`${zoom}%`,aspectRatio:"210 / 297"}}>{error ? <p role="alert">{error}</p> : <canvas ref={canvas} role="img" aria-label={`Packing list, pagina ${number}`}/>}</article>;
}

export default function PackingListPreview({bytes,fileName="Packing-list.pdf",onClose}) {
  const dialog=useRef(null);
  const downloadLink=useRef(null);
  useEffect(()=>{
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    downloadLink.current.href=url;
    return ()=>URL.revokeObjectURL(url);
  },[bytes]);
  const [pdf,setPdf]=useState(null),[error,setError]=useState(''),[zoom,setZoom]=useState(100);
  useEffect(()=>{
    const element=dialog.current;element.showModal();
    return ()=>element.close();
  },[]);
  useEffect(()=>{
    let active=true,task;
    void (async()=>{
      try {
        const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
        if(!active)return;
        pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
        task=pdfjs.getDocument({data:new Uint8Array(bytes.slice(0)),useSystemFonts:true,isEvalSupported:false});
        const loaded=await task.promise;if(active)setPdf(loaded);
      }catch(cause){if(active)setError('Anteprima non disponibile: '+cause.message);}
    })();
    return ()=>{active=false;void task?.destroy().catch(()=>{});};
  },[bytes]);
  return <dialog ref={dialog} className="op-packing-preview" data-report-export="" aria-label="Packing list" onCancel={event=>{event.preventDefault();onClose();}}>
    <header><strong>Packing list{pdf?` · ${pdf.numPages} ${pdf.numPages===1?'pagina':'pagine'}`:''}</strong><div className="op-pdf-actions"><a ref={downloadLink} className="op-pdf-download" download={fileName}>Download PDF</a><button type="button" onClick={onClose}>Chiudi anteprima</button></div></header>
    <div className="op-pdf-zoom" aria-label="Ingrandimento packing list"><button type="button" aria-label="Riduci ingrandimento" disabled={zoom<=75} onClick={()=>setZoom(value=>value-25)}>−</button><span>{zoom}%</span><button type="button" aria-label="Aumenta ingrandimento" disabled={zoom>=300} onClick={()=>setZoom(value=>value+25)}>+</button></div>
    <section className="op-pdf-pages" aria-label="Pagine della packing list">
      {error && <p role="alert">{error}</p>}
      {!pdf && !error && <p role="status">Caricamento packing list…</p>}
      {pdf && Array.from({length:pdf.numPages},(_,i)=><PdfPage key={i+1} pdf={pdf} number={i+1} zoom={zoom}/>)}
    </section>
  </dialog>;
}

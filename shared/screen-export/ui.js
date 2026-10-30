import { activeDialogs, captureCompleteReport, exclusiveReportRead } from './capture.js';
import { appendReportTotals, installTableTotals } from './totals.js';

const icon = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/></svg>';
const style = `.progre-export-trigger{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:36px;min-height:36px;margin-inline:4px;padding:6px 9px;border:1px solid #cfe0f6;border-radius:9px;background:#eef6ff;color:#1253a4;font:inherit;cursor:pointer}.topbar .progre-export-trigger,.mes-unified-topbar .progre-export-trigger{background:transparent;color:inherit;border-color:currentColor}.progre-export-dialog{position:fixed;inset:0;width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 40px);margin:auto;padding:24px;border:1px solid #cadbf0;border-radius:16px;background:white;color:#1f2d44;box-shadow:0 16px 60px #11264055;font:15px/1.5 Arial,sans-serif}.progre-export-dialog::backdrop{background:#11264077}.progre-export-dialog h2{font-size:22px;margin:0 0 12px;color:#112640}.progre-export-dialog p{overflow-wrap:anywhere}.progre-export-options{display:flex;flex-wrap:wrap;gap:10px;margin-block:18px}.progre-export-dialog button{font:inherit;padding:9px 14px;border:1px solid #ccd9e6;border-radius:8px;background:#f3f7fb;color:#112640;cursor:pointer}.progre-export-dialog button:disabled{opacity:.5;cursor:wait}.progre-export-status{min-height:24px}.progre-export-dialog [role=alert]{color:#a32626}.progre-export-dialog>footer{display:flex;justify-content:flex-end}.progre-export-trigger:focus-visible,.progre-export-dialog button:focus-visible{outline:3px solid #169158;outline-offset:3px}@media(max-width:620px){.progre-export-trigger span{display:none}.progre-export-trigger{padding:6px}}`;

function download(blob, fileName, doc) {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a'); link.href = url; link.download = fileName;
  doc.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function logoData(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Logo Progre non disponibile. Riprova l’esportazione.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return { bytes, dataUrl: `data:image/png;base64,${btoa(binary)}` };
}

export function installScreenExport({ doc = document, system = 'Workspace', logoUrl = '/progre-logo-white.png', composePdf, frameOrigin, requireAuthentication = false } = {}) {
  if (doc.documentElement.dataset.progreExportInstalled) return () => {};
  doc.documentElement.dataset.progreExportInstalled = 'true';
  const css = doc.createElement('style'); css.dataset.reportExport = ''; css.textContent = style; doc.head.append(css);
  css.textContent += 'tfoot[data-report-totals] th,tfoot[data-report-totals] td{padding:10px;border-top:1px solid #cadbf0;background:#eef7f3;color:#112640;font-weight:700;white-space:normal}tfoot[data-report-totals] tr:last-child>*{background:#e2edf5;border-top:2px solid #112640}.progre-totals-reading{opacity:.3;pointer-events:none}.progre-totals-progress{position:fixed;z-index:2147483646;left:50%;bottom:24px;transform:translateX(-50%);padding:14px 20px;border-radius:12px;background:#112640;color:white;box-shadow:0 8px 30px #11264055;font:14px Arial,sans-serif;max-width:90vw;text-align:center}';
  const stopTotals=installTableTotals({doc});
  let currentDialog;
  const launch = surface => {
    if (currentDialog?.isConnected) return;
    const popup = surface || activeDialogs(doc).at(-1);
    const root = popup || doc.querySelector('.content-area') || doc.querySelector('main .content') || doc.querySelector('main');
    if (!root) return;
    // MES renders in a separate origin: let its own capture use the real DOM,
    // cookies and authorization, rather than exporting the outer iframe shell.
    const frame = root.querySelector('iframe[data-assistant-mes-frame]');
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({type:'progre:export-screen'}, new URL(frame.src, doc.location.href).origin); return;
    }
    const title = (popup ? popup.querySelector('h1,h2,h3')?.textContent || popup.getAttribute('aria-label') : doc.querySelector('.topbar h1,.mes-unified-topbar h1,main h1')?.textContent) || doc.title || system;
    const dialog = doc.createElement('dialog'); currentDialog = dialog;
    dialog.dataset.reportExport = ''; dialog.className = 'progre-export-dialog'; dialog.setAttribute('aria-labelledby','progre-export-title');
    dialog.innerHTML = '<h2 id="progre-export-title">Esporta report Progre</h2><p class="progre-export-title"></p><p>Formato A4 · modello report AI Progre. Riproduce card, grafici, testi e disposizione della schermata, includendo tutte le pagine degli elenchi. Excel include anche il foglio Dati completi.</p><div class="progre-export-options"><button type="button" data-format="xlsx">Excel (.xlsx)</button><button type="button" data-format="docx">Word (.docx)</button><button type="button" data-format="pdf">PDF (.pdf)</button></div><p class="progre-export-status" role="status" aria-live="polite"></p><footer><button type="button" data-close>Chiudi</button></footer>';
    dialog.querySelector('.progre-export-title').textContent = title;
    const status = dialog.querySelector('[role=status]');
    let controller;
    const close = () => { controller?.abort(); if (!controller) { dialog.close(); dialog.remove(); currentDialog = null; } };
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', async () => {
      controller = new AbortController();
      dialog.querySelectorAll('[data-format]').forEach(node => { node.disabled = true; });
      dialog.querySelector('[data-close]').textContent = 'Interrompi'; status.setAttribute('role','status');
      status.textContent = 'Preparazione del report completo…';
      try {
        const report = await exclusiveReportRead(async () => {
          const {renderVisualPages} = await import('./visual.js');
          const options={root,title,system,signal:controller.signal,progress:text=>{status.textContent=text;},visual:true};
          const result=appendReportTotals(await captureCompleteReport(options));
          result.visualPages=await renderVisualPages(result,options);
          return result;
        },doc);
        controller.signal.throwIfAborted(); status.textContent = 'Creazione del documento…';
        const [formats, logo] = await Promise.all([import('./formats.js'), logoData(logoUrl)]);
        let blob;
        if (button.dataset.format === 'xlsx') blob = formats.buildReportXlsx(report, logo.bytes);
        if (button.dataset.format === 'docx') blob = formats.buildReportDocx(report, logo.bytes);
        if (button.dataset.format === 'pdf') {
          if (composePdf) {
            const pdf = formats.buildReportPdf(report, {logoDataUrl:logo.dataUrl,managedLetterhead:true});
            try { blob = await composePdf(pdf.output('arraybuffer')); }
            catch (error) {
              if (error.code !== 'LETTERHEAD_NOT_CONFIGURED') throw error;
              blob = formats.buildReportPdf(report, {logoDataUrl:logo.dataUrl}).output('blob');
            }
          } else blob = formats.buildReportPdf(report, {logoDataUrl:logo.dataUrl}).output('blob');
        }
        controller.signal.throwIfAborted();
        download(blob, formats.reportFileName(report,button.dataset.format),doc);
        status.textContent = 'Report completo esportato.';
      } catch (error) {
        status.setAttribute('role','alert');
        status.textContent = error.name === 'AbortError' ? 'Esportazione interrotta. Nessun file generato.' : error.message || 'Esportazione non riuscita.';
      } finally {
        controller = null; dialog.querySelector('[data-close]').textContent = 'Chiudi';
        dialog.querySelectorAll('[data-format]').forEach(node => {node.disabled = false;});
      }
    }));
    doc.body.append(dialog); dialog.showModal();
  };
  const attach = (container, surface) => {
    if (!container || [...container.children].some(child => child.matches('.progre-export-trigger'))) return;
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'progre-export-trigger'; button.dataset.reportExport = '';
    button.setAttribute('aria-label',surface ? 'Esporta il contenuto completo del popup' : 'Esporta il contenuto completo della schermata');
    button.title = 'Esporta report Progre in Excel, Word o PDF'; button.innerHTML = icon + '<span>Esporta</span>';
    button.addEventListener('click', event => {event.stopPropagation(); launch(surface);});
    const ai = container.querySelector(':scope > .context-ai-trigger,:scope > .workspace-context-ai-trigger,:scope > .assistant-popup-trigger');
    if (ai) ai.after(button); else container.prepend(button);
  };
  let scheduled = false;
  const update = () => {
    scheduled = false;
    if (requireAuthentication && !doc.querySelector('[data-workspace-authenticated="true"]')) return;
    attach(doc.querySelector('.topbar-actions,.mes-chrome-actions'),null);
    for (const surface of activeDialogs(doc)) {
      attach(surface.querySelector('[data-assistant-actions],header,.modal-header,.mud-dialog-title') || surface,surface);
    }
  };
  const observer = new MutationObserver(() => {
    if (!scheduled) {scheduled = true; queueMicrotask(update);}
  });
  observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-hidden']});
  update();
  const message = event => {
    if (event.data?.type === 'progre:export-screen' && frameOrigin && event.origin === frameOrigin && event.source === window.parent) launch();
  };
  window.addEventListener('message',message);
  return () => { stopTotals();observer.disconnect(); window.removeEventListener('message',message); css.remove(); currentDialog?.remove(); doc.querySelectorAll('.progre-export-trigger').forEach(button => button.remove()); delete doc.documentElement.dataset.progreExportInstalled; };
}

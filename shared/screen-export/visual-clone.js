// Preserve the authorized rendered layout, without live controls or secrets.
const OMIT = 'script,style,noscript,iframe,[hidden],[data-report-export],[data-report-totals],[data-workspace-assistant],.workspace-context-ai-backdrop,.assistant-popup-trigger,.workspace-table-column-controls,.table-column-controls,[data-column-control]';
const SECRET = /password|passwd|secret|token|authorization|api.?key|credenzial/i;

export function cloneVisualContent(root, { isVisible, findPagers, replacements = new Map(), tableKeys = new Map() }) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const originals = [root, ...root.querySelectorAll('*')];
  const clone = root.cloneNode(true), copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((source, index) => {
    let target = copies[index];
    // Accessibility-hidden graphics (and SVG defs) still belong to the visual.
    const svg=source.closest('svg');
    const renderedGraphic=svg && svg.getClientRects().length>0 && view.getComputedStyle(svg).visibility!=='hidden';
    const ariaHiddenVisual=source.closest('[aria-hidden="true"]') && source.getClientRects().length>0 && view.getComputedStyle(source).visibility!=='hidden';
    if (source.closest(OMIT) || (!isVisible(source) && !renderedGraphic && !ariaHiddenVisual)) { target.remove(); return; }
    if (source.matches('input,textarea,select') && (['password','hidden','file'].includes(source.type) || SECRET.test([source.name,source.id,source.autocomplete,source.getAttribute('aria-label'),source.labels?.[0]?.textContent].join(' ')))) { target.remove(); return; }
    const css = view.getComputedStyle(source);
    for (let i=0;i<css.length;i++) { const property=css.item(i); target.style.setProperty(property, css.getPropertyValue(property)); }
    target.style.setProperty('animation','none'); target.style.setProperty('transition','none');
    target.style.setProperty('content-visibility','visible');
    if (css.position === 'fixed' || css.position === 'sticky') { target.style.position = 'static'; target.style.inset = 'auto'; }
    if (!source.matches('svg,svg *,canvas,img') && (source === root || source.scrollHeight > source.clientHeight + 2 || /auto|scroll|hidden/.test(css.overflowY) || source.querySelector('table'))) {
      target.style.height = 'auto'; target.style.maxHeight = 'none'; target.style.overflow = 'visible'; target.style.gridTemplateRows = 'none';
    }
    if (source.matches('canvas')) {
      const image = doc.createElement('img');
      try { image.src = source.toDataURL('image/png'); }
      catch { throw new Error('Un grafico contiene immagini protette e non può essere esportato fedelmente.'); }
      image.style.cssText = target.style.cssText; image.width = source.width; image.height = source.height;
      image.alt = source.getAttribute('aria-label') || 'Grafico'; target.replaceWith(image);
    } else if (source.matches('input,textarea,select')) {
      const value = doc.createElement('span'); value.style.cssText = target.style.cssText;
      value.textContent = source.tagName === 'SELECT' ? [...source.selectedOptions].map(option=>option.textContent).join(', ') : ['checkbox','radio'].includes(source.type) ? source.checked ? '☑' : '☐' : source.value;
      value.style.display = 'inline-block'; value.style.whiteSpace = 'pre-wrap'; target.replaceWith(value);
    } else if (source.matches('img')) {
      target.src = source.currentSrc || source.src; target.removeAttribute('srcset'); target.loading = 'eager';
    }
    for (const attr of [...target.attributes]) if (/^on/i.test(attr.name)) target.removeAttribute(attr.name);
    target.removeAttribute('autofocus'); target.removeAttribute('tabindex');
  });
  for (const pager of findPagers(root, isVisible)) copies[originals.indexOf(pager)]?.remove();
  for (const [table,key] of tableKeys) copies[originals.indexOf(table)]?.setAttribute('data-export-table-index',String(key));
  for (const [source,pages] of replacements) {
    const target = copies[originals.indexOf(source)];
    if (!target) throw new Error('La struttura della schermata è cambiata durante l’esportazione.');
    const container = doc.createElement('div');
    container.style.cssText = 'display:block;width:100%;height:auto;overflow:visible';
    pages.forEach(page=>container.append(page)); target.replaceWith(container);
  }
  clone.style.position = 'relative'; clone.style.inset = 'auto'; clone.style.margin = '0'; clone.style.transform = 'none';
  clone.style.width = `${Math.ceil(root.getBoundingClientRect().width)}px`;
  clone.style.maxWidth = 'none'; clone.style.height = 'auto'; clone.style.maxHeight = 'none'; clone.style.overflow = 'visible';
  return clone;
}

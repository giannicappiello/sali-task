// This module reads only the current authorized UI. Only pagination controls
// are followed; mutations, row actions and application APIs are never invoked.
export const DIALOGS = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open],.modal.show .modal-content,.mud-dialog,.production-batch-inspector,.modal-backdrop > .modal-card,.letterhead-modal > .letterhead-dialog,.private-upload-modal > form';
const OMIT = 'script,style,noscript,iframe,[hidden],[aria-hidden="true"],[data-report-export],[data-report-totals],[data-workspace-assistant],.workspace-context-ai-backdrop,.assistant-popup-trigger,.workspace-table-column-controls,.table-column-controls';
const SECRET = /password|passwd|secret|token|authorization|api.?key|credenzial/i;
const PAGERS = '[data-export-pagination],[class*="pagination"],[class*="Pagination"],.mud-table-pagination,nav[aria-label*="aginaz"],nav[aria-label*="agination"]';
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const textValue = node => node.nodeType === 3 ? node.textContent : [...node.childNodes].map(textValue).join(' ');
const headerText = cell => {
  const clone=cell.cloneNode(true);
  clone.querySelectorAll('[data-column-control],[aria-hidden="true"],input,select,textarea').forEach(node=>node.remove());
  return clean(textValue(clone));
};
export function tableHeaders(table) {
  const rows=[...table.querySelectorAll('thead > tr')].filter(row=>row.closest('table')===table);
  if(!rows.length){const first=table.querySelector('tr');return first?.querySelector('th')?[...first.children].map(headerText):[];}
  const grid=[];
  rows.forEach((row,r)=>{
    grid[r] ||= [];
    let column=0;
    for(const cell of row.children){
      while(grid[r][column]!==undefined)column++;
      for(let dr=0;dr<Math.max(1,cell.rowSpan);dr++)for(let dc=0;dc<Math.max(1,cell.colSpan);dc++){
        grid[r+dr] ||= [];grid[r+dr][column+dc]=headerText(cell);
      }
      column+=Math.max(1,cell.colSpan);
    }
  });
  return Array.from({length:Math.max(...grid.map(row=>row.length))},(_,c)=>[...new Set(grid.map(row=>row[c]).filter(Boolean))].join(' · '));
}
export const visible = node => !node.closest('[hidden],[aria-hidden="true"]') && node.getClientRects().length > 0 && node.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden';

export function activeDialogs(doc) {
  return [...doc.querySelectorAll(DIALOGS)].filter(node => visible(node) && !node.closest('[data-report-export],[data-workspace-assistant],.workspace-context-ai-backdrop'))
    .filter((node, _, all) => !all.some(other => other !== node && node.contains(other)));
}

export function cloneContent(root, isVisible = visible, replacements = new Map(), tableKeys = new Map()) {
  const clone = root.cloneNode(true);
  const originals = [root, ...root.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((source, i) => {
    const target = copies[i];
    if (source.matches(OMIT) || !isVisible(source)) { target.remove(); return; }
    if (source.matches('input,textarea,select')) {
      if (source.closest('thead') || ['password', 'hidden', 'file', 'submit', 'button'].includes(source.type) || SECRET.test([source.name, source.id, source.autocomplete, source.getAttribute('aria-label'), source.labels?.[0]?.textContent].join(' '))) { target.remove(); return; }
      const field = root.ownerDocument.createElement('span');
      field.textContent = source.tagName === 'SELECT' ? [...source.selectedOptions].map(option => option.textContent).join(', ')
        : ['checkbox', 'radio'].includes(source.type) ? (source.checked ? 'Sì' : 'No') : source.value;
      if (!source.closest('label,td')) field.textContent = `${source.labels?.[0]?.textContent || source.getAttribute('aria-label') || source.placeholder || source.name || 'Campo'}: ${field.textContent}`;
      target.replaceWith(field);
    }
    if (source.matches('button')) {
      if (source.closest('thead')) target.replaceWith(root.ownerDocument.createTextNode(source.textContent));
      else target.remove();
    }
    // Export values, never live markup, handlers, URLs or form submissions.
    for (const attr of [...target.attributes]) if (/^on/i.test(attr.name)) target.removeAttribute(attr.name);
  });
  clone.querySelectorAll(OMIT + ',' + PAGERS).forEach(node => node.remove());
  for (const pager of findPagers(root, isVisible)) copies[originals.indexOf(pager)]?.remove();
  [...(clone.matches('table') ? [clone] : []), ...clone.querySelectorAll('table')].forEach(table => {
    const headers = [...(table.querySelector('thead tr')?.children || [])];
    const actions = headers.flatMap((cell, index) => /^(azioni|operazioni|actions)$/i.test(clean(cell.textContent)) ? [index] : []);
    for (const row of table.querySelectorAll('tr')) for (const index of [...actions].reverse()) row.children[index]?.remove();
  });
  for (const [table, key] of tableKeys) copies[originals.indexOf(table)]?.setAttribute('data-export-table-index', String(key));
  for (const [source, pages] of replacements) {
    const target = copies[originals.indexOf(source)];
    if (!target) throw new Error('Elenco cambiato durante l’esportazione.');
    const container = root.ownerDocument.createElement('div');
    pages.forEach(page => container.append(page));
    target.replaceWith(container);
  }
  return clone;
}

export function contentBlocks(root) {
  const blocks = [];
  function walk(node) {
    if (node.nodeType === 3) { const text = clean(node.textContent); if (text) blocks.push({ type: 'text', text }); return; }
    if (node.nodeType !== 1) return;
    if (node.matches('table')) {
      const sourceRows = [...node.querySelectorAll('tr')].filter(row => row.closest('table') === node);
      const rows = sourceRows.map(row => [...row.children].filter(cell => cell.matches('td,th')).flatMap(cell => [clean(textValue(cell)),...Array(Math.max(1,cell.colSpan)-1).fill('')]));
      const headerCount = node.querySelectorAll('thead tr').length || (sourceRows[0]?.querySelector('th') ? 1 : 0);
      if (rows.length) blocks.push({ type: 'table', key: node.dataset.exportTableIndex, headers: headerCount ? tableHeaders(node) : [], rows: rows.slice(headerCount) });
      return;
    }
    if (node.matches('h1,h2,h3,h4,h5,h6,p,li,dt,dd,label,figcaption') && !node.querySelector('table,h1,h2,h3,p,li')) {
      const text = clean(textValue(node)); if (text) blocks.push({ type: node.matches('h1,h2,h3,h4,h5,h6') ? 'heading' : 'text', text });
      return;
    }
    for (const child of node.childNodes) walk(child);
  }
  walk(root);
  return blocks;
}

export function paginationControls(pager) {
  const controls = [...pager.querySelectorAll('button,a,[role="button"]')];
  const label = node => clean([node.getAttribute('aria-label'), node.title, node.textContent].join(' '));
  const prev = controls.find(node => /precedent|previous|indietro|pagina precedente|^\s*[‹«←]\s*$/i.test(label(node)));
  const next = controls.find(node => /successiv|seguente|next|avanti|^\s*[›»→]\s*$/i.test(label(node)));
  return { prev, next };
}
const disabled = node => !node || node.disabled || node.getAttribute('aria-disabled') === 'true' || node.closest('.disabled');

export function findPagers(root, isVisible = visible) {
  const candidates = new Set(root.querySelectorAll(PAGERS));
  // Legacy MES and Club use unmarked Bootstrap/toolbars rather than a shared
  // pager. Recognize them only with an explicit page indicator and both read
  // navigation labels; never treat month controls or wizard steps as pages.
  for (const button of root.querySelectorAll('button,a,[role="button"]')) {
    const label = clean(button.getAttribute('aria-label') || button.textContent);
    if (!/^(?:precedent|previous)/i.test(label)) continue;
    let container = button.parentElement;
    for (let depth = 0; depth < 3 && container && root.contains(container); depth++, container = container.parentElement) {
      if (!/(?:pagina|page)\s*\d/i.test(clean(container.textContent))) continue;
      const {prev,next} = paginationControls(container);
      if (prev && next) {candidates.add(container);break;}
    }
  }
  return [...candidates].filter(node => isVisible(node) && !node.closest('[data-report-export],[data-workspace-assistant]'))
    .filter(node => { const { prev, next } = paginationControls(node); return prev && next; })
    .filter((node, _, all) => !all.some(other => other !== node && node.contains(other)));
}

export function collectionFor(pager, root) {
  for (const direction of ['previousElementSibling','nextElementSibling']) {
    for (let node = pager[direction]; node; node = node[direction]) {
      if (node.matches('table,ul,ol,[data-export-collection]') || node.querySelector('table,article,[data-record-id],[role="listitem"]')) return node;
    }
  }
  // A pager may be nested in the table container (MudBlazor).
  for (let parent = pager.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
    const table = parent.querySelector('table');
    if (table && !table.contains(pager)) return table;
  }
  for (let node = pager.previousElementSibling; node; node = node.previousElementSibling) if (node.querySelector('label')) return node;
  throw new Error('Impossibile individuare l’elenco completo associato alla paginazione. Esportazione interrotta.');
}
function nodePath(root, node) {
  const path = [];
  while (node !== root) { if (!node.parentElement) throw new Error('Schermata cambiata durante l’esportazione.'); path.unshift([...node.parentElement.children].indexOf(node)); node = node.parentElement; }
  return path;
}
const atPath = (root, path) => path.reduce((node, index) => node?.children[index], root);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Preserve duplicate rows: each page is appended exactly once, never deduplicated
// by text. Repeated values are legitimate business records.
export async function captureCompleteReport({ root, title, system = 'Workspace', progress = () => {}, signal, isVisible = visible, settle = null }) {
  const started = Date.now();
  while ([...root.querySelectorAll('[aria-busy="true"],.loading,.crm-loading,.warehouse-loading,.loading-state')].some(isVisible)) {
    signal?.throwIfAborted();
    if (Date.now() - started > 45000) throw new Error('La schermata sta ancora caricando i dati. Riprova al termine del caricamento.');
    await delay(120);
  }
  const pagers = findPagers(root, isVisible);
  const initialPath = root.ownerDocument.location?.pathname;
  const replacements = [];
  for (let index = 0; index < pagers.length; index++) {
    const getPager = () => findPagers(root, isVisible)[index];
    const originalCollection = collectionFor(getPager(), root);
    const originalPath = nodePath(root, originalCollection);
    const pages = [];
    let displacement = 0;
    let primaryError;
    const move = async direction => {
      if (!root.isConnected || root.ownerDocument.location?.pathname !== initialPath) throw new Error('Schermata cambiata durante l’esportazione.');
      const pager = getPager();
      const control = paginationControls(pager)[direction];
      if (disabled(control)) return false;
      const before = clean(pager.textContent) + '\n' + collectionFor(pager, root).textContent;
      control.click(); displacement += direction === 'next' ? 1 : -1;
      if (settle) { await settle(); return true; }
      const started = Date.now(); let last = before; let stableSince = Date.now();
      while (Date.now() - started < 45000) {
        await delay(120);
        const current = getPager();
        if (!current) continue;
        const collection = collectionFor(current, root);
        const text = clean(current.textContent) + '\n' + collection.textContent;
        const scope = current.parentElement;
        const busy = scope.querySelector('[aria-busy="true"],.loading,.crm-loading,.warehouse-loading') || /caricamento\s*(?:…|\.\.\.)/i.test(scope.textContent);
        if (text !== last || busy) { last = text; stableSince = Date.now(); }
        if (!busy && text !== before && Date.now() - stableSince >= 650) return true;
      }
      throw new Error('Una pagina dell’elenco non è stata caricata. Nessun file parziale è stato generato.');
    };
    try {
      let steps = 0;
      while (!disabled(paginationControls(getPager()).prev)) { if (++steps > 10000) throw new Error('Paginazione non terminante.'); await move('prev'); }
      for (let page = 1; page <= 10000; page++) {
        signal?.throwIfAborted();
        progress(`Acquisizione elenco ${index + 1} di ${pagers.length}, pagina ${page}…`);
        pages.push(cloneContent(collectionFor(getPager(), root), isVisible, new Map(), new Map([...root.querySelectorAll('table')].map((table,i) => [table,i]))));
        if (disabled(paginationControls(getPager()).next)) {
          const position = clean(getPager().textContent).match(/(?:pagina|page)\s*(\d+)\s*(?:di|of|\/)\s*(\d+)/i);
          if (position && Number(position[1]) < Number(position[2])) throw new Error('L’elenco non è stato acquisito fino all’ultima pagina. Nessun file generato.');
          break;
        }
        if (page === 10000) throw new Error('Paginazione non terminante.');
        await move('next');
      }
    } catch (error) { primaryError = error; }
    finally {
      try {
        while (displacement !== 0) {
          const direction = displacement > 0 ? 'prev' : 'next';
          if (!await move(direction)) { primaryError ||= new Error('Impossibile ripristinare la pagina iniziale.'); break; }
        }
      } catch (error) { primaryError ||= error; }
    }
    if (primaryError) throw primaryError;
    replacements.push({ path: originalPath, pages });
  }
  const replaceMap = new Map(replacements.map(item => [atPath(root, item.path), item.pages]));
  const result = cloneContent(root, isVisible, replaceMap, new Map([...root.querySelectorAll('table')].map((table,i) => [table,i])));
  return { title: clean(title) || 'Report', system, generatedAt: new Date().toISOString(), blocks: contentBlocks(result) };
}

let readQueue = Promise.resolve();
export function exclusiveReportRead(task, doc = document) {
  const result = readQueue.catch(() => {}).then(async () => {
    doc.documentElement.dataset.progreReportReading = 'true';
    try { return await task(); }
    finally { delete doc.documentElement.dataset.progreReportReading; }
  });
  readQueue = result;
  return result;
}

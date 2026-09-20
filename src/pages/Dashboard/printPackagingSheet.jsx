import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PackagingSheet from './PackagingSheet';
import styles from './PackagingSheet.css?inline';

export async function printPackagingSheet(sheet) {
  const frame = document.createElement('iframe');
  frame.title = 'Documento di stampa foglio confezionamento';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { frame.remove(); reject(new Error('Preparazione stampa non riuscita. Riprova.')); }, 15000);
    frame.onload = () => {
      clearTimeout(timeout);
      try {
        frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
        frame.contentWindow.focus(); frame.contentWindow.print();
        // Some browsers omit afterprint. Keep the document until the dialog is finished.
        setTimeout(() => frame.remove(), 300000);
        resolve();
      } catch (error) { frame.remove(); reject(error); }
    };
    frame.srcdoc = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Foglio confezionamento</title><style>body{font-family:Arial,sans-serif;margin:16px}${styles}</style></head><body>${renderToStaticMarkup(createElement(PackagingSheet, { sheet }))}</body></html>`;
    document.body.appendChild(frame);
  });
}

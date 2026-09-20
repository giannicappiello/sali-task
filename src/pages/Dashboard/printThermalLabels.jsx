import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ThermalLabel from './ThermalLabel';
import styles from './ThermalLabel.css?inline';

export async function printThermalLabels(label, count, pieces) {
  if (!label || !Number.isInteger(count) || count < 1 || count > 1000 || !Number.isFinite(pieces) || pieces < 0)
    throw new Error('Dati etichetta non validi.');
  const markup = Array.from({ length: count }, (_, i) => renderToStaticMarkup(createElement(ThermalLabel, { label, count, pieces, index: i + 1 }))).join('');
  const frame = document.createElement('iframe');
  frame.title = 'Stampa etichette termiche'; frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { frame.remove(); reject(new Error('Preparazione stampa non riuscita. Riprova.')); }, 15000);
    frame.onload = () => {
      clearTimeout(timeout);
      try {
        frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
        frame.contentWindow.focus(); frame.contentWindow.print();
        setTimeout(() => frame.remove(), 300000); resolve();
      } catch (error) { frame.remove(); reject(error); }
    };
    frame.srcdoc = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Etichette termiche</title><style>${styles}</style></head><body>${markup}</body></html>`;
    document.body.appendChild(frame);
  });
}

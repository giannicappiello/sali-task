import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("il Workbench mantiene corpo, filtri e aggiornamento entro la testata", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./RdpWorkbench.jsx", import.meta.url), "utf8"),
    readFile(new URL("./production.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /className="secondary-action rdp-toolbar-refresh"/);
  assert.match(source, /className="rdp-quick-search"/);
  assert.match(source, /Ordini produzione MES/);
  assert.match(source, /\/produzione\/progremes\.Ordini\.Produzione/);
  assert.match(css, /\.rdp-workbench \{[^}]*max-width: 100%[^}]*overflow-x: hidden/);
  assert.match(css, /\.rdp-oct-line \{[^}]*minmax\(185px,1\.2fr\)/);
});

test("i fabbisogni usano ricerca totale, azioni PF in linea e tabella compatta", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./PurchaseRequirements.jsx", import.meta.url), "utf8"),
    readFile(new URL("./production.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /className="purchase-command-row"/);
  assert.match(source, /purchase-material-column/);
  assert.match(source, /purchase-status-column/);
  assert.match(source, /data-column-controls="off"/);
  assert.match(source, /Ricerca rapida totale/);
  assert.match(source, /Genera PF da selezionati/);
  assert.match(source, /mode: "selected"/);
  assert.match(source, /senza limite di 60 giorni/);
  assert.match(source, /Prepara PF Mexal/);
  assert.match(source, /purchasingAction: "PREVIEW_PF"/);
  assert.match(source, /purchasingAction: "CONFIRM_PF_PREVIEW"/);
  assert.match(source, /createPfPreviewPdfFiles/);
  assert.match(source, /Conferma ed emetti PF/);
  assert.match(source, /Genera PF automatico/);
  assert.match(source, /applySummaryFilter\("to_order"\)/);
  assert.match(source, /applySummaryFilter\("covered_arrivals"\)/);
  assert.match(source, /aria-pressed=\{summaryFilter/);
  assert.match(source, /purchase-button-info/);
  assert.match(css, /\.purchase-table-wrap table\{[^}]*min-width:1145px[^}]*font-size:\.69rem/);
  assert.match(css, /\.purchase-table-wrap \.number\{text-align:left/);
  assert.match(css, /\.purchase-summary button\.active/);
  assert.match(css, /\.purchase-month-actions>select\{[^}]*max-width:220px/);
  assert.match(css, /\.purchase-command-row \.purchase-calculation-note\{[^}]*font-size:\.76rem/);
  assert.match(css, /\.pf-preview-dialog\{/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { assistantReportFilename, assistantReportTitle, buildAssistantPdf, isPdfReportRequest } from "../src/pages/AIAssistant/assistantPdf.js";

const report = `# Report - Top 5 prodotti per fatturato netto scontato

**Periodo di copertura:** 01/01/2026 - 20/08/2026
**Criterio:** somma del valore netto, IVA esclusa

| Pos. | Codice | Prodotto | Fatturato netto scontato |
|---:|---|---|---:|
| 1 | IT0055 | CrioGel Gambe Stanche 500ml | 101.153,57 EUR |
| 2 | IT0083 | Bagno Doccia Mediterranean Sea 1000ml | 61.279,01 EUR |`;

test("riconosce una richiesta di report PDF scaricabile", () => {
  assert.equal(isPdfReportRequest("Elaborami un report in PDF scaricabile"), true);
  assert.equal(isPdfReportRequest("Creami un PDF"), true);
  assert.equal(isPdfReportRequest("Preparami il PDF"), true);
  assert.equal(isPdfReportRequest("Genera PDF"), true);
  assert.equal(isPdfReportRequest("Qual è il primo prodotto?"), false);
});

test("crea un PDF valido con titolo e tabella", () => {
  assert.equal(assistantReportTitle(report), "Report - Top 5 prodotti per fatturato netto scontato");
  assert.equal(assistantReportFilename(assistantReportTitle(report), new Date("2026-08-20T10:00:00Z")), "report-top-5-prodotti-per-fatturato-netto-scontato-2026-08-20.pdf");
  const pdf = buildAssistantPdf({ content: report, generatedAt: new Date("2026-08-20T10:00:00Z") });
  const bytes = pdf.output("arraybuffer");
  assert.ok(bytes.byteLength > 2000);
  assert.equal(pdf.getNumberOfPages(), 1);
});

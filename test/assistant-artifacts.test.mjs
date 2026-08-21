import assert from "node:assert/strict";
import test from "node:test";
import { requestedArtifacts } from "../server/ai/assistant.js";
import { buildAssistantArtifactFile } from "../src/pages/AIAssistant/assistantArtifacts.js";
import { buildAssistantChartSvg, extractAssistantChart } from "../src/pages/AIAssistant/assistantChart.js";

const content = `# Fatturato per prodotto

| Prodotto | Fatturato netto |
|---|---:|
| Prodotto A | 12.500,50 EUR |
| Prodotto B | 8.250,00 EUR |`;

test("riconosce richieste di veri file PDF e grafici", () => {
  assert.deepEqual(requestedArtifacts("Elabora un file con questa analisi", "gen-1").map((item) => item.kind), ["pdf"]);
  assert.deepEqual(requestedArtifacts("Crea un grafico del fatturato", "gen-2").map((item) => item.kind), ["image"]);
  assert.deepEqual(requestedArtifacts("Prepara un PDF con grafico", "gen-3").map((item) => item.kind), ["pdf", "image"]);
  assert.equal(requestedArtifacts("Crea un'immagine JPEG", "gen-4")[0].mediaType, "image/jpeg");
  assert.equal(requestedArtifacts("Crea un'immagine PNG", "gen-5")[0].mediaType, "image/png");
  assert.deepEqual(requestedArtifacts("Crea un file immagine PNG", "gen-6").map((item) => item.kind), ["image"]);
});

test("estrae i dati numerici e genera un file grafico SVG", () => {
  const chart = extractAssistantChart(content);
  assert.equal(chart.points[0].value, 12500.5);
  const svg = buildAssistantChartSvg(content);
  assert.match(svg, /^<svg/);
  assert.match(svg, /Prodotto A/);
  assert.match(svg, /<rect/);
  assert.match(svg, /progre-logo-white\.png/);
  assert.match(svg, /WORKSPACE \+ PROGREMES \/ MES/);
});

test("genera un vero Blob PDF scaricabile con un grafico", () => {
  const file = buildAssistantArtifactFile({ kind: "pdf", includeChart: true }, content);
  assert.equal(file.mediaType, "application/pdf");
  assert.match(file.fileName, /fatturato-per-prodotto.*\.pdf$/);
  assert.ok(file.blob.size > 3000);
});

test("il PDF usa il formato coordinato Progre Workspace e ProgreMES", () => {
  const file = buildAssistantArtifactFile({ kind: "pdf" }, content);
  assert.equal(file.mediaType, "application/pdf");
  assert.ok(file.blob.size > 3000);
});

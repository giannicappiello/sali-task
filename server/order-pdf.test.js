import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { jsPDF } from "jspdf";
import { buildOrderPdfModel, createMexalDocumentPdfFiles, createOrderPdf, createZipArchive, downloadOrderPdf, fitTextInCell, formatMexalDocumentNumber, getMexalDocuments } from "../src/modules/orders/services/orderPdf.js";

test("il modello PDF usa il motore economico condiviso per quindici righe", () => {
  const lines = Array.from({ length: 15 }, (_, index) => ({ codice_articolo: `A-${index}`, quantita: 2, prezzo_listino: 10, sconto_commerciale: "10", aliquota_iva: 22 }));
  const model = buildOrderPdfModel({ mexal_documents: [{ tipo_documento: "OCM", serie: 1, numero: "16531" }, { tipo_documento: "OCI", serie: 3, numero: "456" }] }, lines);
  assert.equal(model.lines.length, 15);
  assert.equal(model.totals.totale_imponibile, 270);
  assert.equal(model.totals.totale_iva, 59.4);
  assert.equal(model.totals.totale_documento, 329.4);
  assert.equal(model.vat.length, 1);
  assert.deepEqual(model.documents, [{ type: "OCM", serie: "1", numero: "16531" }, { type: "OCI", serie: "3", numero: "456" }]);
});

test("il PDF usa il numero completo del documento Mexal e mantiene Workspace solo come riferimento", async () => {
  const document = { type: "OCM", serie: "1", numero: "16531" };
  const pdf = await createOrderPdf({ data_ordine: "2026-07-20", numero_ordine_visualizzato: "3/2026", mexal_documents: [{ tipo_documento: "OCM", serie: 1, numero: "16531" }] }, [{ codice_articolo: "A", quantita: 1, prezzo_listino: 1 }], { logo: false, document });
  const output = pdf.output();
  assert.match(output, /DOCUMENTO/);
  assert.match(output, /Ordine cliente OCM/);
  assert.match(output, /NUMERO DOCUMENTO/);
  assert.match(output, /OCM 1\/16531/);
  assert.match(output, /RIFERIMENTO WORKSPACE/);
  assert.match(output, /3\/2026/);
  assert.doesNotMatch(output, /NUMERO ORDINE WORKSPACE/);
});

test("il riferimento Workspace termina prima della tabella articoli", async () => {
  const source = await readFile(new URL("../src/modules/orders/services/orderPdf.js", import.meta.url), "utf8");
  assert.match(source, /const ARTICLE = \{ top: 94, bottom: 210, header: 6, row: 8 \}/);
  assert.match(source, /y \+ 48, right - mid, 10, "Riferimento Workspace"/);
  assert.match(source, /const articleTop = continuation \? 29 : ARTICLE\.top/);
});

test("i documenti OCM e OCX mantengono serie e numero distinti", async () => {
  const order = { mexal_documents: [{ tipo_documento: "OCM", serie: 1, numero: "16531" }, { tipo_documento: "OCX", serie: 2, numero: "123" }] };
  const documents = getMexalDocuments(order);
  assert.deepEqual(documents.map(formatMexalDocumentNumber), ["OCM 1/16531", "OCX 2/123"]);
  for (const document of documents) {
    const pdf = await createOrderPdf(order, [{ codice_articolo: "A", quantita: 1, prezzo_listino: 10 }], { logo: false, document });
    const output = pdf.output();
    assert.match(output, new RegExp(formatMexalDocumentNumber(document)));
    assert.doesNotMatch(output, /PREZZO\) Tj\n\(OC[MXI]/);
  }
});

test("un solo documento scarica un PDF, più documenti un solo ZIP con tutti i PDF", async () => {
  const one = { numero_ordine_visualizzato: "3/2026", mexal_documents: [{ tipo_documento: "OCM", serie: 1, numero: "16531" }] };
  const multiple = { numero_ordine_visualizzato: "3/2026", mexal_documents: [{ tipo_documento: "OCM", serie: 1, numero: "16531" }, { tipo_documento: "OCX", serie: 1, numero: "16532" }, { tipo_documento: "OCI", serie: 1, numero: "16533" }] };
  const lines = [{ codice_articolo: "IT-1", quantita: 3, quantita_ocm: 2, quantita_ocx: 1, prezzo_listino: 10 }, { codice_articolo: "IMP-1", quantita: 4, prezzo_listino: 5 }];
  const singleDownloads = [];
  const single = await downloadOrderPdf(one, lines, { save: (_blob, name) => singleDownloads.push(name) });
  assert.equal(single.type, "pdf");
  assert.deepEqual(singleDownloads, ["ordine-OCM-1-16531.pdf"]);
  const files = await createMexalDocumentPdfFiles(multiple, lines);
  assert.deepEqual(files.map(({ name }) => name), ["ordine-OCM-1-16531.pdf", "ordine-OCX-1-16532.pdf", "ordine-OCI-1-16533.pdf"]);
  const archive = createZipArchive(files);
  assert.equal(new DataView(archive.buffer).getUint32(0, true), 0x04034b50, "ZIP local header");
  const text = new TextDecoder().decode(archive);
  files.forEach(({ name }) => assert.match(text, new RegExp(name.replaceAll(".", "\\."))));
  const downloads = [];
  const result = await downloadOrderPdf(multiple, lines, { save: (_blob, name) => downloads.push(name) });
  assert.equal(result.type, "zip");
  assert.deepEqual(downloads, ["ordine-3-2026-documenti-mexal.zip"]);
});

test("il PDF con almeno quindici righe gestisce più pagine e intestazioni", async () => {
  const lines = Array.from({ length: 45 }, (_, index) => ({ codice_articolo: `A-${index}`, descrizione: `Articolo molto descrittivo ${index}`, quantita: 1, prezzo_listino: 10, aliquota_iva: 22 }));
  const pdf = await createOrderPdf({ id: "ordine-test", data_ordine: "2026-07-20" }, lines, { logo: false });
  assert.ok(pdf.internal.getNumberOfPages() > 1);
  const output = pdf.output();
  assert.match(output, /ARTICOLO/);
  assert.match(output, /FIRMA VETTORE/);
  assert.match(output, /TOTALE DA PAGARE/);
});

test("il layout usa il listino nell'importo e non inventa dati logistici", async () => {
  const order = { id: "ordine-listino", data_ordine: "2026-07-20", commenti: "Consegna mattina" };
  const lines = [{ codice_articolo: "A-1", quantita: 2, prezzo_listino: 100, sconto_commerciale: "50+35+5", aliquota_iva: 22 }];
  const model = buildOrderPdfModel(order, lines);
  assert.equal(model.totale_merce, 200);
  assert.equal(model.totals.totale_imponibile, 61.75);
  const pdf = await createOrderPdf(order, lines, { logo: false });
  const output = pdf.output();
  assert.match(output, /200,00/);
  assert.match(output, /50\+35/);
  assert.match(output, /\+5/);
  assert.match(output, /22/);
  assert.doesNotMatch(output, /a cura del vettore \/ come da accordi/);
});

test("adatta UUID e note lunghi senza oltrepassare le rispettive celle", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const result = fitTextInCell(doc, "70d8b2f6-9108-4163-af87-07e52e343862", 10, 10, 30, 7, { fontSize: 7, minFontSize: 5, maxLines: 2 });
  assert.ok(result.lines.length <= 2);
  assert.ok(result.fontSize <= 7);
  assert.ok(result.fontSize >= 5);
});

test("il riepilogo mantiene acconto e abbuono vuoti e calcola il dovuto", async () => {
  const order = { id: "ordine-vuoto", data_ordine: "2026-07-20", commenti: "Nota Workspace molto lunga da contenere esclusivamente nella cella note senza invadere i campi logistici" };
  const lines = [{ codice_articolo: "A-1", quantita: 1, prezzo_listino: 100, aliquota_iva: 22 }];
  const pdf = await createOrderPdf(order, lines, { logo: false });
  const output = pdf.output();
  assert.match(output, /TOTALE DA PAGARE/);
  assert.doesNotMatch(output, /ACCONTO\) Tj\n\(122,00/);
  assert.doesNotMatch(output, /ABBUONO\) Tj\n\(122,00/);
  assert.match(output, /122,00/);
});

test("usa una griglia IVA separata e un logo di intestazione realmente maggiorato", async () => {
  const source = await readFile(new URL("../src/modules/orders/services/orderPdf.js", import.meta.url), "utf8");
  assert.match(source, /const maxWidth = continuation \? 44 : 72/);
  assert.match(source, /doc\.getImageProperties\(logo\)/);
  assert.match(source, /80128 Napoli \(NA\)/);
  assert.doesNotMatch(source, /80122 Napoli/);
  assert.match(source, /const vatX = 52; const vatY = y \+ 20; const vatW = 104/);
  assert.match(source, /width: 16[\s\S]*width: 20[\s\S]*width: 24[\s\S]*width: 22[\s\S]*width: 22/);
  assert.doesNotMatch(source, /order\.acconto \? money\(model\.totals\.totale_documento\)/);
  assert.doesNotMatch(source, /order\.abbuono \? money\(model\.totals\.totale_documento\)/);
});

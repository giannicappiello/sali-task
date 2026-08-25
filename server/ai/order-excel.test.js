import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseOrderWorkbook } from "./order-excel.js";

function workbookBuffer(sheets, hidden = []) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  if (hidden.length) workbook.Workbook = { Sheets: workbook.SheetNames.map((name) => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const rows = (customer, order, items) => [
  ["Cliente", customer],
  ["Numero ordine", order],
  ["Data ordine", "25/08/2026"],
  [],
  ["Codice", "Descrizione", "Qta", "EAN"],
  ...items,
];

test("importa un workbook Excel a foglio singolo", () => {
  const parsed = parseOrderWorkbook(workbookBuffer({
    Ordine: rows("Farmacia La Fenicia 2 s.a.s.", "383/2026", [["IT100", "Bodyque Coral Vitality", 48, "8050000000100"]]),
  }));
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.orders[0].customer.name, "Farmacia La Fenicia 2 s.a.s.");
  assert.equal(parsed.orders[0].lines[0].quantity, 48);
  assert.equal(parsed.orders[0].lines[0].sheetName, "Ordine");
  assert.equal(parsed.orders[0].lines[0].rowNumber, 6);
});

test("aggrega tre fogli dello stesso ordine preservando provenienza e celle originali", () => {
  const parsed = parseOrderWorkbook(workbookBuffer({
    Corpo: rows("Farmacia La Fenicia 2 s.a.s.", "383/2026", [["IT100", "Bodyque Coral Vitality", 48, ""]]),
    Viso: rows("Farmacia La Fenicia 2 s.a.s.", "383/2026", [["IT101", "Bodyque Mediterranean Sea", 36, ""]]),
    Capelli: rows("Farmacia La Fenicia 2 s.a.s.", "383/2026", [["IT102", "Bodyque Pure White", 12, ""]]),
  }, ["Viso"]));
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.orders[0].lines.length, 3);
  assert.deepEqual(parsed.orders[0].lines.map((line) => line.sheetName), ["Corpo", "Viso", "Capelli"]);
  assert.equal(parsed.orders[0].lines[0].sourceCells.productCode, "IT100");
  assert.equal(parsed.includedSheets.find((sheet) => sheet.sheetName === "Viso").hidden, 1);
});

test("separa ordini con clienti o numeri ordine differenti", () => {
  const parsed = parseOrderWorkbook(workbookBuffer({
    OrdineA: rows("Cliente Alfa Srl", "A-1", [["IT100", "Prodotto Alfa", 2, ""]]),
    OrdineB: rows("Cliente Beta Srl", "B-1", [["IT101", "Prodotto Beta", 3, ""]]),
    OrdineC: rows("Cliente Alfa Srl", "A-2", [["IT102", "Prodotto Gamma", 4, ""]]),
  }));
  assert.equal(parsed.orders.length, 3);
  assert.deepEqual(parsed.orders.map((order) => order.documentNumber), ["A-1", "B-1", "A-2"]);
});

test("ignora fogli vuoti e note con motivazione esplicita", () => {
  const parsed = parseOrderWorkbook(workbookBuffer({
    Ordine: rows("Cliente Alfa", "A-1", [["IT100", "Prodotto Alfa", 2, ""]]),
    Vuoto: [],
    Note: [["Istruzioni tecniche"], ["Non usare questa tabella come ordine"]],
  }));
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.excludedSheets.length, 2);
  assert.match(parsed.excludedSheets.find((sheet) => sheet.sheetName === "Vuoto").reason, /vuoto/i);
  assert.match(parsed.excludedSheets.find((sheet) => sheet.sheetName === "Note").reason, /tecnico|note/i);
});

test("salta intestazioni ripetute, subtotali, totali e righe di separazione", () => {
  const parsed = parseOrderWorkbook(workbookBuffer({
    Ordine: [
      ["Cliente", "Cliente Alfa"], ["Numero ordine", "A-1"], [],
      ["Articolo", "Descrizione", "Quantità"],
      ["IT100", "Prodotto Alfa", 2],
      ["Articolo", "Descrizione", "Quantità"],
      [],
      ["", "Subtotale", 2],
      ["IT101", "Prodotto Beta", 3],
      ["", "Totale", 5],
    ],
  }));
  assert.equal(parsed.orders[0].lines.length, 2);
  assert.deepEqual(parsed.orders[0].lines.map((line) => line.productCode), ["IT100", "IT101"]);
  assert.deepEqual(parsed.orders[0].lines.map((line) => line.quantity), [2, 3]);
});

test("supporta contenitori XLS, XLSX e XLSM della libreria disponibile", () => {
  for (const bookType of ["xls", "xlsx", "xlsm"]) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows("Cliente Alfa", "A-1", [["IT100", "Prodotto Alfa", 1, ""]])), "Ordine");
    const data = XLSX.write(workbook, { type: "buffer", bookType });
    assert.equal(parseOrderWorkbook(data, { fileName: `ordine.${bookType}` }).orders[0].lines.length, 1);
  }
});

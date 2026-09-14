import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { parseOrderFiles } from "./order-document.js";

function encoded(name, type, text = "file") {
  return { fileName: name, mediaType: type, fileBase64: `data:${type};base64,${Buffer.from(text).toString("base64")}` };
}

test("accetta più allegati ordine mantenendone la sequenza", () => {
  const files = parseOrderFiles({ files: [
    encoded("pagina-1.jpg", "image/jpeg", "uno"),
    encoded("pagina-2.png", "image/png", "due"),
  ] });
  assert.deepEqual(files.map((file) => file.filename), ["pagina-1.jpg", "pagina-2.png"]);
});

test("mantiene compatibilità con il payload a file singolo", () => {
  const files = parseOrderFiles(encoded("ordine.pdf", "application/pdf"));
  assert.equal(files.length, 1);
  assert.equal(files[0].mediaType, "application/pdf");
});

test("rifiuta più di otto allegati", () => {
  assert.throws(() => parseOrderFiles({ files: Array.from({ length: 9 }, (_, index) => encoded(`${index}.jpg`, "image/jpeg")) }), /massimo 8 file/);
});

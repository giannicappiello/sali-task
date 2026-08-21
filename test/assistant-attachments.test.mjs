import assert from "node:assert/strict";
import test from "node:test";
import { parseAssistantAttachments } from "../server/ai/assistant.js";

const pdf = { fileName: "ordine.pdf", mediaType: "application/pdf", fileBase64: Buffer.from("%PDF-1.4 prova").toString("base64") };

test("prepara un PDF per l'analisi senza conservarne la stringa base64", () => {
  const [part] = parseAssistantAttachments({ attachments: [pdf] }, { vision: true });
  assert.equal(part.type, "file");
  assert.equal(part.mediaType, "application/pdf");
  assert.equal(part.filename, "ordine.pdf");
  assert.ok(Buffer.isBuffer(part.data));
  assert.equal("fileBase64" in part, false);
});

test("blocca gli allegati quando il reparto non ha il riconoscimento documenti", () => {
  assert.throws(() => parseAssistantAttachments({ attachments: [pdf] }, { vision: false }), /non abilitata/);
});

test("rifiuta formati non ammessi", () => {
  assert.throws(() => parseAssistantAttachments({ attachments: [{ ...pdf, mediaType: "text/plain" }] }, { vision: true }), /Formato allegato non supportato/);
});

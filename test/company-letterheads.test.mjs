import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HEADING_AI_TOOLS } from "../server/ai/company-letterhead-actions.js";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { composeDocx, composePdf } from "../server/company-document-composer.js";

const migration = await readFile(new URL("../supabase/migrations/20260901180000_company_letterheads_controlled_actions.sql", import.meta.url), "utf8");
const signatureActivationMigration = await readFile(new URL("../supabase/migrations/20260901183000_activate_versioned_company_signatures.sql", import.meta.url), "utf8");
const page = await readFile(new URL("../src/pages/Settings/CompanyLetterheads.jsx", import.meta.url), "utf8");
const assistant = await readFile(new URL("../src/pages/AIAssistant/AIAssistant.jsx", import.meta.url), "utf8");
const mesApi = await readFile(new URL("../server/company-letterheads-mes-api.js", import.meta.url), "utf8");

test("registry AI espone letture e scritture tipizzate senza tool generici", () => {
  assert.equal(HEADING_AI_TOOLS.LIST_HEADINGS.risk, "read_only");
  assert.equal(HEADING_AI_TOOLS.CREATE_HEADING_RULE.risk, "write");
  assert.equal(HEADING_AI_TOOLS.DISABLE_HEADING_RULE.risk, "write");
  assert.equal(HEADING_AI_TOOLS.ATTACH_SIGNATURE_TO_HEADING.risk, "write");
  assert.equal(HEADING_AI_TOOLS.MES_DOCUMENT_GENERATE.risk, "write");
  assert.equal(Object.keys(HEADING_AI_TOOLS).length, 14);
  assert.equal(Object.values(HEADING_AI_TOOLS).some((tool) => tool.risk === "destructive"), false);
});

test("migration mantiene versioni, precedenza, audit, idempotenza e storage privato", () => {
  for (const table of ["company_letterheads", "company_letterhead_versions", "company_signatures", "company_signature_versions", "company_letterhead_signatures", "document_type_registry", "document_letterhead_rules", "generated_document_letterheads", "ai_action_registry", "ai_action_audit"]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /order by specificity desc,priority desc,updated_at desc,id limit 1/);
  assert.match(migration, /on conflict\(system,document_type_code,document_external_id\)/);
  assert.match(migration, /status='executed'/);
  assert.match(migration, /'company-letterheads','company-letterheads',false,26214400/);
  assert.doesNotMatch(migration, /grant .* on all tables in schema public/);
});

test("UI valida DOCX/PDF, rifiuta DOCM e conserva ogni nuova versione", () => {
  assert.match(page, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(page, /DOCM non è consentito/);
  assert.match(page, /company_letterhead_add_version/);
  assert.match(page, /company_letterhead_upsert_rule/);
  assert.match(page, /company_signature_add_version/);
  assert.match(page, /company_letterhead_attach_signature/);
  assert.match(page, /Configura con AI/);
});

test("la prima versione valida rende la firma utilizzabile dal resolver", () => {
  assert.match(signatureActivationMigration, /status=case when status='draft' then 'active'/);
  assert.match(signatureActivationMigration, /signature_version_created/);
});

test("Assistente mostra preview e conferma esplicita prima della scrittura", () => {
  assert.match(assistant, /correlationId: crypto\.randomUUID\(\)/);
  assert.match(assistant, /heading_decide/);
  assert.match(assistant, /Conferma e applica/);
  assert.match(assistant, /Rifiuta/);
});

test("compositore PDF mantiene il template e incorpora la firma immagine", async () => {
  const template = await PDFDocument.create();
  template.addPage([300, 400]).drawText("Intestazione ufficiale", { x: 20, y: 370 });
  const content = await PDFDocument.create();
  content.addPage([300, 400]).drawText("Contenuto documento", { x: 20, y: 200 });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const output = await composePdf(await template.save(), await content.save(), [{ mimeType: "image/png", bytes: png, placement: "signature_block" }], { version: { id: "v1", version: 1 } });
  const parsed = await PDFDocument.load(output);
  assert.equal(parsed.getPageCount(), 1);
  assert.ok(output.length > 500);
});

test("compositore DOCX usa campi strutturati e inserisce la firma come drawing OOXML", () => {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{document.title}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  const template = zip.generate({ type: "nodebuffer" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const output = composeDocx(template, { document: { title: "Documento emesso" } }, [{ mimeType: "image/png", bytes: png, signatureName: "Firma QA", signerName: "Mario", versionId: "v1" }]);
  const rendered = new PizZip(output);
  assert.match(rendered.file("word/document.xml").asText(), /Documento emesso/);
  assert.match(rendered.file("word/document.xml").asText(), /w:drawing/);
  assert.ok(rendered.file("word/media/company-signature-1-v1.png"));
});

test("bridge MES usa HMAC e URL storage temporaneo", () => {
  assert.match(mesApi, /verifyProductionMessage/);
  assert.match(mesApi, /createSignedUrl/);
  assert.match(mesApi, /PROGREMES_INTEGRATION_SECRET/);
});

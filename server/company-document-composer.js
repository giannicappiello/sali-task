/* global Buffer */
import { createHash } from "node:crypto";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { authorizeAIRequest } from "./ai/assistant.js";

const MIME_PDF = "application/pdf";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALLOWED_TYPES = new Map([
  ["ORDINE_CLIENTE", { format: "PDF", modules: ["ordini_pr", "ordini_ph", "ordini_private"] }],
  ["REPORT_ASSISTENTE_AI", { format: "PDF", ai: true }],
]);

function httpError(message, status = 400, code = "INVALID_REQUEST") {
  return Object.assign(new Error(message), { status, code });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function levelAllowsRead(value) {
  return ["lettura", "scrittura", "amministrazione"].includes(String(value || "").toLowerCase());
}

function assertDocumentAccess(auth, documentTypeCode) {
  const descriptor = ALLOWED_TYPES.get(documentTypeCode);
  if (!descriptor) throw httpError("Tipo documento non collegato a un generatore Workspace reale.", 400, "DOCUMENT_TYPE_NOT_INTEGRATED");
  if (auth.profile?.ruoli?.amministratore_workspace === true) return descriptor;
  if (descriptor.ai && auth.capabilities?.module_access === true) return descriptor;
  const levels = auth.access?.module_levels || {};
  if (descriptor.modules?.some((module) => levelAllowsRead(levels[module]))) return descriptor;
  throw httpError("Non hai accesso al generatore documentale richiesto.", 403, "FORBIDDEN");
}

function parseBody(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const documentTypeCode = String(body.documentTypeCode || "").trim().toUpperCase();
  const documentExternalId = String(body.documentExternalId || "").trim().slice(0, 300);
  if (!documentTypeCode || !documentExternalId) throw httpError("Tipo documento e identificativo emissione sono obbligatori.");
  return { ...body, documentTypeCode, documentExternalId };
}

function hasExpectedMagic(bytes, mimeType) {
  if (mimeType === MIME_PDF) return bytes.subarray(0, 4).toString() === "%PDF";
  if (mimeType === MIME_DOCX) return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

async function storageBytes(admin, bucket, path, expectedSha256, expectedMimeType) {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw httpError(`File documentale non disponibile: ${error?.message || path}.`, 502, "STORAGE_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (expectedSha256 && sha256(bytes) !== String(expectedSha256).toLowerCase()) {
    throw httpError("Il file documentale non supera la verifica checksum.", 502, "CHECKSUM_MISMATCH");
  }
  if (expectedMimeType && !hasExpectedMagic(bytes, expectedMimeType)) {
    throw httpError("Il contenuto del file non corrisponde al formato registrato.", 409, "FILE_SIGNATURE_MISMATCH");
  }
  return bytes;
}

async function frozenResolution(admin, input) {
  const { data, error } = await admin.rpc("record_generated_document_letterhead", {
    p_system: "workspace",
    p_document_type_code: input.documentTypeCode,
    p_document_external_id: input.documentExternalId,
    p_issued_at: input.issuedAt || new Date().toISOString(),
    p_brand: input.brand || null,
    p_business_area: input.businessArea || null,
    p_language: input.language || "it",
  });
  if (error) throw httpError(error.message, error.message?.includes("LETTERHEAD_NOT_CONFIGURED") ? 409 : 500, "LETTERHEAD_RESOLUTION_FAILED");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw httpError("Snapshot intestazione non registrato.", 500, "SNAPSHOT_NOT_RECORDED");
  const { data: version, error: versionError } = await admin.from("company_letterhead_versions")
    .select("id,storage_bucket,storage_path,mime_type,sha256,version")
    .eq("id", row.letterhead_version_id).single();
  if (versionError || !version) throw httpError("Versione intestazione dello snapshot non disponibile.", 500, "SNAPSHOT_VERSION_MISSING");
  const snapshot = row.resolution_snapshot || {};
  return { row, version, signatures: Array.isArray(snapshot.signatureAssets) ? snapshot.signatureAssets : [] };
}

async function loadSignatureAssets(admin, signatures) {
  return Promise.all(signatures.map(async (asset) => ({
    ...asset,
    bytes: await storageBytes(admin, asset.storageBucket, asset.storagePath, asset.sha256, asset.mimeType),
  })));
}

async function embedSignature(pdf, asset) {
  if (asset.mimeType === "image/png") return pdf.embedPng(asset.bytes);
  if (asset.mimeType === "image/jpeg") return pdf.embedJpg(asset.bytes);
  throw httpError("Le firme configurate devono essere immagini PNG o JPG.", 409, "SIGNATURE_FORMAT_NOT_RENDERABLE");
}

function signatureBox(page, placement, index, count) {
  const { width, height } = page.getSize();
  const itemWidth = Math.min(150, Math.max(90, (width - 72) / Math.max(1, count)));
  const x = 36 + index * itemWidth;
  if (placement === "header") return { x, y: height - 58, maxWidth: itemWidth - 12, maxHeight: 38 };
  if (placement === "footer") return { x, y: 22, maxWidth: itemWidth - 12, maxHeight: 34 };
  return { x, y: 62, maxWidth: itemWidth - 12, maxHeight: 52 };
}

async function composePdf(templateBytes, contentBytes, signatures, snapshot) {
  const [template, content] = await Promise.all([PDFDocument.load(templateBytes), PDFDocument.load(contentBytes)]);
  const output = await PDFDocument.create();
  const templatePages = template.getPages();
  if (!templatePages.length) throw httpError("Il PDF intestazione non contiene pagine.", 409, "EMPTY_TEMPLATE");
  const signatureImages = await Promise.all(signatures.map((asset) => embedSignature(output, asset)));
  for (let index = 0; index < content.getPageCount(); index += 1) {
    const source = content.getPage(index);
    const { width, height } = source.getSize();
    const page = output.addPage([width, height]);
    const templatePage = await output.embedPage(templatePages[Math.min(index, templatePages.length - 1)]);
    page.drawPage(templatePage, { x: 0, y: 0, width, height });
    const contentPage = await output.embedPage(source);
    page.drawPage(contentPage, { x: 0, y: 0, width, height });
    const visible = signatures.map((asset, assetIndex) => ({ asset, image: signatureImages[assetIndex] }));
    visible.forEach(({ asset, image }, assetIndex) => {
      const box = signatureBox(page, asset.placement, assetIndex, visible.length);
      const scale = Math.min(box.maxWidth / image.width, box.maxHeight / image.height, 1);
      page.drawImage(image, { x: box.x, y: box.y, width: image.width * scale, height: image.height * scale });
    });
    const font = await output.embedFont(StandardFonts.Helvetica);
    page.drawText(`Intestazione ${snapshot.version.letterhead_version_id || snapshot.version.id} - v${snapshot.version.version}`, {
      x: 36, y: 8, size: 5.5, font, color: rgb(0.42, 0.42, 0.42), opacity: 0.65,
    });
  }
  return Buffer.from(await output.save({ useObjectStreams: false }));
}

function xmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function drawingXml({ relationshipId, name, label, index }) {
  const docPrId = 9000 + index;
  return `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>${xmlEscape(label || name || "Firma")}</w:t></w:r></w:p>`
    + `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1645920" cy="640080"/><wp:docPr id="${docPrId}" name="${xmlEscape(name || `Firma ${index + 1}`)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${xmlEscape(name || `Firma ${index + 1}`)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1645920" cy="640080"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function appendDocxSignatures(zip, signatures) {
  if (!signatures.length) return;
  let documentXml = zip.file("word/document.xml")?.asText();
  let relsXml = zip.file("word/_rels/document.xml.rels")?.asText();
  let contentTypes = zip.file("[Content_Types].xml")?.asText();
  if (!documentXml || !relsXml || !contentTypes) throw httpError("Struttura DOCX intestazione non valida.", 409, "INVALID_DOCX_TEMPLATE");
  const usedIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  let nextId = Math.max(0, ...usedIds) + 1;
  const paragraphs = [];
  signatures.forEach((asset, index) => {
    if (!["image/png", "image/jpeg"].includes(asset.mimeType)) throw httpError("Le firme DOCX devono essere immagini PNG o JPG.", 409, "SIGNATURE_FORMAT_NOT_RENDERABLE");
    const extension = asset.mimeType === "image/png" ? "png" : "jpg";
    const relationshipId = `rId${nextId++}`;
    const mediaName = `company-signature-${index + 1}-${String(asset.versionId || "current").replaceAll("-", "")}.${extension}`;
    zip.file(`word/media/${mediaName}`, asset.bytes);
    relsXml = relsXml.replace("</Relationships>", `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`);
    if (!new RegExp(`Extension="${extension}"`, "i").test(contentTypes)) {
      contentTypes = contentTypes.replace("</Types>", `<Default Extension="${extension}" ContentType="${asset.mimeType}"/></Types>`);
    }
    paragraphs.push(drawingXml({ relationshipId, name: asset.signatureName, label: asset.label || asset.signerRole || asset.signerName, index }));
  });
  const insertion = paragraphs.join("");
  documentXml = /<w:sectPr[\s\S]*?<\/w:sectPr>\s*<\/w:body>/.test(documentXml)
    ? documentXml.replace(/(<w:sectPr[\s\S]*?<\/w:sectPr>\s*<\/w:body>)/, `${insertion}$1`)
    : documentXml.replace("</w:body>", `${insertion}</w:body>`);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  zip.file("[Content_Types].xml", contentTypes);
}

function dotParser(tag) {
  const path = tag.split(".");
  return { get(scope) { return path.reduce((value, key) => value?.[key], scope) ?? ""; } };
}

function composeDocx(templateBytes, data, signatures) {
  const zip = new PizZip(templateBytes);
  const document = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, parser: dotParser });
  document.render(data && typeof data === "object" ? data : {});
  appendDocxSignatures(document.getZip(), signatures);
  return Buffer.from(document.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

export async function handleWorkspaceDocumentCompose(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Metodo non consentito." });
  try {
    const input = parseBody(req);
    const auth = await authorizeAIRequest(req, { bypassAIEntitlements: true });
    const descriptor = assertDocumentAccess(auth, input.documentTypeCode);
    const outputFormat = String(input.outputFormat || descriptor.format).toUpperCase();
    if (!["PDF", "DOCX"].includes(outputFormat)) throw httpError("Formato di output non supportato.");
    const snapshot = await frozenResolution(auth.admin, input);
    const expectedMime = outputFormat === "PDF" ? MIME_PDF : MIME_DOCX;
    if (snapshot.version.mime_type !== expectedMime) throw httpError(`L’intestazione risolta non è in formato ${outputFormat}.`, 409, "LETTERHEAD_FORMAT_MISMATCH");
    const [templateBytes, signatures] = await Promise.all([
      storageBytes(auth.admin, snapshot.version.storage_bucket, snapshot.version.storage_path, snapshot.version.sha256, snapshot.version.mime_type),
      loadSignatureAssets(auth.admin, snapshot.signatures),
    ]);
    let bytes;
    if (outputFormat === "PDF") {
      const contentBytes = Buffer.from(String(input.contentBase64 || ""), "base64");
      if (!contentBytes.length || contentBytes.subarray(0, 4).toString() !== "%PDF") throw httpError("Contenuto PDF non valido.");
      bytes = await composePdf(templateBytes, contentBytes, signatures, snapshot);
    } else {
      bytes = composeDocx(templateBytes, input.data, signatures);
    }
    return res.status(200).json({ success: true, mediaType: expectedMime, fileBase64: bytes.toString("base64"), sha256: sha256(bytes), snapshot: {
      id: snapshot.row.id, letterheadId: snapshot.row.letterhead_id, letterheadVersionId: snapshot.row.letterhead_version_id,
      headingVersion: snapshot.row.heading_version, ruleId: snapshot.row.resolution_rule_id, issuedAt: snapshot.row.issued_at,
    } });
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error("Composizione documento intestato:", error);
    return res.status(status >= 400 && status <= 599 ? status : 500).json({ success: false, code: error?.code || "DOCUMENT_COMPOSITION_FAILED", error: error?.message || "Composizione documento non riuscita." });
  }
}

export { composeDocx, composePdf };

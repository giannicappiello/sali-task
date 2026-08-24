import test from "node:test";
import assert from "node:assert/strict";
import {
  MANUALS_SECTION_FOLDER,
  scopeDocumentLibrary,
} from "../src/pages/Documentation/documentSectionScope.js";
import { findDocumentSection } from "./document-api.js";

const sections = [
  { id: "technical", cartella_nas: "Schede Tecniche" },
  { id: "catalogs", cartella_nas: "Cataloghi" },
  { id: "manuals", cartella_nas: "ManualiUso" },
];
const documents = [
  { id: "a", percorso: "Schede Tecniche/prodotto.pdf", sezione_id: "technical" },
  { id: "b", percorso: "Cataloghi/catalogo.pdf", sezione_id: "catalogs" },
  { id: "c", percorso: "ManualiUso/Manuale Workspace Attività.pdf", sezione_id: "manuals" },
];

test("Documenti Direct esclude la sezione ManualiUso", () => {
  const result = scopeDocumentLibrary(sections, documents, {
    excludeFolder: MANUALS_SECTION_FOLDER,
  });
  assert.deepEqual(result.documents.map((document) => document.id), ["a", "b"]);
  assert.deepEqual(result.sections.map((section) => section.id), ["technical", "catalogs"]);
});

test("Manuali d'uso include esclusivamente la sezione configurata ManualiUso", () => {
  const result = scopeDocumentLibrary(sections, documents, {
    includeFolder: MANUALS_SECTION_FOLDER,
  });
  assert.deepEqual(result.documents.map((document) => document.id), ["c"]);
  assert.deepEqual(result.sections.map((section) => section.id), ["manuals"]);
});

test("il filtro usa il sezione_id e non il testo del percorso o del documento", () => {
  const misleading = [
    ...documents,
    { id: "d", percorso: "ManualiUso/nome-fuorviante.pdf", sezione_id: "catalogs" },
  ];
  const result = scopeDocumentLibrary(sections, misleading, {
    includeFolder: MANUALS_SECTION_FOLDER,
  });
  assert.deepEqual(result.documents.map((document) => document.id), ["c"]);
});

test("la sincronizzazione assegna ogni percorso alla cartella NAS configurata", () => {
  assert.equal(findDocumentSection(sections, "Schede Tecniche/prodotto.pdf")?.id, "technical");
  assert.equal(findDocumentSection(sections, "Cataloghi/catalogo.pdf")?.id, "catalogs");
  assert.equal(findDocumentSection(sections, "ManualiUso/Manuale Workspace Attività.pdf")?.id, "manuals");
});

test("un nuovo file in ManualiUso riceve automaticamente lo stesso sezione_id", () => {
  assert.equal(findDocumentSection(sections, "ManualiUso/Nuovo manuale.pdf")?.id, "manuals");
});
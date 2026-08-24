export const MANUALS_SECTION_FOLDER = "ManualiUso";

const normalizeFolder = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .trim()
    .toLocaleLowerCase("it");

export function scopeDocumentLibrary(
  sections = [],
  documents = [],
  { includeFolder = null, excludeFolder = null } = {},
) {
  const included = normalizeFolder(includeFolder);
  const excluded = normalizeFolder(excludeFolder);
  const scopedSections = sections.filter((section) => {
    const folder = normalizeFolder(section.cartella_nas);
    if (included) return folder === included;
    return !excluded || folder !== excluded;
  });
  const sectionIds = new Set(scopedSections.map((section) => section.id));

  return {
    sections: scopedSections,
    documents: documents.filter((document) => sectionIds.has(document.sezione_id)),
  };
}

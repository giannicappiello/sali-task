export const specificationSections = [
  { id: 'general', title: 'Dati del prodotto', fields: [
    ['format', 'Formato'], ['ean', 'EAN'], ['customer', 'Cliente'], ['semiFinished', 'Semilavorato'],
    ['appearance', 'Aspetto'], ['fragrance', 'Profumo'], ['description', 'Descrizione prodotto', 'textarea'],
  ] },
  { id: 'primary', title: 'Packaging primario', fields: [
    ['bottleCode', 'Flacone / vaso'],
    ['pumpCode', 'Tappo / pompa'],
    ['dipTubeCut', 'Taglio pescante', 'yesno'], ['dipTubeLength', 'Lunghezza pescante (mm)'],
    ['primaryNotes', 'Altri componenti e indicazioni', 'textarea'],
    ['additionalComponents', 'Altri componenti della distinta', 'textarea'],
  ] },
  { id: 'secondary', title: 'Packaging secondario', fields: [
    ['cartonCode', 'Astuccio'],
    ['leafletCode', 'Bugiardino'],
  ] },
  { id: 'label', title: 'Etichetta e lavorazioni', fields: [
    ['decoration', 'Etichetta / serigrafia'], ['labelCode', 'Codice etichetta'], ['labelDimensions', 'Dimensioni etichetta (mm)'],
    ['labelOrientation', 'Senso etichetta'], ['topDistance', 'Distanza dal bordo superiore (mm)'],
    ['bottomDistance', 'Distanza dal bordo inferiore (mm)'], ['labelInstructions', 'Istruzioni di applicazione', 'textarea'],
  ] },
  { id: 'lot', title: 'Lottizzazione', fields: [
    ['lotPresent', 'Marcatura lotto', 'yesno'], ['lotLine1', 'Riga 1'], ['lotLine2', 'Riga 2'], ['lotPosition', 'Posizione e istruzioni', 'textarea'],
  ] },
  { id: 'box', title: 'Imballo', fields: [
    ['boxCode', 'Codice imballo'], ['piecesPerBox', 'Pezzi per cartone'], ['boxDimensions', 'Dimensioni cartone (mm)'], ['boxNotes', 'Istruzioni imballo', 'textarea'],
  ] },
  { id: 'pallet', title: 'Pallet', fields: [
    ['palletType', 'Tipo pallet'], ['boxesPerLayer', 'Cartoni per strato'], ['layers', 'Numero di strati'], ['palletNotes', 'Note pallettizzazione', 'textarea'],
  ] },
  { id: 'other', title: 'Note e allegati', fields: [['notes', 'Note aggiuntive', 'textarea']] },
  { id: 'acceptance', title: 'Approvazione del capitolato', fields: [['approvedBy', 'Approvato da', 'readonly'], ['approvedAt', 'Il', 'timestamp']] },
];
export const formulaFields = [['formulaCode', 'Formula'], ['formulaRevision', 'Revisione formula'],
  ['viscosityMin', 'Viscosità minima'], ['viscosityMax', 'Viscosità massima'], ['color', 'Colore'],
  ['fragrance', 'Profumo'], ['phMin', 'pH minimo'], ['phMax', 'pH massimo'], ['density', 'Densità'], ['appearance', 'Aspetto']];
export const specificationSourceFields = ['customer', 'semiFinished', ...formulaFields.map(([name]) => name)];
export function sectionsForSpecification(data) {
  return data?.specificationKind === 'bulk' ? [
    { id: 'general', title: 'Dati del semilavorato', fields: [['customer', 'Cliente'], ['description', 'Descrizione semilavorato', 'textarea']] },
    { id: 'formula', title: 'Specifiche della formula', fields: formulaFields },
    ...specificationSections.filter(s => ['other', 'acceptance'].includes(s.id)),
  ] : specificationSections;
}
export const specificationAttachmentSections = ['product', 'formula', ...specificationSections.map(s => s.id).filter(s => s !== 'general')];
// Retain legacy values in saved revisions, but display each component only once.
export const specificationFields = [...specificationSections.flatMap(s => s.fields), ...formulaFields, ['specificationKind', ''],
  ['bottleDescription', ''], ['pumpDescription', ''], ['cartonDescription', ''], ['leafletDescription', ''],
  ['cartonPresent', '', 'yesno'], ['leafletPresent', '', 'yesno']];
export const isSpecificationImage = path => /\.(?:jpe?g|png|webp|gif)$/i.test(path || '');
export const MAX_SPECIFICATION_ATTACHMENTS = 40;
export const specificationComponentFields = {
  bottleCode: 'bottleDescription', pumpCode: 'pumpDescription',
  cartonCode: 'cartonDescription', leafletCode: 'leafletDescription',
  labelCode: null, boxCode: null, palletType: null,
};

export function applySpecificationSources(data, sources) {
  const next = { ...data, ...(sources.formulaData || {}), ...(sources.specificationKind ? { specificationKind: sources.specificationKind } : {}), customer: sources.customerNames.join(', '),
    semiFinished: sources.components.filter(c => /^FP/i.test(c.code)).map(c => c.code).join(', ') };
  if (data.approvedBy && specificationSourceFields.some(name => (data[name] || '') !== (next[name] || '')))
    return { ...next, approvedBy: '', approvedAt: '', approvedUserId: '' };
  return next;
}

export function specificationFileRequest(articleCode, attachment) {
  return attachment.id
    ? [`specifications/file?${new URLSearchParams({ articleCode, attachmentId: attachment.id })}`]
    : [`specifications/preview?${new URLSearchParams({ articleCode })}`, { body: attachment }];
}

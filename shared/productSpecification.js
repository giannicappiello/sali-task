export const specificationSections = [
  { id: 'general', title: 'Dati del prodotto', fields: [
    ['format', 'Formato'], ['ean', 'EAN'], ['customer', 'Cliente'], ['semiFinished', 'Semilavorato'],
    ['appearance', 'Aspetto'], ['fragrance', 'Profumo'], ['description', 'Descrizione prodotto', 'textarea'],
  ] },
  { id: 'primary', title: 'Packaging primario', fields: [
    ['bottleCode', 'Codice flacone / vaso'], ['bottleDescription', 'Descrizione flacone / vaso'],
    ['pumpCode', 'Codice tappo / pompa'], ['pumpDescription', 'Descrizione tappo / pompa'],
    ['dipTubeCut', 'Taglio pescante', 'yesno'], ['dipTubeLength', 'Lunghezza pescante (mm)'],
    ['primaryNotes', 'Altri componenti e indicazioni', 'textarea'],
  ] },
  { id: 'secondary', title: 'Packaging secondario', fields: [
    ['cartonPresent', 'Astuccio', 'yesno'], ['cartonCode', 'Codice astuccio'], ['cartonDescription', 'Descrizione astuccio'],
    ['leafletPresent', 'Bugiardino', 'yesno'], ['leafletCode', 'Codice bugiardino'], ['leafletDescription', 'Descrizione bugiardino'],
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
];
export const specificationAttachmentSections = ['product', ...specificationSections.map(s => s.id).filter(s => s !== 'general')];
export const specificationFields = specificationSections.flatMap(s => s.fields);
export const isSpecificationImage = path => /\.(?:jpe?g|png|webp|gif)$/i.test(path || '');
export const MAX_SPECIFICATION_ATTACHMENTS = 40;

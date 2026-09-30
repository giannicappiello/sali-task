export const packagingUpdateMessage = 'Il server MES non è aggiornato per compilare il foglio. Esegui AGGIORNA-PROGREMES-AUTOMATICO sul server, poi riapri questa lavorazione. Il foglio resta consultabile e stampabile.';
export function assertPackagingEditorAvailable(sheet) {
  const fields = ['operator','responsible','expiry','piecesPerBox','boxesPerLayer','layersPerPallet','piecesPerPallet','pallets','produced','scrap','notes'];
  if (!fields.every(key => (sheet?.sheetHtml || '').includes(`data-packaging-field="${key}"`))) throw new Error(packagingUpdateMessage);
}

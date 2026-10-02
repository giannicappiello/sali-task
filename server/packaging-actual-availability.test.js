import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPackagingEditorAvailable,packagingUpdateMessage} from '../src/pages/Dashboard/packagingActualAvailability.js';
test('old MES document gives an actionable update message before requesting edit',()=>{
 assert.throws(()=>assertPackagingEditorAvailable({sheetHtml:'<article>Scadenza: ______</article>'}),{message:packagingUpdateMessage});
 assert.throws(()=>assertPackagingEditorAvailable({}),{message:packagingUpdateMessage});
});
test('all editable fields are required for the MES sheet contract',()=>{
 const fields=['operator','responsible','closureDate','piecesPerBox','boxesPerLayer','layersPerPallet','piecesPerPallet','pallets','produced','scrap','notes'];
 const html=fields.map(key=>`<p data-packaging-field="${key}"></p>`).join('');
 assert.doesNotThrow(()=>assertPackagingEditorAvailable({sheetHtml:html}));
 for(const key of fields) assert.throws(()=>assertPackagingEditorAvailable({sheetHtml:html.replace(`data-packaging-field="${key}"`,'')}));
});

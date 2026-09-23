export function combineOrderExtractions(extractions) {
  const first = extractions[0] || {};
  const warnings = extractions.flatMap(item => item.warnings || []);
  const customer = {};
  let conflict = false;
  for (const item of extractions) for (const [key, value] of Object.entries(item.customer || {})) {
    if (key === 'confidence' || value == null || value === '') continue;
    if (customer[key] && String(customer[key]).trim().toLowerCase() !== String(value).trim().toLowerCase()) conflict = true;
    else customer[key] = value;
  }
  if (conflict) warnings.push('Gli allegati riportano dati cliente differenti: seleziona il cliente per questo ordine unico.');
  return {
    ...first,
    customer: conflict ? {} : customer,
    lines: extractions.flatMap(item => item.lines || []),
    pageCount: extractions.reduce((total, item) => total + (item.pageCount || 1), 0),
    notes: [...new Set(extractions.map(item => item.notes).filter(Boolean))].join('\n'),
    warnings: [...new Set(warnings)],
    customerConflict: conflict,
  };
}

export async function extractOrderVision(generate, options) {
  for (const maxOutputTokens of [16000, 32000]) {
    try {
      const result = await generate({ ...options, maxOutputTokens });
      // Accessing structured output can throw when the completion is empty/truncated.
      if (result.finishReason === 'length') {
        if (maxOutputTokens === 16000) continue;
        throw new Error('La lettura supera il limite di risposta: nessuna bozza parziale è stata creata.');
      }
      if (!result.output?.lines?.length) throw new Error('Il documento non contiene righe ordine leggibili.');
      return result;
    } catch (error) {
      if (maxOutputTokens === 16000 && (error.finishReason === 'length' || /No output generated|No object generated/i.test(error.message || ''))) continue;
      if (/No output generated|No object generated/i.test(error.message || '')) throw new Error('Non è stato possibile leggere il documento. Verifica che il PDF sia leggibile e non protetto da password, poi riprova.');
      throw error;
    }
  }
}

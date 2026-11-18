// Read only the authorized sheet already fetched by the start preview. Never
// expose its PDF, markup or active content, or infer coverage from rounded text.
export function productionSheetMaterialRows(html) {
  const text = value => value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
  const rows = [];
  for (const row of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1]));
    const articleCode = cells.find(cell => /^MP\d+[\w-]*$/i.test(cell));
    if (articleCode) rows.push({ articleCode, cells: cells.map(cell => cell.slice(0, 2000)) });
    if (rows.length >= 100) break;
  }
  return rows;
}

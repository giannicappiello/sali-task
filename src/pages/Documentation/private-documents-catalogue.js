export const documentsOnlyArticle = article => !['ProdottoFinito', 'Semilavorato'].includes(article?.articleType);
export function filterDocumentArticles(catalog, search) {
  const term = String(search || '').trim().toUpperCase();
  return !term ? catalog : catalog.filter(article => String(article.searchText || `${article.articleCode} ${article.description} ${article.articleType}`).toUpperCase().includes(term));
}
export function readCachedArticle(cache, id, now = Date.now()) {
  const entry = cache.get(id);
  return entry && now - entry.at < 30000 ? entry.data : null;
}
export function cacheArticle(cache, id, data, now = Date.now()) {
  if (cache.size >= 30 && !cache.has(id)) cache.delete(cache.keys().next().value);
  cache.set(id, { data, at: now });
}

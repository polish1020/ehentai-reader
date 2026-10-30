// Shared by the browser and Node tools; business limits live only in content-policy.json.
const strings = value => Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0);
export function validatePolicy(p) {
  if (p?.version !== 1) throw new Error('Unsupported content policy version');
  for (const key of ['allowedCategories','allowedSources','blockedTags','blockedKeywords','blockedGalleryIds']) if (!strings(p.content?.[key])) throw new Error(`Invalid policy: content.${key}`);
  if (!p.content.allowedCategories.length || !p.content.allowedSources.length || !Number.isInteger(p.content.maxPagesPerGallery) || p.content.maxPagesPerGallery < 1) throw new Error('Invalid content limits');
  if (typeof p.review?.approvedStatus !== 'string' || !p.review.approvedStatus || typeof p.review.requireDate !== 'boolean') throw new Error('Invalid review policy');
  for (const key of ['sourcesRequiringReviewer','sourcesRequiringAllPagesReviewed','sourcesRequiringImageHashes']) if (!strings(p.review[key])) throw new Error(`Invalid review.${key}`);
  if (!Number.isInteger(p.assets?.maxImageBytes) || p.assets.maxImageBytes < 1) throw new Error('Invalid image size limit');
  for (const source of p.content.allowedSources) if (!strings(p.assets.extensionsBySource?.[source]) || !p.assets.extensionsBySource[source].length || !p.assets.extensionsBySource[source].every(e => /^[a-z0-9]+$/.test(e))) throw new Error('Invalid image extensions');
  if (!p.assets.mimeExtensions || !Object.keys(p.assets.mimeExtensions).length || !Object.entries(p.assets.mimeExtensions).every(([mime,ext]) => mime.startsWith('image/') && /^[a-z0-9]+$/.test(ext))) throw new Error('Invalid MIME policy');
  if (!Number.isInteger(p.network?.maxResponseBytes) || p.network.maxResponseBytes < 1 || !Number.isFinite(p.network.timeoutSeconds) || p.network.timeoutSeconds <= 0 || !Number.isFinite(p.network.requestIntervalSeconds) || p.network.requestIntervalSeconds < 0 || !Array.isArray(p.network.hosts) || !p.network.hosts.length) throw new Error('Invalid network limits');
  for (const host of p.network.hosts) if (!/^[a-z0-9.-]+$/.test(host.hostname) || typeof host.includeSubdomains !== 'boolean' || !(host.ports === 'any' || Array.isArray(host.ports) && host.ports.length && host.ports.every(port => Number.isInteger(port) && port >= 1 && port <= 65535))) throw new Error('Invalid host policy');
  return p;
}
export function checkContent(g, p, pageCount = g.pages?.length) {
  if (!p.content.allowedCategories.includes(g.category)) throw new Error('Category blocked by content policy');
  if (!p.content.allowedSources.includes(g.source)) throw new Error('Source blocked by content policy');
  if (p.content.blockedGalleryIds.includes(g.id)) throw new Error('Gallery blocked by content policy');
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > p.content.maxPagesPerGallery) throw new Error('Page count exceeds content policy');
  if (!Array.isArray(g.tags) || !g.tags.every(t => typeof t === 'string')) throw new Error('Invalid gallery tags');
  const normalize = value => value.normalize('NFKC').toLowerCase().trim();
  const tags = g.tags.map(normalize);
  if (p.content.blockedTags.some(t => tags.includes(normalize(t)))) throw new Error('Tag blocked by content policy');
  const text = normalize([g.title,g.creator,g.description,...g.tags].join(' '));
  if (p.content.blockedKeywords.some(word => text.includes(normalize(word)))) throw new Error('Keyword blocked by content policy');
}
export function checkReview(g, p) {
  if (g.review?.status !== p.review.approvedStatus) throw new Error('Gallery review is not approved');
  if (p.review.requireDate && !/^\d{4}-\d{2}-\d{2}$/.test(g.review.reviewedAt || '')) throw new Error('Missing review date');
  if (p.review.sourcesRequiringReviewer.includes(g.source) && !g.review.reviewer?.trim()) throw new Error('Missing reviewer');
  if (p.review.sourcesRequiringAllPagesReviewed.includes(g.source) && g.review.allPagesReviewed !== true) throw new Error('Incomplete source review');
}
export function checkAssetPath(src, source, p) {
  // Path containment and local-only loading are structural security invariants.
  if (typeof src !== 'string' || !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(src) || src.includes('..') || !p.assets.extensionsBySource[source]?.includes(src.split('.').pop())) throw new Error('Only approved local asset paths are allowed');
}
export function checkGallery(g,p) {
  if (!/^[a-z0-9-]+$/.test(g.id)) throw new Error('Invalid gallery ID');
  checkContent(g,p); checkReview(g,p);
  for (const page of g.pages) checkAssetPath(page.src,g.source,p);
}

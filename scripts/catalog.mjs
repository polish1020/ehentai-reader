import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export async function validateCatalog(catalog,root) {
  if (catalog.version !== 1 || !Array.isArray(catalog.galleries)) throw new Error('Invalid catalog');
  const ids = new Set();
  for (const g of catalog.galleries) {
    if (!/^[a-z0-9-]+$/.test(g.id) || ids.has(g.id)) throw new Error('Invalid or duplicate gallery ID');
    ids.add(g.id);
    for (const key of ['title','creator','description','date']) if (typeof g[key] !== 'string' || !g[key]) throw new Error(`Missing ${key}`);
    if (!Array.isArray(g.tags) || !g.tags.every(t => typeof t === 'string')) throw new Error('Invalid tags');
    if (g.category !== 'cosplay' || g.review?.status !== 'approved-non-explicit' || !g.review.reviewedAt) throw new Error('Gallery must be reviewed non-explicit cosplay');
    if (!['demo','e-hentai'].includes(g.source)) throw new Error('Unknown source');
    if (g.source === 'e-hentai' && (!/^https:\/\/e-hentai\.org\/g\/\d+\/[a-f0-9]+\/$/.test(g.sourceUrl || '') || !g.review.reviewer?.trim() || g.review.allPagesReviewed !== true)) throw new Error('Incomplete source review');
    if (!Array.isArray(g.pages) || !g.pages.length) throw new Error('Empty gallery');
    for (const p of g.pages) {
      if (!/^\/assets\/[a-zA-Z0-9_./-]+\.(svg|png|jpg|jpeg|webp|gif|avif)$/.test(p.src) || p.src.includes('..')) throw new Error('Only local asset paths are allowed');
      const path = resolve(root, '.'+p.src); if (relative(root,path).startsWith('..')) throw new Error('Path traversal');
      const bytes = await readFile(path);
      if (g.source === 'e-hentai' && (!p.sha256 || digest(bytes) !== p.sha256)) throw new Error('Image changed since approval');
    }
  }
}

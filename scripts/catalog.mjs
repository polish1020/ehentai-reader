import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {policy as defaultPolicy} from './policy.mjs';
import {validatePolicy,checkGallery} from '../public/policy.mjs';
export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export async function validateCatalog(catalog,root,policy=defaultPolicy) {
  validatePolicy(policy);
  if (catalog.version !== 1 || !Array.isArray(catalog.galleries)) throw new Error('Invalid catalog');
  const ids = new Set();
  for (const g of catalog.galleries) {
    if (!/^[a-z0-9-]+$/.test(g.id) || ids.has(g.id)) throw new Error('Invalid or duplicate gallery ID');
    ids.add(g.id);
    for (const key of ['title','creator','description','date']) if (typeof g[key] !== 'string' || !g[key]) throw new Error(`Missing ${key}`);
    if (!Array.isArray(g.tags) || !g.tags.every(t => typeof t === 'string')) throw new Error('Invalid tags');
    checkGallery(g,policy);
    if (g.source === 'e-hentai' && !/^https:\/\/e-hentai\.org\/g\/\d+\/[a-f0-9]+\/$/.test(g.sourceUrl || '')) throw new Error('Invalid source URL');
    for (const p of g.pages) {
      const path = resolve(root, '.'+p.src); if (relative(root,path).startsWith('..')) throw new Error('Path traversal');
      const bytes = await readFile(path);
      if (bytes.length > policy.assets.maxImageBytes) throw new Error('Image exceeds content policy size limit');
      if (policy.review.sourcesRequiringImageHashes.includes(g.source) && (!p.sha256 || digest(bytes) !== p.sha256)) throw new Error('Image changed since approval');
    }
  }
}

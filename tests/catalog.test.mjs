import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,validateCatalog} from '../scripts/catalog.mjs';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const catalog=JSON.parse(await readFile(new URL('../public/catalog.json',import.meta.url),'utf8'));
test('all published galleries meet the content contract and assets exist',async () => validateCatalog(catalog,root));
test('unreviewed and non-cosplay entries fail closed',async () => {
  for (const alter of [g => g.review.status='pending',g => g.category='other',g => g.source='unknown']) {
    const c=structuredClone(catalog);alter(c.galleries[0]);await assert.rejects(validateCatalog(c,root));
  }
});
test('remote assets, traversal, and duplicate IDs are rejected',async () => {
  for (const src of ['https://example.org/image.jpg','/assets/../private.jpg','/assets/unknown.svg']) {
    const c=structuredClone(catalog);c.galleries[0].pages[0].src=src;await assert.rejects(validateCatalog(c,root));
  }
  const c=structuredClone(catalog);c.galleries.push(c.galleries[0]);await assert.rejects(validateCatalog(c,root));
});
test('real sources require full review and exact approved bytes',async () => {
  const temp=await mkdtemp(join(tmpdir(),'cosplay-test-'));
  try {
    await mkdir(join(temp,'assets'));await writeFile(join(temp,'assets/test.jpg'),'fixture');
    const c=structuredClone(catalog);const g=c.galleries[0];c.galleries=[g];
    g.source='e-hentai';g.sourceUrl='https://e-hentai.org/g/1/abcdef1234/';g.pages=[{src:'/assets/test.jpg',sha256:digest(Buffer.from('fixture'))}];
    g.review={status:'approved-non-explicit',reviewedAt:'2026-10-30'};
    await assert.rejects(validateCatalog(c,temp));
    Object.assign(g.review,{reviewer:'test-reviewer',allPagesReviewed:true});await validateCatalog(c,temp);
    await writeFile(join(temp,'assets/test.jpg'),'changed');await assert.rejects(validateCatalog(c,temp),/changed/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

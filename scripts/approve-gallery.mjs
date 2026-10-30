import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,validateCatalog} from './catalog.mjs';
import {policy} from './policy.mjs';
import {checkContent,checkReview} from '../public/policy.mjs';
const root = fileURLToPath(new URL('../',import.meta.url));
const id = process.argv[2];
if (!/^eh-\d+$/.test(id || '')) throw new Error('Usage: npm run approve -- eh-ID');
const directory = resolve(root,'staging',id);
const candidate = JSON.parse(await readFile(resolve(directory,'candidate.json'),'utf8'));
if (candidate.id !== id) throw new Error('Candidate ID does not match');
checkContent(candidate,policy);checkReview(candidate,policy);
if (!candidate.description?.trim()) throw new Error('Provide an appropriate public description');
const catalogPath=resolve(root,'public/catalog.json');
const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
if (catalog.galleries.some(g => g.id === id)) throw new Error('Gallery already published');
// Check the complete candidate BEFORE copying anything into the public tree.
const checked = [];
for (const page of candidate.pages) {
  if (basename(page.file) !== page.file || !/^\d{4}\.[a-z0-9]+$/.test(page.file) || !policy.assets.extensionsBySource[candidate.source].includes(page.file.split('.').pop())) throw new Error('Invalid page filename');
  const bytes = await readFile(resolve(directory,page.file));
  if (bytes.length > policy.assets.maxImageBytes) throw new Error('Image exceeds content policy size limit');
  if (policy.review.sourcesRequiringImageHashes.includes(candidate.source) && digest(bytes) !== page.sha256) throw new Error('Image changed since staging; review must restart');
  checked.push(page);
}
await mkdir(resolve(root,'public/assets',id),{recursive:true});
for (const page of checked) await copyFile(resolve(directory,page.file),resolve(root,'public/assets',id,page.file));
candidate.pages = checked.map(p => ({src:`/assets/${id}/${p.file}`,sha256:p.sha256,...(p.width && p.height ? {width:p.width,height:p.height} : {}),alt:`${candidate.title} · 第 ${Number(p.file.split('.')[0])} 页`}));
catalog.galleries.unshift(candidate);catalog.sourceStatus='curated';
await validateCatalog(catalog,resolve(root,'public'));
await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
console.log('Approved catalog updated. Run npm test and npm run build, then deploy.');

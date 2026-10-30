import {readFile,rm,cp,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCatalog} from './catalog.mjs';
const root = fileURLToPath(new URL('../public/',import.meta.url));
const catalog = JSON.parse(await readFile(new URL('../public/catalog.json',import.meta.url),'utf8'));
await validateCatalog(catalog,root);
await rm(new URL('../dist/',import.meta.url),{recursive:true,force:true});
await cp(new URL('../public/',import.meta.url),new URL('../dist/',import.meta.url),{recursive:true});
const hasher = createHash('sha256');
for (const file of ['index.html','style.css','app.js','catalog.json','content-policy.json','policy.mjs','sw.js']) hasher.update(await readFile(new URL(`../public/${file}`,import.meta.url)));
const version = hasher.digest('hex').slice(0,12);
let sw = await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
sw = sw.replace('yijing-v1',`yijing-${version}`);
await writeFile(new URL('../dist/sw.js',import.meta.url),sw);
// An allowlist at the artifact boundary: no staging or unlisted image is published.
const assets = new Set(['icon.svg','icon-180.png','icon-192.png','icon-512.png',...catalog.galleries.flatMap(g => g.pages.map(p => p.src.slice('/assets/'.length)))]);
async function prune(prefix='') {
  for (const entry of await readdir(new URL(`../dist/assets/${prefix}`,import.meta.url),{withFileTypes:true})) {
    const file = prefix+entry.name;
    if (entry.isDirectory()) await prune(file+'/');
    else if (!assets.has(file)) await rm(new URL(`../dist/assets/${file}`,import.meta.url),{force:true});
  }
}
await prune();
await validateCatalog(catalog,fileURLToPath(new URL('../dist/',import.meta.url)));
console.log(`Build ${version}: ${catalog.galleries.length} validated collections, ${catalog.galleries.reduce((n,g) => n+g.pages.length,0)} pages.`);

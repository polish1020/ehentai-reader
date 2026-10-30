import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {policy} from '../scripts/policy.mjs';
import {checkGallery,validatePolicy} from '../public/policy.mjs';
import {validateCatalog} from '../scripts/catalog.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const catalog=JSON.parse(await readFile(new URL('../public/catalog.json',import.meta.url),'utf8'));
test('same configured restrictions apply to browser, build and Python import gate',async () => {
  const g=catalog.galleries[0];
  for (const change of [p=>p.content.blockedGalleryIds.push(g.id),p=>p.content.blockedTags.push(g.tags[0]),p=>p.content.blockedKeywords.push(g.title.slice(0,3)),p=>p.content.maxPagesPerGallery=g.pages.length-1,p=>p.content.allowedSources=['demo']]) {
    const p=structuredClone(policy);change(p);
    assert.throws(()=>checkGallery(g,p));await assert.rejects(validateCatalog(catalog,root,p));
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/check-policy.mjs',import.meta.url)),'stage'],{input:JSON.stringify({gallery:{...g,pageCount:g.pages.length},policy:p}),encoding:'utf8'});
    assert.notEqual(result.status,0);
  }
});
test('image size and format limits come from the policy',async () => {
  const p=structuredClone(policy);p.assets.maxImageBytes=1;await assert.rejects(validateCatalog(catalog,root,p),/size limit/);
  const q=structuredClone(policy);q.assets.extensionsBySource['e-hentai']=['png'];assert.throws(()=>checkGallery(catalog.galleries[0],q),/asset paths/);
});
test('malformed or missing configuration fails closed',()=> {
  for (const mutate of [p=>delete p.review,p=>p.network.maxResponseBytes=-1,p=>p.content.maxPagesPerGallery='200',p=>p.network.hosts[0].ports=[0]]) {
    const p=structuredClone(policy);mutate(p);assert.throws(()=>validatePolicy(p));
  }
});
test('Python host validation reads the centralized host/port rules',()=> {
  const result=spawnSync('python3',['-c',`import importlib.util
s=importlib.util.spec_from_file_location('stage','scripts/stage-gallery.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert m.allowed('https://e-hentai.org/g/1/abcdef/')
assert m.allowed('https://a.b.hath.network:18033/a')
assert not m.allowed('http://e-hentai.org/')
assert not m.allowed('https://ehgt.org.evil.test/')
m.POLICY['network']['hosts']=[{'hostname':'example.org','includeSubdomains':False,'ports':[443]}]
assert not m.allowed('https://e-hentai.org/')
assert m.allowed('https://example.org/')`],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

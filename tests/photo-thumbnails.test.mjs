import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseThumbnails} from '../lib/ehentai.mjs';
import {ThumbnailStore} from '../public/photo-thumbnails.mjs';
import {GET as pages} from '../api/pages.js';

const sprite='<div id="gdt"><a href="https://e-hentai.org/s/abcdef/1-1"><div style="width:200px;height:150px;background:transparent url(https://images.example/sheet.webp) -0px 0 no-repeat"></div></a><a href="https://e-hentai.org/s/fedcba/1-2"><div style="width:200px;height:267px;background:transparent url(https://images.example/sheet.webp) -200px 0 no-repeat"></div></a></div>';

test('source sprite sheets are cropped with their original dimensions and offsets',()=>{
  const data=parseThumbnails(sprite);
  assert.equal(data.perPage,2);
  assert.deepEqual(data.pages[1],{index:1,src:'https://images.example/sheet.webp',pageURL:'https://e-hentai.org/s/fedcba/1-2',width:200,height:267,x:-200,y:0,sprite:true});
});

test('individual thumbnails and relative source URLs are supported',()=>{
  const data=parseThumbnails('<div id="gdt"><a href="/s/abcdef/1-3"><img src="//s.exhentai.org/w/fixture.webp" width="120" height="160"></a></div>','https://exhentai.org');
  assert.deepEqual(data.pages[0],{index:2,src:'https://s.exhentai.org/w/fixture.webp',pageURL:'https://exhentai.org/s/abcdef/1-3',width:120,height:160});
});

test('visible thumbnail requests share gallery pages and only fetch needed batches',async()=>{
  const calls=[];
  const store=new ThumbnailStore(async page=>{calls.push(page);return {perPage:2,pages:[{index:page*2,src:'fixture'},{index:page*2+1,src:'fixture'}]};});
  await Promise.all([store.ensure(0),store.ensure(1),store.ensure(5)]);
  assert.deepEqual(calls,[0,2]);
  await store.ensure(4);assert.deepEqual(calls,[0,2]);
});

test('the thumbnail API reads gallery HTML rather than downloading full-resolution pictures',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return new Response(sprite);});
  const response=await pages(new Request('https://reader.example/api/pages?gid=1&token=abcdef&p=2'));
  assert.equal(response.status,200);assert.equal((await response.json()).pages.length,2);
  assert.deepEqual(calls,['https://e-hentai.org/g/1/abcdef/?p=2']);
});

test('private gallery thumbnails require the authenticated source session',async t=>{
  t.mock.method(console,'error',()=>{});
  const response=await pages(new Request('https://reader.example/api/pages?gid=1&token=abcdef&source=exhentai'));
  assert.equal(response.status,401);
});

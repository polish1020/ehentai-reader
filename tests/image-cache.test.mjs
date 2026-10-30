import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadCachedImage,clearImageCaches,clearPrivateImageCaches,imageCacheName,imageCacheCount} from '../public/image-cache.mjs';

function cacheStorage(t) {
  const stores=new Map();
  const storage={
    keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),
    open:async key=>{
      if(!stores.has(key))stores.set(key,new Map());
      const entries=stores.get(key),url=value=>typeof value==='string'?value:value.url;
      return {match:async key=>entries.get(url(key))?.clone(),put:async(key,response)=>entries.set(url(key),response.clone()),keys:async()=>[...entries.keys()].map(value=>new Request(value)),delete:async key=>entries.delete(url(key))};
    }
  };
  const original=Object.getOwnPropertyDescriptor(globalThis,'caches');
  Object.defineProperty(globalThis,'caches',{value:storage,configurable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'caches',original);else delete globalThis.caches;});
  return storage;
}

test('a loaded image is reused without another network request; retry replaces the cached copy',async t => {
  cacheStorage(t);let calls=0;
  const fetchImage=async()=>new Response(`image-${++calls}`);
  const request=new Request('https://reader.example/api/image?gid=1&page=1');
  assert.equal(await (await loadCachedImage(request,{source:'e-hentai'},fetchImage)).text(),'image-1');
  assert.equal(await (await loadCachedImage(request,{source:'e-hentai'},fetchImage)).text(),'image-1');
  assert.equal(calls,1);
  await loadCachedImage(new Request(request.url+'&retry=1'),{source:'e-hentai'},fetchImage);
  assert.equal(await (await loadCachedImage(request,{source:'e-hentai'},fetchImage)).text(),'image-2');
  assert.equal(calls,2);
});

test('private sessions are isolated and clearing credentials preserves public cached images',async t => {
  cacheStorage(t);
  const request=new Request('https://images.example/image.webp');
  for(const context of [{source:'e-hentai'},{source:'exhentai',scope:'account-a'},{source:'exhentai',scope:'account-b'}])await loadCachedImage(request,context,async()=>new Response('fixture'));
  assert.equal(await imageCacheCount(),3);
  await clearImageCaches('account-a');assert.equal(await imageCacheCount(),2);
  assert.ok((await caches.keys()).includes(imageCacheName('e-hentai')));
  assert.ok((await caches.keys()).includes(imageCacheName('exhentai','account-b')));
  await clearPrivateImageCaches();assert.equal(await imageCacheCount(),1);
});

test('failed responses are not cached and each image cache retains at most 200 entries',async t => {
  cacheStorage(t);
  await loadCachedImage(new Request('https://images.example/failed'),{source:'e-hentai'},async()=>new Response('failed',{status:502}));
  assert.equal(await imageCacheCount(),0);
  for(let index=0;index<201;index++)await loadCachedImage(new Request(`https://images.example/${index}`),{source:'e-hentai'},async()=>new Response('image'));
  assert.equal(await imageCacheCount(),200);
  assert.equal(await (await caches.open(imageCacheName('e-hentai'))).match('https://images.example/0'),undefined);
});

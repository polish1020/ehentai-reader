import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../api/image-links.js';
import {sessionCookie} from '../lib/ex-session.mjs';
import {ManifestExport,exportRange,makeManifest} from '../public/download-manifest.mjs';

const reference={gid:1,token:'abcdef'};
const links=(source='e-hentai',pages=[1,2])=>pages.map(page=>({page,url:`https://${source}.org/s/aabbcc/1-${page}`}));
const request=(input,{source='e-hentai',cookie,origin='https://reader.example',signal}={})=>new Request(`https://reader.example/api/image-links?source=${source}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({...reference,...input}),signal});

test('export reads only trusted image HTML pages, bounds concurrency and never requests image bytes',async t=>{
  const calls=[];let active=0,max=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:new URL(url),headers:options.headers});active++;max=Math.max(max,active);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    const page=Number(new URL(url).pathname.match(/-(\d+)$/)[1]);
    return new Response(`<img id="img" src="https://images.example/${page}.webp?key=a%2Bb&amp;x=1">`);
  });
  const response=await POST(request({links:links('e-hentai',[1,2,3,4,5])}));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  const result=await response.json();assert.equal(result.items.length,5);assert.deepEqual(result.failures,[]);
  assert.equal(result.items[0].url,'https://images.example/1.webp?key=a%2Bb&x=1');
  assert.equal(max,2);assert.equal(calls.length,5);assert.ok(calls.every(call=>call.url.hostname==='e-hentai.org'&&call.url.pathname.startsWith('/s/')&&!call.headers.Cookie));
});

test('invalid links, different gallery IDs, credentials in URLs, cross-site writes and oversized batches fail before upstream access',async t=>{
  t.mock.method(console,'error',()=>{});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not request');});
  for(const entries of [[],links('e-hentai',Array.from({length:9},(_,i)=>i+1)),[{page:1,url:'https://unrelated.example/s/aabbcc/1-1'}],[{page:1,url:'https://e-hentai.org/s/aabbcc/2-1'}],[{page:1,url:'https://user:pass@e-hentai.org/s/aabbcc/1-1'}],[...links(),links()[0]]])assert.equal((await POST(request({links:entries}))).status,400);
  assert.equal((await POST(request({links:links()},{origin:'https://other.example'}))).status,403);
  assert.equal((await POST(request({links:links('exhentai')},{source:'exhentai'}))).status,401);
  assert.equal(calls,0);
});

test('ExHentai credentials reach image pages only and never appear in exported data',async t=>{
  const calls=[],secrets={ipb_member_id:'123',ipb_session_id:'fixture-session',ipb_pass_hash:'fixture-secret'};
  const cookie=sessionCookie(secrets).cookie.split(';')[0];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:new URL(url),headers:options.headers});return new Response('<img id="img" src="https://cdn.example/image.jpg?signature=temporary">');});
  const response=await POST(request({links:links('exhentai')},{source:'exhentai',cookie}));
  assert.equal(response.status,200);assert.equal(response.headers.get('vary'),'Cookie');
  const data=await response.text();for(const value of Object.values(secrets))assert.ok(!data.includes(value));
  assert.ok(calls.every(call=>call.url.hostname==='exhentai.org'&&call.headers.Cookie.includes('fixture-secret')));
  assert.ok(data.includes('https://cdn.example/image.jpg?signature=temporary'));
});

test('partial failures stay visible and quota/auth errors stop rather than exporting placeholders',async t=>{
  t.mock.method(console,'error',()=>{});
  t.mock.method(globalThis,'fetch',async url=>new Response(String(url).endsWith('-1')?'<img id="img" src="https://images.example/1.png">':'<p>unavailable</p>'));
  const partial=await(await POST(request({links:links()}))).json();assert.equal(partial.items.length,1);assert.equal(partial.failures[0].page,2);
  t.mock.method(globalThis,'fetch',async()=>new Response('<img id="img" src="https://ehgt.org/g/509.gif">'));
  assert.equal((await POST(request({links:links()}))).status,429);
});

test('manifest retries only unresolved pages, preserves stable IDs and can explicitly renew all URLs',async()=>{
  const gallery={...reference,title:'A collection',source:'exhentai',pageCount:20},batches=[];let failed=true,version=1;
  const exporter=new ManifestExport(gallery,{
    pageLinks:async(_,pages)=>links('exhentai',pages),
    request:async(_,options)=>{
      const pages=JSON.parse(options.body).links.map(item=>item.page);batches.push(pages);
      return {items:pages.filter(page=>page!==3||!failed).map(page=>({page,url:`https://cdn.example/${page}.webp?v=${version}`})),failures:failed?[{page:3,error:'temporary failure'}]:[]};
    }
  });
  await exporter.run(1,12);assert.equal(exporter.items.size,11);assert.deepEqual(batches.map(batch=>batch.length),[8,4]);
  failed=false;await exporter.run(1,12);assert.deepEqual(batches.at(-1),[3]);
  const first=exporter.manifest();assert.equal(first.items.length,12);assert.deepEqual(first.items[0],{id:'exhentai-1-1',url:'https://cdn.example/1.webp?v=1',filename:'000001.webp'});
  version=2;await exporter.run(1,12,{fresh:true});
  const renewed=exporter.manifest();assert.deepEqual(renewed.items.map(item=>item.id),first.items.map(item=>item.id));assert.deepEqual(renewed.items.map(item=>item.filename),first.items.map(item=>item.filename));assert.ok(renewed.items.every(item=>item.url.endsWith('v=2')));
  assert.deepEqual(exportRange(1,200,300).length,200);assert.throws(()=>exportRange(1,201,300));assert.throws(()=>exportRange(0,2,20));
  assert.equal(makeManifest(gallery,[20],new Map([[20,'https://cdn.example/unknown?key=abc']])).items[0].filename,'000020.img');
});

test('canceling the producer prevents subsequent batches and preserves already resolved links',async()=>{
  let count=0;const exporter=new ManifestExport({...reference,title:'Fixture',source:'e-hentai',pageCount:20},{
    pageLinks:async(_,pages)=>links('e-hentai',pages),
    request:async(_,options)=>{count++;return {items:JSON.parse(options.body).links.map(item=>({page:item.page,url:`https://cdn.example/${item.page}.jpg`}))};},
    changed:()=>{if(exporter.items.size===8&&exporter.running)exporter.cancel();}
  });
  await assert.rejects(exporter.run(1,20),{name:'AbortError'});assert.equal(count,1);assert.equal(exporter.items.size,8);assert.equal(exporter.running,false);
});

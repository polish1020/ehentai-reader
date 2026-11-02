import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GET} from '../api/image.js';
import {sessionCookie} from '../lib/ex-session.mjs';

const credentials={ipb_member_id:'1',ipb_pass_hash:'fixture-pass',ipb_session_id:'fixture-session'};
const cookie=sessionCookie(credentials).cookie.split(';')[0];
const request=(source,authenticated=true)=>new Request(`https://reader.example/api/image?gid=1&token=abcdef&page=1&quality=original&source=${source}`,{headers:authenticated?{Cookie:cookie}:{}});
const published=(days=1)=>new Date(Date.now()-days*86400000).toISOString().slice(0,16).replace('T',' ');
const gallery=(host,date=published())=>`<div id="gdd"><table><tr><td>Posted:</td><td>${date}</td></tr></table></div><div id="gdt"><a href="https://${host}/s/fixture/1-1">1</a></div>`;

test('original images require credentials even for the public source',async t=>{
  t.mock.method(console,'error',()=>{});
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unauthenticated requests must not contact the source');});
  for(const source of ['e-hentai','exhentai'])assert.equal((await GET(request(source,false))).status,401);
});

for(const [source,host,path] of [['e-hentai','e-hentai.org','/fullimg.php?gid=1&page=1&key=fixture'],['exhentai','exhentai.org','/fullimg/1/1/fixture/01.jpg']]){
  test(`${source} resolves a protected original entry without fetching image bytes or exposing credentials`,async t=>{
    const calls=[];
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      const target=new URL(url);calls.push({target,options});
      assert.equal(target.hostname,host);
      assert.match(options.headers.Cookie,/ipb_pass_hash=fixture-pass/);
      if(target.pathname.startsWith('/g/'))return new Response(gallery(host));
      if(target.pathname.startsWith('/s/'))return new Response(`<img id="img" src="https://images.hath.network/preview.webp"><a href="${path}">Download original 6000 x 8000</a>`);
      assert.equal(target.pathname,new URL(path,`https://${host}`).pathname);
      return new Response(null,{status:302,headers:{Location:'https://images.hath.network/original.jpg?key=temporary'}});
    });
    const response=await GET(request(source));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');
    assert.deepEqual(await response.json(),{src:'https://images.hath.network/original.jpg?key=temporary'});
    assert.equal(calls.length,3);
  });
}

test('original entry failures and unexpected redirects do not turn into successful image URLs',async t=>{
  t.mock.method(console,'error',()=>{});
  let upstream=new Response('<p>Insufficient funds</p>');
  t.mock.method(globalThis,'fetch',async url=>{
    const target=new URL(url);
    if(target.pathname.startsWith('/g/'))return new Response(gallery('exhentai.org'));
    if(target.pathname.startsWith('/s/'))return new Response('<a href="/fullimg/1/1/fixture/01.jpg">Download original</a>');
    assert.equal(target.hostname,'exhentai.org');return upstream;
  });
  const denied=await GET(request('exhentai'));assert.equal(denied.status,502);assert.match((await denied.json()).error,/积分或图片配额/);
  for(const location of ['https://untrusted.example/image.jpg','http://images.hath.network/image.jpg','https://e-hentai.org/login.php','https://secret@images.hath.network/image.jpg']){
    upstream=new Response(null,{status:302,headers:{Location:location}});
    assert.equal((await GET(request('exhentai'))).status,502);
  }
});

test('old, unknown, future and boundary dates cannot reach a potentially chargeable original entry',async t=>{
  t.mock.method(console,'error',()=>{});
  let date;const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(new URL(url).pathname);
    assert.match(new URL(url).pathname,/^\/g\//,'Must reject before opening an image or original download entry');
    return new Response(gallery('exhentai.org',date));
  });
  for(date of [published(400),published(100),published(88),'unknown',published(-1)]){
    const response=await GET(request('exhentai'));assert.equal(response.status,403);assert.match((await response.json()).error,/无法确认免积分/);
  }
  assert.equal(calls.length,5);
});

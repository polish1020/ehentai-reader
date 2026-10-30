import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {GET as galleries} from '../api/galleries.js';
import {GET as image} from '../api/image.js';
import {parseListing} from '../lib/ehentai.mjs';
import {createApp} from '../scripts/serve.mjs';

const listing='<a href="https://e-hentai.org/g/1/abcdef/">Gallery</a><a href="https://e-hentai.org/g/1/abcdef/">Duplicate</a><a id="unext" href="/?next=100&amp;f_search=test">Next</a>';
const request=path => new Request(`http://localhost${path}`);

test('search forwards query and cursor and returns only IDs for direct client metadata requests',async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    calls.push({url:new URL(url),options});return new Response(listing);
  });
  const response=await galleries(request('/api/galleries?q=any%20tag&next=123'));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url.searchParams.get('f_search'),'any tag');
  assert.equal(calls[0].url.searchParams.get('next'),'123');
  assert.deepEqual(await response.json(),{ids:[[1,'abcdef']],next:'100'});
});

test('image resolution locates later thumbnail pages and redirects without relaying image bytes',async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async url => {
    calls.push(String(url));
    if (String(url).includes('/s/')) return new Response('<img id="img" src="https://images.hath.network/full.jpg?key=abc&amp;size=1">');
    const indexes=new URL(url).searchParams.get('p') === '1' ? [3,4] : [1,2];
    return new Response(`<div id="gdt">${indexes.map(n => `<a href="https://e-hentai.org/s/aabbcc/1-${n}">Page</a>`).join('')}</div>`);
  });
  const response=await image(request('/api/image?gid=1&token=abcdef&page=3'));
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'https://images.hath.network/full.jpg?key=abc&size=1');
  assert.equal(response.headers.get('cache-control'),'private, max-age=300');
  assert.equal(await response.text(),'');
  assert.deepEqual(calls,['https://e-hentai.org/g/1/abcdef/','https://e-hentai.org/g/1/abcdef/?p=1','https://e-hentai.org/s/aabbcc/1-3']);
});

test('empty results and unavailable upstream responses remain distinguishable',async t => {
  assert.deepEqual(parseListing('<p>No hits found</p>'),{ids:[],next:null});
  assert.throws(() => parseListing('<p>Your IP address has been temporarily banned</p>'),/未返回图集列表/);
  t.mock.method(console,'error',() => {});
  t.mock.method(globalThis,'fetch',async () => new Response('Unavailable',{status:403}));
  const response=await galleries(request('/api/galleries'));
  assert.equal(response.status,502);
  assert.match((await response.json()).error,/403/);
});

test('the local HTTP server serves the app, its browser module, and the live search route',async t => {
  const nativeFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async (url,options) => new URL(url).hostname === 'e-hentai.org' ? new Response(listing) : nativeFetch(url,options));
  const server=createApp();
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    assert.match(await (await fetch(origin)).text(),/GALLERY READER/);
    const module=await fetch(`${origin}/source.mjs`);
    assert.equal(module.headers.get('content-type'),'text/javascript; charset=utf-8');
    assert.match(await module.text(),/https:\/\/e-hentai.org\/api.php/);
    const response=await fetch(`${origin}/api/galleries`);
    assert.deepEqual(await response.json(),{ids:[[1,'abcdef']],next:'100'});
  } finally { server.closeAllConnections();server.close();await once(server,'close'); }
});

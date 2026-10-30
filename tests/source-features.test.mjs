import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../api/source.js';
import {GET as galleries} from '../api/galleries.js';
import {sessionCookie} from '../lib/ex-session.mjs';
import {parseGalleryInfo,parseTags,parseTorrents,parseArchive} from '../lib/source-features.mjs';
import {quickTags,searchOptions,accepts,feedFor} from '../public/source-options.mjs';

const credentials={ipb_member_id:'1',ipb_pass_hash:'fixture-pass',ipb_session_id:'fixture-session'};
const cookie=()=>sessionCookie(credentials).cookie.split(';')[0];
const request=(path,{method='GET',body,logged=false,origin='https://reader.example'}={})=>new Request(`https://reader.example${path}`,{method,headers:{Origin:origin,...(logged?{Cookie:cookie()}:{}),...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
const galleryPage='<script>var apiuid=1;var apikey="fixture-api-key";</script><h1 id="gn">Fixture</h1><span id="rating_label">Average: 4.5</span><span id="rating_count">5</span><div id="cdiv"><div class="c1"><div class="c3">Posted on today by: <a>Reader</a></div><div class="c5"><span>+2</span></div><div class="c6" id="comment_7">First line<br>Second line&lt;img src=x onerror=alert(1)&gt;</div></div></div>';
const tagsPage='<script>var apiuid=1;var apikey="fixture-api-key";</script><select id="tagset"><option value="1">Reading</option></select><div id="usertags_outer"><div id="usertag_9"><span id="tagpreview_9" title="artist:fixture"></span><input id="tagwatch_9" checked><input id="taghide_9"><input id="tagcolor_9" value="225544"><input id="tagweight_9" value="20"></div></div>';

test('gallery comments and account tag preferences return structured text without scripts or API keys',()=>{
  const info=parseGalleryInfo(galleryPage);
  assert.equal(info.comments[0].id,7);assert.equal(info.comments[0].author,'Reader');
  assert.match(info.comments[0].text,/First line\nSecond line/);
  assert.equal(JSON.stringify(info).includes('fixture-api-key'),false);
  assert.deepEqual(parseTags(tagsPage),{sets:[{id:1,name:'Reading'}],tags:[{id:9,tag:'artist:fixture',watch:true,hidden:false,color:'225544',weight:20}]});
});

test('account operations require a saved session and reject cross-origin writes before contacting the source',async t=>{
  t.mock.method(console,'error',()=>{});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('');});
  for(const action of ['tags','favorite-groups','favorite-info','archive'])assert.equal((await GET(request(`/api/source?action=${action}&gid=1&token=abcdef`))).status,401);
  assert.equal((await POST(request('/api/source',{method:'POST',body:{action:'rating',gid:1,token:'abcdef',rating:5}}))).status,401);
  assert.equal((await POST(request('/api/source',{method:'POST',logged:true,origin:'https://unrelated.example',body:{action:'favorite'}}))).status,403);
  assert.equal(calls,0);
});

test('yesterday, month, year and all-time rankings use the correct source list and page cursor',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(new URL(url));const tl=new URL(url).searchParams.get('tl');return new Response(`<a href="https://e-hentai.org/g/1/abcdef/">Fixture</a><a href="/toplist.php?tl=${tl}&p=2">&gt;</a>`);});
  for(const [feed,id] of [['yesterday',15],['month',13],['year',12],['all',11]]){
    const result=await galleries(request(`/api/galleries?feed=${feed}&next=1&f_cats=959`));assert.equal(result.status,200);assert.equal((await result.json()).next,'2');
    assert.equal(calls.at(-1).pathname,'/toplist.php');assert.equal(calls.at(-1).searchParams.get('tl'),String(id));assert.equal(calls.at(-1).searchParams.get('p'),'1');
  }
});

test('ExHentai rankings use the shared public endpoint, filter categories before metadata, and never forward private credentials',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const target=new URL(url);calls.push({url:target,options});
    if(target.hostname==='exhentai.org'&&target.pathname==='/toplist.php')return new Response('Missing',{status:404});
    const tl=target.searchParams.get('tl');
    return new Response(`<table><tr><td><div class="cn">Manga</div></td><td><a href="https://e-hentai.org/g/1/abcdef/">Excluded</a></td></tr><tr><td><div class="cs">Cosplay</div></td><td><a href="https://e-hentai.org/g/2/abcdef/">Included</a></td></tr></table><a href="/toplist.php?tl=${tl}&p=2">Next</a>`);
  });
  for(const feed of ['yesterday','month','year','all']){
    const response=await galleries(request(`/api/galleries?source=exhentai&feed=${feed}&next=1&f_cats=703`,{logged:true}));
    assert.deepEqual(await response.json(),{ids:[[2,'abcdef']],next:'2'});
    assert.equal(calls.at(-1).url.hostname,'e-hentai.org');assert.equal(calls.at(-1).url.pathname,'/toplist.php');
    assert.equal(calls.at(-1).options.headers.Cookie,undefined);assert.equal(calls.at(-1).options.headers.Origin,undefined);
  }
  assert.equal((await galleries(request('/api/galleries?source=exhentai&feed=yesterday&q=fixture',{logged:true}))).status,200);
  assert.equal(calls.at(-1).url.hostname,'exhentai.org');assert.equal(calls.at(-1).url.pathname,'/');
  assert.match(calls.at(-1).options.headers.Cookie,/fixture-pass/);
});

test('watched and source favorites use account credentials, while ordinary public lists remain anonymous',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:new URL(url),options});return new Response('<a href="https://e-hentai.org/g/1/abcdef/">Fixture</a>');});
  for(const feed of ['watched','favorites']){
    const result=await galleries(request(`/api/galleries?feed=${feed}&favcat=2`,{logged:true}));assert.equal(result.status,200);
    assert.match(calls.at(-1).options.headers.Cookie,/fixture-pass/);assert.equal(calls.at(-1).url.pathname,feed==='watched'?'/watched':'/favorites.php');
  }
  await galleries(request('/api/galleries',{logged:true}));assert.equal(calls.at(-1).options.headers.Cookie,undefined);
});

test('rating and comment votes keep source API keys on the server and accept only intended operations',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:new URL(url),options});return String(url).includes('api.php')?Response.json({rating_avg:4.6,comment_score:3}):new Response(galleryPage);});
  const response=await POST(request('/api/source?source=exhentai',{method:'POST',logged:true,body:{action:'rating',gid:1,token:'abcdef',rating:4.5}}));
  assert.deepEqual(await response.json(),{ok:true,rating:4.6,score:3});
  const sent=JSON.parse(calls[1].options.body);assert.equal(sent.method,'rategallery');assert.equal(sent.rating,9);assert.equal(sent.apikey,'fixture-api-key');
  assert.equal(calls[1].url.hostname,'exhentai.org');assert.match(calls[1].options.headers.Cookie,/fixture-pass/);
  await POST(request('/api/source',{method:'POST',logged:true,body:{action:'comment-vote',gid:1,token:'abcdef',commentId:7,vote:1}}));
  assert.equal(calls.at(-1).url.hostname,'api.e-hentai.org');assert.equal(JSON.parse(calls.at(-1).options.body).comment_id,7);
});

test('favorite saves encode group and notes, and redirects do not repeat the write',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:new URL(url),options});return calls.length===1?new Response(null,{status:302,headers:{Location:'/gallerypopups.php?saved=1'}}):new Response('<p>Saved</p>');
  });
  const response=await POST(request('/api/source',{method:'POST',logged:true,body:{action:'favorite',gid:1,token:'abcdef',group:2,note:'A & B'}}));
  assert.deepEqual(await response.json(),{saved:true});assert.equal(calls.length,2);
  const body=new URLSearchParams(calls[0].options.body);assert.equal(body.get('favcat'),'2');assert.equal(body.get('favnote'),'A & B');
  assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.body,undefined);
});

test('comment publishing confirms a new source comment and supports native formatting',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:new URL(url),options});
    return new Response(options.method==='POST'?galleryPage.replace(/<\/div>$/,'<div class="c1"><div class="c3"><a>Reader</a></div><div class="c6" id="comment_8"><b>Hello</b> reader</div></div></div>'):galleryPage);
  });
  const response=await POST(request('/api/source',{method:'POST',logged:true,body:{action:'comment',gid:1,token:'abcdef',text:'[b]Hello[/b] reader'}}));
  assert.equal(response.status,200);assert.ok((await response.json()).comments.some(comment=>comment.id===8));
  assert.equal(new URLSearchParams(calls.at(-1).options.body).get('commenttext_new'),'[b]Hello[/b] reader');
});

test('saved favorite notes and group selection are read before editing',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('<select name="favcat"><option value="0">First</option><option value="2" selected>Reading</option></select><textarea name="favnote">Existing &amp; note</textarea>'));
  const result=await GET(request('/api/source?action=favorite-info&gid=1&token=abcdef',{logged:true}));
  assert.deepEqual(await result.json(),{groups:[{id:0,name:'First'},{id:2,name:'Reading'}],group:2,note:'Existing & note'});
});

test('tag preferences update native source fields and return no source keys',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:new URL(url),options});return new Response(tagsPage);});
  const response=await POST(request('/api/source?source=exhentai',{method:'POST',logged:true,body:{action:'tag-preference',tag:'artist:fixture',watch:true,hidden:false,weight:20,color:'#225544'}}));
  const result=await response.json();assert.equal(result.tags[0].tag,'artist:fixture');assert.equal(JSON.stringify(result).includes('fixture-api-key'),false);
  assert.equal(calls[0].url.href,'https://e-hentai.org/mytags?tagset=1');assert.match(calls[0].options.headers.Cookie,/fixture-pass/);
  const values=new URLSearchParams(calls[0].options.body);assert.equal(values.get('usertag_action'),'add');assert.equal(values.get('tagwatch_new'),'on');assert.equal(values.get('tagcolor_new'),'225544');
});

test('download listings accept source download hosts and expose archive costs without generating downloads',async t=>{
  const hash='a'.repeat(40);
  assert.equal(parseTorrents(`<div id="torrentinfo"><a href="https://evil.example/${hash}.torrent">Bad host</a><a href="https://evil.example/${hash}.torrent">Bad host</a><a href="https://ehtracker.org/get/1/${hash}.torrent">Fixture</a><a href="javascript:alert(1).torrent">Bad</a></div>`,'https://e-hentai.org').torrents.length,1);
  const parsed=parseArchive('<div id="db"><div>100 GP<form><input name="dltype" value="org"></form></div><div id="continue"><a href="https://archive.hath.network/archive/fixture">Continue</a></div></div><script>apikey="secret"</script>','https://e-hentai.org');
  assert.equal(parsed.options[0].kind,'org');assert.match(parsed.options[0].description,/100 GP/);assert.equal(parsed.links.length,1);assert.equal(JSON.stringify(parsed).includes('secret'),false);
  let method;t.mock.method(globalThis,'fetch',async(url,options)=>{method=options.method;return new Response('<div id="db">100 GP<form><input name="dltype" value="org"></form></div>');});
  await GET(request('/api/source?action=archive&gid=1&token=abcdef',{logged:true}));assert.equal(method,undefined);
});

test('image search forwards only image bytes to the correct upload host and keeps similarity settings',async t=>{
  const calls=[];const hash='a'.repeat(40);
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:new URL(url),options});return new Response(null,{status:302,headers:{Location:`https://e-hentai.org/?f_shash=${hash}&fs_similar=on&fs_covers=on`}});});
  const body=new FormData();body.set('file',new Blob(['fixture-image'],{type:'image/png'}),'fixture.png');body.set('covers','true');
  const response=await POST(request('/api/source',{method:'POST',body,logged:true}));
  assert.deepEqual(await response.json(),{hash,filters:{fs_similar:'on',fs_covers:'on',fs_exp:'on'}});
  assert.equal(calls[0].url.hostname,'upld.e-hentai.org');assert.equal(calls[0].options.headers.Cookie,undefined);assert.ok(calls[0].options.body.get('sfile') instanceof Blob);
});

test('advanced search and quick tags preserve namespaces, prioritize followed tags, and filter blocked tags',()=>{
  const options=searchOptions('fixture',{artist:'some artist',language:'chinese',uploader:'reader',exclude:'artist:excluded, language:english',f_srdd:'4',f_spf:'20',f_sto:true});
  assert.match(options.query,/artist:"some artist\$"/);assert.match(options.query,/-language:"english\$"/);
  assert.deepEqual(options.params,{f_srdd:'4',f_spf:'20',f_sto:'on'});
  const prefs=[{tag:'artist:followed',watch:true,weight:10},{tag:'blocked',hidden:true,weight:-10}];
  assert.equal(quickTags([{tags:['frequent','blocked']},{tags:['frequent','other']}],prefs)[0],'artist:followed');
  assert.equal(quickTags([{tags:['blocked']}],prefs).includes('blocked'),false);
  assert.equal(accepts({tags:['blocked'],pageCount:30,rating:5},{},prefs),false);
  assert.equal(accepts({tags:[],pageCount:10,rating:3},{f_srdd:4},[]),false);
  assert.equal(accepts({tags:['artist:fixture','language:chinese'],creator:'Reader',pageCount:30,rating:5},{artist:'Fixture',language:'chinese',uploader:'reader'},[]),true);
  assert.equal(accepts({tags:['artist:fixture'],creator:'Reader',pageCount:30,rating:5},{exclude:'artist:fixture'},[]),false);
  assert.equal(feedFor({view:'favorites',favoriteMode:'source'}),'favorites');
  assert.equal(feedFor({view:'search',searchFeed:'favorites'}),'favorites');
  assert.equal(feedFor({view:'search',searchFeed:'watched'}),'watched');
});

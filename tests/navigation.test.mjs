import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ListStore} from '../public/navigation.mjs';

test('session snapshots restore each list, cursor, scroll and unfinished loading without image page arrays',() => {
  const values=new Map();
  const storage={getItem:key => values.get(key),setItem:(key,value) => values.set(key,value)};
  const store=new ListStore(storage);
  const search=store.create('library','artist:"some artist$"');
  Object.assign(search,{
    sort:'pages',listMode:true,scrollY:1830,nextCursor:'123',isLoading:true,pendingAppend:true,initialized:true,categoryKey:'Cosplay',
    galleries:[{id:'1/abcdef',title:'First result',category:'Cosplay',pages:[{src:'/api/image'}]}],
    pendingRequest:Promise.resolve(),requestId:2
  });
  store.activate(search);
  const favorites=store.create('favorites','favorite search');store.activate(favorites);
  store.save();
  const restored=new ListStore(storage);
  const saved=restored.tab('library');
  assert.equal(saved.key,search.key);
  assert.equal(saved.query,'artist:"some artist$"');
  assert.equal(saved.sort,'pages');assert.equal(saved.listMode,true);
  assert.equal(saved.scrollY,1830);assert.equal(saved.nextCursor,'123');
  assert.equal(saved.isLoading,true);assert.equal(saved.pendingAppend,true);
  assert.equal(saved.categoryKey,'Cosplay');assert.equal(saved.initialized,true);
  assert.deepEqual(saved.galleries,[{id:'1/abcdef',title:'First result',category:'Cosplay'}]);
  assert.equal(saved.pendingRequest,undefined);assert.equal(saved.requestId,undefined);
  assert.equal(restored.tab('favorites').query,'favorite search');
});

test('unavailable session storage preserves in-memory navigation',() => {
  const store=new ListStore({getItem:() => { throw Error('disabled'); },setItem:() => { throw Error('quota'); }});
  const list=store.create('discover');store.activate(list);store.save();
  assert.equal(store.tab('discover'),list);
  const corrupt=new ListStore({getItem:() => 'broken JSON'});
  assert.equal(corrupt.lists.size,0);
});

test('old discovery snapshots switch to popularity once while preserving later explicit sorting choices',() => {
  const values=new Map();
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  values.set('yijing-navigation-v1',JSON.stringify({version:1,tabs:{},lists:[{key:'old',view:'discover',query:'',sort:'newest',galleries:[{id:'1/abcdef'}],initialized:true,isLoading:true,nextCursor:'123',scrollY:200}]}));
  const store=new ListStore(storage),list=store.lists.get('old');
  assert.equal(list.sort,'source');assert.equal(list.initialized,false);assert.equal(list.isLoading,false);
  assert.deepEqual(list.galleries,[]);assert.equal(list.nextCursor,null);assert.equal(list.scrollY,0);
  list.sort='pages';list.initialized=true;store.save();
  assert.equal(new ListStore(storage).lists.get('old').sort,'pages');
  assert.equal(store.create('library').sort,'newest');
  assert.equal(store.create('discover').sort,'source');
});

test('discovery continuation migrates existing popular results and preserves latest-page progress across reloads',()=>{
  const values=new Map();
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  values.set('yijing-navigation-v1',JSON.stringify({version:1,tabs:{},lists:[{key:'popular',view:'discover',query:'',source:'e-hentai',sort:'source',discoveryVersion:1,galleries:[{id:'1/abcdef'}],initialized:true,nextCursor:null}]}));
  const store=new ListStore(storage),list=store.lists.get('popular');
  assert.equal(list.discoveryContinuation,true);assert.deepEqual(list.popularIds,['1/abcdef']);
  assert.equal(list.initialized,true);
  Object.assign(list,{discoveryContinuation:false,discoveryLatest:true,nextCursor:'latest-page-2'});store.save();
  const restored=new ListStore(storage).lists.get('popular');
  assert.equal(restored.discoveryContinuation,false);assert.equal(restored.discoveryLatest,true);
  assert.equal(restored.nextCursor,'latest-page-2');assert.deepEqual(restored.popularIds,['1/abcdef']);
});

test('saved ExHentai toplist 404s retry after the endpoint fix instead of restoring the stale error',()=>{
  const storage={getItem:()=>JSON.stringify({version:1,tabs:{},lists:[{key:'rank',view:'discover',source:'exhentai',feed:'yesterday',query:'',discoveryVersion:2,galleries:[],initialized:true,isLoading:false,listError:'ExHentai 请求失败（404）'}]})};
  const list=new ListStore(storage).lists.get('rank');
  assert.equal(list.initialized,false);assert.equal(list.isLoading,false);assert.equal(list.listError,'');
  assert.equal(list.feed,'yesterday');assert.equal(list.source,'exhentai');
});

test('source-specific lists stay isolated and clearing ExHentai removes its snapshots',() => {
  const store=new ListStore();
  const publicList=store.create('library','public query');store.activate(publicList);
  publicList.galleries=[{source:'e-hentai',id:'1/abcdef'},{source:'exhentai',id:'ex/1/abcdef'}];
  const privateList=store.create('library','private query','exhentai');store.activate(privateList);
  assert.equal(store.tab('library'),publicList);
  assert.equal(store.tab('library','exhentai'),privateList);
  store.removeSource('exhentai');
  assert.deepEqual(publicList.galleries,[{source:'e-hentai',id:'1/abcdef'}]);
  assert.equal(store.tab('library','exhentai'),undefined);
  assert.equal(store.tab('library'),publicList);
});

test('legacy favorite modes merge into a fresh account-authoritative collection without dropping local snapshots',()=>{
 const legacy={version:1,tabs:{'e-hentai:favorites':'old-favorites'},lists:[{key:'old-favorites',view:'favorites',source:'e-hentai',query:'',favoriteMode:'source',filters:{favcat:2},galleries:[{id:'1/abcdef',source:'e-hentai'}],initialized:true,isLoading:false}]};
 const store=new ListStore({getItem:()=>JSON.stringify(legacy),setItem:()=>{}}),list=store.tab('favorites','e-hentai');
 assert.equal(list.favoriteMode,undefined);assert.deepEqual(list.filters,{});assert.equal(list.initialized,false);assert.equal(list.galleries.length,1);
});

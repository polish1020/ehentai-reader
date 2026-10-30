import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Favorites,favoriteMatches} from '../public/favorites.mjs';
const gallery=(id='1/abcdef',source='e-hentai')=>({id,gid:1,token:'abcdef',source,title:'Fixture One',creator:'Artist',tags:['artist:one piece'],pages:[{src:'unused'}]});
function setup({scope=null,state={favorites:[]},fail=false,info={group:null,note:''}}={}){
 const calls=[];let current=scope,broken=fail;
 const store=new Favorites({state,save:()=>{},getScope:()=>current,ensureScope:async()=>current,request:async(path,options)=>{calls.push({path,options});if(broken)throw Error('Source unavailable');return options?{saved:true}:info;}});
 return {store,state,calls,setScope:value=>{current=value;},setFail:value=>{broken=value;}};
}
test('missing credentials retain a local snapshot across account changes without upstream writes',async()=>{
 const {store,state,calls,setScope}=setup();const result=await store.set(gallery());
 assert.equal(result.synced,false);assert.equal(store.localOnly('1/abcdef'),true);assert.equal(calls.length,0);
 assert.equal(state.favoriteMeta['1/abcdef'].gallery.pages,undefined);
 setScope('account-b');assert.equal(store.has('1/abcdef'),true);assert.equal(store.localOnly('1/abcdef'),true);
 const reload=setup({scope:'account-c',state:structuredClone(state)});assert.equal(reload.store.has('1/abcdef'),true);
});
test('successful source favorites delete persistent local IDs, metadata and pending operations',async()=>{
 const {store,state,calls,setScope}=setup({scope:'account-a'});
 assert.equal((await store.set(gallery())).synced,true);assert.equal(store.has('1/abcdef'),true);assert.equal(store.localOnly('1/abcdef'),false);
 assert.deepEqual(state.favorites,[]);assert.deepEqual(state.favoriteMeta,{});assert.deepEqual(state.favoritePending,{});
 assert.equal(JSON.parse(calls.at(-1).options.body).group,0);
 setScope('account-b');assert.equal(store.has('1/abcdef'),false);assert.deepEqual(store.galleries('e-hentai'),[]);
 assert.equal(setup({scope:'account-a',state:structuredClone(state)}).store.has('1/abcdef'),false);
});
test('a failed write remains local; manual retry can sync to a different account and remove local data',async()=>{
 const {store,state,setScope,setFail}=setup({scope:'account-a',fail:true});
 await store.set(gallery(),{group:2,note:'Retain this note'});assert.equal(store.localOnly('1/abcdef'),true);
 setScope('account-b');setFail(false);const result=await store.set(gallery());assert.equal(result.synced,true);
 assert.deepEqual(state.favorites,[]);assert.deepEqual(state.favoriteMeta,{});assert.equal(store.info('1/abcdef').note,'Retain this note');
});
test('an existing source favorite preserves its group and note without an unnecessary write',async()=>{
 const {store,state,calls}=setup({scope:'account-a',info:{group:7,note:'Original note'}});
 assert.equal((await store.set(gallery())).synced,true);assert.equal(calls.length,1);assert.equal(calls[0].options,undefined);
 assert.deepEqual(store.info('1/abcdef'),{group:7,note:'Original note'});assert.deepEqual(state.favorites,[]);
});
test('merged source favorites deduplicate local entries and ignore stale account responses',async()=>{
 const {store,state,setScope}=setup({scope:'account-a',state:{favorites:['1/abcdef']}});
 store.remember(gallery());store.ingest([gallery()],'account-a');assert.equal(store.galleries('e-hentai').length,1);assert.deepEqual(state.favorites,[]);assert.deepEqual(state.favoriteMeta,{});
 await store.set(gallery('2/bbcdef'),{group:0});setScope('account-b');store.ingest([gallery()],'account-a');assert.equal(store.has('1/abcdef'),false);
 store.ingest([gallery('3/cccdef')],'account-b');assert.equal(store.has('3/cccdef'),true);
});
test('concurrent taps share a single operation, and failed removal stays hidden on refresh',async()=>{
 const {store,state,setFail}=setup({scope:'account-a'});const first=store.set(gallery());assert.equal(store.set(gallery()),first);await first;
 setFail(true);await store.set(gallery(),{remove:true});assert.equal(store.has('1/abcdef'),false);
 store.ingest([gallery()],'account-a');assert.equal(store.has('1/abcdef'),false);assert.deepEqual(state.favorites,[]);
 setFail(false);await store.set(gallery(),{remove:true});assert.equal(store.has('1/abcdef'),false);assert.deepEqual(state.favoritePending,{});
});
test('source-authoritative refresh and source-qualified IDs preserve account and gallery isolation',()=>{
 const {store}=setup({scope:'account-a'});store.ingest([gallery(),gallery('ex/1/abcdef','exhentai')],'account-a');
 store.resetRemote('e-hentai');assert.equal(store.has('1/abcdef'),false);assert.equal(store.has('ex/1/abcdef'),true);
 assert.equal(favoriteMatches(gallery(),'artist:"one piece$"'),true);assert.equal(favoriteMatches(gallery(),'Fixture -missing'),true);assert.equal(favoriteMatches(gallery(),'-artist:"one piece$"'),false);
});

test('an account switch during a successful write neither creates a local backup nor adds to the new account',async()=>{
 let scope='account-a',finish;const state={favorites:[]};
 const store=new Favorites({state,save:()=>{},getScope:()=>scope,ensureScope:async()=>scope,request:async(path,options)=>{if(!options)return {group:null};await new Promise(resolve=>{finish=resolve;});return {saved:true};}});
 const task=store.set(gallery());while(!finish)await new Promise(resolve=>setImmediate(resolve));
 scope='account-b';finish();assert.equal((await task).synced,true);assert.deepEqual(state.favorites,[]);assert.deepEqual(state.favoriteMeta,{});assert.equal(store.has('1/abcdef'),false);
});

test('private favorites preserve their source when submitting the synchronized operation',async()=>{
 const {store,calls}=setup({scope:'account-a'});await store.set(gallery('ex/1/abcdef','exhentai'));
 assert.equal(JSON.parse(calls.at(-1).options.body).source,'exhentai');assert.equal(store.has('1/abcdef'),false);assert.equal(store.has('ex/1/abcdef'),true);
});

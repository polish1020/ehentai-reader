import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryPage} from '../public/discovery.mjs';

const gallery=(id,category='Cosplay')=>({id,category});
const categories=['Cosplay'];

test('popular entries load first without fetching a latest page until continuation is requested',async()=>{
  const calls=[];
  const result=await discoveryPage({categories,load:async(feed,cursor)=>{calls.push({feed,cursor});return {galleries:[gallery('popular')],next:null};}});
  assert.deepEqual(calls,[{feed:'popular',cursor:null}]);
  assert.equal(result.continuation,true);assert.equal(result.latest,false);
  assert.deepEqual(result.popularIds,['popular']);assert.equal(result.next,null);
});

test('empty, category-excluded, or unavailable popularity falls back to the first latest page',async()=>{
  for(const popular of [[],[gallery('excluded','Manga')],new Error('Unavailable')]){
    const calls=[];
    const result=await discoveryPage({categories,load:async(feed,cursor)=>{
      calls.push({feed,cursor});
      if(feed==='popular'){if(popular instanceof Error)throw popular;return {galleries:popular,next:null};}
      return {galleries:[gallery('latest')],next:'next-page'};
    }});
    assert.deepEqual(calls,[{feed:'popular',cursor:null},{feed:'latest',cursor:null}]);
    assert.deepEqual(result.galleries,[gallery('latest')]);assert.equal(result.next,'next-page');
    assert.equal(result.latest,true);assert.equal(result.continuation,false);assert.deepEqual(result.popularIds,[]);
    assert.equal(result.fallback,popular instanceof Error?'unavailable':'empty');
  }
});

test('continuation skips duplicates and keeps the latest pagination cursor',async()=>{
  const calls=[];
  const result=await discoveryPage({categories,append:true,seen:['popular'],load:async(feed,cursor)=>{
    calls.push({feed,cursor});
    return cursor ? {galleries:[gallery('popular'),gallery('fresh'),gallery('fresh')],next:'later'} : {galleries:[gallery('popular')],next:'next'};
  }});
  assert.deepEqual(calls,[{feed:'latest',cursor:null},{feed:'latest',cursor:'next'}]);
  assert.deepEqual(result.galleries,[gallery('fresh')]);assert.equal(result.next,'later');
  assert.equal(result.popularIds,undefined);assert.equal(result.continuation,false);
});

test('duplicate-only continuation bounds requests and stops a repeating cursor',async()=>{
  let calls=0;
  const capped=await discoveryPage({categories,append:true,seen:['popular'],load:async()=>({galleries:[gallery('popular')],next:String(++calls)})});
  assert.equal(calls,3);assert.equal(capped.next,'3');assert.deepEqual(capped.galleries,[]);
  const end=await discoveryPage({categories,append:true,cursor:'same',load:async()=>({galleries:[],next:'same'})});
  assert.equal(end.next,null);
});

test('authentication errors and canceled navigation do not trigger fallback; latest failures remain visible',async()=>{
  for(const error of [Object.assign(new Error('Auth'),{status:401}),Object.assign(new Error('Forbidden'),{status:403}),new DOMException('Left page','AbortError')]){
    let calls=0;
    await assert.rejects(discoveryPage({categories,load:async()=>{calls++;throw error;}}),error);
    assert.equal(calls,1);
  }
  await assert.rejects(discoveryPage({categories,load:async feed=>{
    if(feed==='popular')return {galleries:[],next:null};
    throw new Error('Latest unavailable');
  }}),/Latest unavailable/);
});

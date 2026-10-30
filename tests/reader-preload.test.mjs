import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReaderPreloader,preloadNeighbors,readerPreference} from '../public/reader-preload.mjs';

test('the preload window contains up to five pages on either side, excluding the current page',()=>{
  assert.deepEqual(preloadNeighbors(0,20),[1,2,3,4,5]);
  assert.deepEqual(preloadNeighbors(7,20),[8,6,9,5,10,4,11,3,12,2]);
  assert.deepEqual(preloadNeighbors(19,20),[18,17,16,15,14]);
  assert.deepEqual(preloadNeighbors(0,1),[]);
});

test('preloads have bounded concurrency and replace queued pages when the reader jumps',async()=>{
  const calls=[],pending=new Map(),loaded=[];
  const preloader=new ReaderPreloader(30,(index,signal)=>new Promise(resolve=>{calls.push(index);pending.set(index,{resolve,signal});}),index=>loaded.push(index));
  preloader.update(0);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[1,2,3]);
  preloader.update(20);
  pending.get(1).resolve({width:600,height:800});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[1,2,3,21]);
  assert.ok(!calls.includes(4));assert.ok(!calls.includes(5));
  assert.deepEqual(loaded,[1]);
  preloader.close();
  assert.ok([...pending.values()].every(job=>job.signal.aborted));
  pending.get(2).resolve({});pending.get(3).resolve({});pending.get(21).resolve({});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,4);
});

test('already loaded pages do not start another preload',async()=>{
  let calls=0;
  const preloader=new ReaderPreloader(2,async()=>{calls++;return {width:100,height:200};},()=>{});
  preloader.update(0);await new Promise(resolve=>setImmediate(resolve));
  preloader.update(0);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);assert.deepEqual(preloader.loaded.get(1),{width:100,height:200});
  preloader.close();
});

test('continuous scrolling becomes the default once and later explicit choices are retained',()=>{
  const previous={mode:'paged'};
  assert.equal(readerPreference(previous),'scroll');
  previous.mode='paged';assert.equal(readerPreference(previous),'paged');
  assert.equal(readerPreference({}),'scroll');
  assert.equal(readerPreference({readerDefaultsVersion:1,mode:'invalid'}),'scroll');
});

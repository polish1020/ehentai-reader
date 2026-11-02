import {test} from 'node:test';
import assert from 'node:assert/strict';
import {originalFailureReport} from '../public/original-diagnostics.mjs';

test('original failure reports preserve the failing page, timings and image server without signed URLs or credentials',()=>{
  const sourceURL=new URL('https://images.hath.network/h/private-signed-path/image.jpg?key=private-key');
  const error=Object.assign(new Error('internal detail'),{status:502,stack:'private-stack',cause:{Cookie:'private-cookie'}});
  const report=originalFailureReport({
    gallery:{id:'ex/4110019/4f9f07d9a1',pages:Array(16),credentials:'private-account'},index:0,immersive:true,error,
    state:{phase:'decode',started:1000,addressAt:2000,loadedAt:4000,failedAt:6000,error:'原图处理失败 https://images.hath.network/private-signed-path?key=private-key\nCookie: private-cookie',sourceURL,
      info:{width:4672,height:7008,size:'17.04 MiB',credentials:'private-account'},image:{complete:true,width:4672,height:7008,src:sourceURL.href}}
  },{
    location:{origin:'https://reader.example'},innerWidth:393,innerHeight:793,devicePixelRatio:3,visualViewport:{scale:1},
    navigator:{userAgent:'FixtureBrowser',language:'zh-CN',onLine:true,serviceWorker:{controller:{state:'activated',scriptURL:'https://reader.example/sw.js?scope=private-scope'}}},
    performance:{getEntriesByName:name=>{assert.equal(name,sourceURL.href);return [{name,duration:3000,workerStart:1,responseStatus:0,transferSize:0,encodedBodySize:0,decodedBodySize:0,serverTiming:[{description:'private-key'}]}];}}
  });
  assert.deepEqual(report.gallery,{id:'ex/4110019/4f9f07d9a1',url:'https://reader.example/#gallery/ex/4110019/4f9f07d9a1',page:1,pages:16});
  assert.equal(report.stage,'decode');assert.equal(report.mode,'immersive');
  assert.equal(report.timing.elapsedMs,5000);assert.equal(report.timing.addressMs,1000);assert.equal(report.timing.imageMs,2000);assert.equal(report.timing.decodeMs,2000);
  assert.deepEqual(report.original.server,{protocol:'https:',host:'images.hath.network'});
  assert.equal(report.original.size,'17.04 MiB');assert.equal(report.image.width,4672);assert.equal(report.resource.httpStatus,null);assert.equal(report.resource.transferBytes,null);
  assert.equal(report.serviceWorker.scriptPath,'/sw.js');assert.equal(report.viewport.pixelRatio,3);
  const serialized=JSON.stringify(report);
  for(const secret of ['private-signed-path','private-key','private-cookie','private-account','private-stack','private-scope'])assert.equal(serialized.includes(secret),false,secret);
});

test('address failures and unavailable browser APIs still produce a useful report',()=>{
  const report=originalFailureReport({gallery:{id:'1/abcdef',pages:[{}]},index:0,immersive:false,error:{name:'AbortError'},state:{phase:'address',started:1000,failedAt:31000,error:'获取原图地址超时'}},{});
  assert.equal(report.stage,'address');assert.equal(report.error.timeout,true);assert.equal(report.timing.addressMs,30000);assert.equal(report.original.server,null);assert.equal(report.image,null);assert.equal(report.resource,null);assert.equal(report.network.online,null);assert.equal(report.serviceWorker.controlled,false);
});

test('credential-shaped error text is redacted rather than copied into a report',()=>{
  const report=originalFailureReport({gallery:{id:'1/abcdef',pages:[{}]},index:0,error:{name:'Error'},state:{phase:'address',started:1000,failedAt:2000,error:'ipb_pass_hash=private-pass; "igneous":"private-igneous"; scope=private-scope token=private-token'}},{});
  const serialized=JSON.stringify(report);
  for(const secret of ['private-pass','private-igneous','private-scope','private-token'])assert.equal(serialized.includes(secret),false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clampPhoto,zoomAt} from '../public/photo-gestures.mjs';

test('photo panning uses actual fitted image boundaries without exposing empty edges',()=>{
 const portrait={width:400,height:600,imageWidth:1000,imageHeight:2000};
 assert.deepEqual(clampPhoto(2,999,999,portrait),{scale:2,x:100,y:300});
 assert.deepEqual(clampPhoto(1,100,100,portrait),{scale:1,x:0,y:0});
 const landscape={width:400,height:600,imageWidth:2000,imageHeight:1000};
 assert.deepEqual(clampPhoto(2,-999,-999,landscape),{scale:2,x:-200,y:0});
});
test('zoom keeps the tapped image point in place and limits magnification',()=>{
 const geometry={width:400,height:400,imageWidth:1000,imageHeight:1000};
 assert.deepEqual(zoomAt({scale:1,x:0,y:0},3,{x:50,y:-30},geometry),{scale:3,x:-100,y:60});
 assert.deepEqual(zoomAt({scale:3,x:-100,y:60},1,{x:50,y:-30},geometry),{scale:1,x:0,y:0});
 assert.equal(zoomAt({scale:1,x:0,y:0},9,{x:0,y:0},geometry).scale,4);
});

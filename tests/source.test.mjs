import {test} from 'node:test';
import assert from 'node:assert/strict';
import {galleryReference,galleryWithPages,setExScope} from '../public/source.mjs';

test('source-qualified references preserve existing public favorites and isolate private galleries',() => {
  assert.deepEqual(galleryReference('123/abcdef'),{gid:'123',token:'abcdef',source:'e-hentai'});
  assert.deepEqual(galleryReference('ex/123/abcdef'),{gid:'123',token:'abcdef',source:'exhentai'});
});

test('known metadata constructs reader pages without another request and scopes private image caches',() => {
  setExScope('fixture-scope');
  const input={gid:123,token:'abcdef',source:'exhentai',title:'Fixture',pageCount:2};
  const gallery=galleryWithPages(input);
  assert.equal(input.pages,undefined);
  assert.equal(gallery.pages.length,2);
  const url=new URL(gallery.pages[0].src,'https://reader.example');
  assert.equal(url.searchParams.get('source'),'exhentai');
  assert.equal(url.searchParams.get('scope'),'fixture-scope');
  assert.equal(url.searchParams.get('page'),'1');
  setExScope(null);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categories,excludedCategories,tagQuery} from '../public/filters.mjs';

test('selected top-level categories become the source exclusion mask',() => {
  assert.equal(categories.length,10);
  assert.equal(excludedCategories(categories.map(category => category.name)),0);
  assert.equal(excludedCategories([]),1023);
  assert.equal(excludedCategories(['Cosplay']),959);
  assert.equal(excludedCategories(['Manga','Doujinshi']),1017);
  assert.equal(excludedCategories(['Non-H','Western']),255);
});

test('gallery tags produce exact source searches with namespaces and spaces preserved',() => {
  assert.equal(tagQuery('artist:some artist'),'artist:"some artist$"');
  assert.equal(tagQuery('parody:one piece'),'parody:"one piece$"');
  assert.equal(tagQuery('cosplay'),'"cosplay$"');
  assert.equal(tagQuery('artist:a"b\\c'),'artist:"a\\"b\\\\c$"');
});

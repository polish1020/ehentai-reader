import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveSearch,recentSearches,cleanSearchHistory,visitTime} from '../public/user-records.mjs';

test('recent searches deduplicate, move the last used term first and keep 20 per source and scope',()=>{
 let records=[];const list={source:'e-hentai',searchScope:'library'};
 for(let i=0;i<25;i++)records=saveSearch(records,{...list,query:`term ${i}`});
 records=saveSearch(records,{...list,query:' term 12 '});
 assert.equal(records.length,20);assert.equal(records[0].query,'term 12');assert.equal(records.filter(item=>item.query==='term 12').length,1);
 records=saveSearch(records,{source:'exhentai',query:'private term'});
 records=saveSearch(records,{...list,searchScope:'favorites',query:'saved term'});
 assert.equal(recentSearches(records,list).length,20);
 assert.deepEqual(recentSearches(records,{...list,searchScope:'favorites'}).map(item=>item.query),['saved term']);
 assert.deepEqual(recentSearches(records,{source:'exhentai'}).map(item=>item.query),['private term']);
});
test('malformed saved data is discarded and arbitrary query text is preserved as text',()=>{
 assert.deepEqual(cleanSearchHistory({bad:true}),[]);
 const records=cleanSearchHistory([null,{query:123}, {query:'empty',source:'invalid',scope:'source'}, {query:'<img onerror=alert(1)>',source:'e-hentai',scope:'source',extra:'discard'}]);
 assert.deepEqual(records,[{query:'<img onerror=alert(1)>',source:'e-hentai',scope:'source'}]);
 assert.deepEqual(saveSearch(records,{query:' ',source:'e-hentai'}),records);
});
test('visit labels distinguish today, yesterday, other years and unknown timestamps',()=>{
 const now=new Date(2026,9,31,14,30);
 assert.match(visitTime(new Date(2026,9,31,9,5).getTime(),now).label,/今天.*09:05/);
 assert.match(visitTime(new Date(2026,9,30,23,5).getTime(),now).label,/昨天.*23:05/);
 assert.match(visitTime(new Date(2025,9,30).getTime(),now).label,/2025/);
 for(const value of [undefined,'bad',Infinity,0])assert.equal(visitTime(value,now).label,'访问时间未知');
});

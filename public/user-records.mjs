const searchLimit=20;
export const searchScope=list=>['favorites','history'].includes(list.searchScope)?list.searchScope:'source';
export function cleanSearchHistory(records) {
  if(!Array.isArray(records))return [];
  const seen=new Set();
  return records.filter(item=>{
    if(!item||typeof item.query!=='string'||!item.query.trim()||item.query.length>2000||!['e-hentai','exhentai'].includes(item.source)||!['source','favorites','history'].includes(item.scope))return false;
    const key=JSON.stringify([item.source,item.scope,item.query.trim()]);if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,120).map(({query,source,scope})=>({query:query.trim(),source,scope}));
}
export function saveSearch(records,list) {
  const query=String(list.query||'').trim(),scope=searchScope(list);
  if(!query||query.length>2000)return cleanSearchHistory(records);
  const item={query,source:list.source,scope},key=JSON.stringify(item);
  let count=0;
  return [item,...cleanSearchHistory(records).filter(old=>JSON.stringify(old)!==key)].filter(old=>old.source!==item.source||old.scope!==scope||++count<=searchLimit);
}
export function recentSearches(records,list) {return cleanSearchHistory(records).filter(item=>item.source===list.source&&item.scope===searchScope(list));}
export function visitTime(value,now=new Date()) {
  const date=new Date(value);
  if(!Number.isFinite(Number(value))||Number(value)<=0||!Number.isFinite(date.getTime()))return {label:'访问时间未知',title:'访问时间未知'};
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()),yesterday=new Date(start);yesterday.setDate(yesterday.getDate()-1);
  const clock=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
  const day=date>=start&&date<=now?'今天':date>=yesterday&&date<start?'昨天':new Intl.DateTimeFormat('zh-CN',{...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{}),month:'2-digit',day:'2-digit'}).format(date);
  return {label:`${day} ${clock}`,title:date.toLocaleString('zh-CN',{hour12:false}),datetime:date.toISOString()};
}

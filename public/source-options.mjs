import {tagQuery} from './filters.mjs';
export const feeds=[['popular','实时热门'],['yesterday','昨日榜'],['month','月榜'],['year','年榜'],['all','总榜'],['watched','关注']];
export const feedFor=list=>list.view==='search'?(list.searchScope==='favorites'?'favorites':list.searchFeed||'latest'):list.view==='favorites'?'favorites':list.view==='discover'?(list.feed||'popular'):'latest';
export function searchOptions(query='',filters={}) {
  const parts=[query.trim()];
  for (const name of ['artist','language','uploader']) {
    const value=String(filters[name]||'').trim();
    if(value)parts.push(name==='uploader'?`uploader:"${value.replace(/["\\]/g,'\\$&')}"`:tagQuery(`${name}:${value}`));
  }
  for(const tag of String(filters.exclude||'').split(/[,，\n]+/).map(value=>value.trim()).filter(Boolean))parts.push('-'+tagQuery(tag));
  const params={};
  for(const key of ['f_srdd','f_spf','f_spt','favcat','f_shash','fs_similar','fs_covers','fs_exp'])if(filters[key]!==undefined && filters[key]!=='')params[key]=filters[key];
  for(const key of ['f_sto','f_sh'])if(filters[key])params[key]='on';
  return {query:parts.filter(Boolean).join(' '),params};
}
export function accepts(gallery,filters={},preferences=[]) {
  const tags=(gallery.tags||[]).map(tag=>tag.toLowerCase());
  for(const namespace of ['artist','language'])if(filters[namespace]&&!tags.includes(`${namespace}:${String(filters[namespace]).trim().toLowerCase()}`))return false;
  if(filters.uploader&&String(gallery.creator||'').toLowerCase()!==String(filters.uploader).trim().toLowerCase())return false;
  for(const excluded of String(filters.exclude||'').split(/[,，\n]+/).map(value=>value.trim().toLowerCase()).filter(Boolean)) {
    if(tags.some(tag=>excluded.includes(':')?tag===excluded:tag===excluded||tag.slice(tag.indexOf(':')+1)===excluded))return false;
  }
  if(filters.f_srdd && Number(gallery.rating)<Number(filters.f_srdd))return false;
  if(filters.f_spf && gallery.pageCount<Number(filters.f_spf))return false;
  if(filters.f_spt && gallery.pageCount>Number(filters.f_spt))return false;
  const matched=preferences.filter(pref=>tags.includes(pref.tag.toLowerCase()));
  return !matched.some(pref=>pref.hidden) && matched.reduce((score,pref)=>score+Number(pref.weight||0),0)>=0;
}
export function quickTags(galleries,preferences=[],limit=5) {
  const counts=new Map(),prefs=new Map(preferences.map(pref=>[pref.tag,pref]));
  for(const gallery of galleries)for(const tag of new Set(gallery.tags||[]))if(!prefs.get(tag)?.hidden)counts.set(tag,(counts.get(tag)||0)+1);
  for(const pref of preferences)if(pref.watch&&!pref.hidden&&!counts.has(pref.tag))counts.set(pref.tag,0);
  return [...counts.keys()].sort((a,b)=>Number(!!prefs.get(b)?.watch)-Number(!!prefs.get(a)?.watch) || Number(prefs.get(b)?.weight||0)-Number(prefs.get(a)?.weight||0) || counts.get(b)-counts.get(a) || a.localeCompare(b)).slice(0,limit);
}

export const errorMessage=value=>String(value||'请求失败，请稍后重试').replace(/(?:E-Hentai|ExHentai)(?:\s+|(?=[:：]|$))/gi,'').trim()||'请求失败，请稍后重试';
const sourceAPI='https://e-hentai.org/api.php';
let exScope = null;
export function setExScope(scope) { exScope = scope; }
export function thumbnailSource(src,source) {
  return source === 'exhentai' && new URL(src).hostname === 's.exhentai.org' ? `/api/thumbnail?${new URLSearchParams({src,scope:exScope || ''})}` : src;
}
export function galleryReference(id) {
  const parts = id.split('/');
  const source = parts[0] === 'ex' ? 'exhentai' : 'e-hentai';
  if (source === 'exhentai') parts.shift();
  return {gid:parts[0],token:parts[1],source};
}
const decode=value => {
  const textarea=document.createElement('textarea');
  textarea.innerHTML=value || '';
  return textarea.value;
};

export async function metadata(ids,source='e-hentai') {
  const galleries=[];
  // Source API batch size; these requests go directly from the browser to E-Hentai.
  for (let offset=0;offset<ids.length;offset+=25) {
    const response=await fetch(source === 'exhentai' ? '/api/metadata' : sourceAPI,{
      method:'POST',cache:'no-store',credentials:source === 'exhentai' ? 'same-origin' : 'omit',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(source === 'exhentai' ? {ids:ids.slice(offset,offset+25)} : {method:'gdata',gidlist:ids.slice(offset,offset+25),namespace:1})
    });
    if (!response.ok) throw new Error(`图集请求失败（${response.status}）`);
    const data=await response.json();
    if (!data.gmetadata) throw new Error(errorMessage(data.error || '图集信息暂时不可用'));
    galleries.push(...data.gmetadata.filter(g => !g.error).map(g => ({
      id:`${source === 'exhentai' ? 'ex/' : ''}${g.gid}/${g.token}`,gid:Number(g.gid),token:g.token,
      title:decode(g.title),creator:g.uploader || 'Unknown',description:decode(g.title_jpn || g.title),
      date:new Date(Number(g.posted)*1000).toISOString().slice(0,10),
      tags:g.tags || [],category:g.category,source,
      sourceUrl:`https://${source === 'exhentai' ? 'exhentai' : 'e-hentai'}.org/g/${g.gid}/${g.token}/`,
      thumb:thumbnailSource(g.thumb,source),pageCount:Number(g.filecount),rating:g.rating
    })));
  }
  return galleries;
}

export async function getGallery(gid,token,source='e-hentai') {
  const [gallery]=await metadata([[Number(gid),token]],source);
  if (!gallery) throw new Error('图集已被移除或暂时不可用');
  return galleryWithPages(gallery);
}

export function galleryWithPages(input) {
  const gallery={...input};
  const {gid,token,source}=gallery;
  gallery.pages=Array.from({length:gallery.pageCount},(_,index) => ({
    src:`/api/image?${new URLSearchParams({gid,token,page:String(index+1),...(source === 'exhentai' ? {source,scope:exScope || ''} : {})})}`,
    alt:`${gallery.title} · 第 ${index+1} 页`
  }));
  return gallery;
}

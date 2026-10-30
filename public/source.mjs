const sourceAPI='https://e-hentai.org/api.php';
const decode=value => {
  const textarea=document.createElement('textarea');
  textarea.innerHTML=value || '';
  return textarea.value;
};

export async function metadata(ids) {
  const galleries=[];
  // Source API batch size; these requests go directly from the browser to E-Hentai.
  for (let offset=0;offset<ids.length;offset+=25) {
    const response=await fetch(sourceAPI,{
      method:'POST',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({method:'gdata',gidlist:ids.slice(offset,offset+25),namespace:1})
    });
    if (!response.ok) throw new Error(`E-Hentai 请求失败（${response.status}）`);
    const data=await response.json();
    if (!data.gmetadata) throw new Error(data.error || 'E-Hentai 元数据暂时不可用');
    galleries.push(...data.gmetadata.filter(g => !g.error).map(g => ({
      id:`${g.gid}/${g.token}`,gid:Number(g.gid),token:g.token,
      title:decode(g.title),creator:g.uploader || 'Unknown',description:decode(g.title_jpn || g.title),
      date:new Date(Number(g.posted)*1000).toISOString().slice(0,10),
      tags:g.tags || [],category:g.category,source:'e-hentai',
      sourceUrl:`https://e-hentai.org/g/${g.gid}/${g.token}/`,
      thumb:g.thumb,pageCount:Number(g.filecount),rating:g.rating
    })));
  }
  return galleries;
}

export async function getGallery(gid,token) {
  const [gallery]=await metadata([[Number(gid),token]]);
  if (!gallery) throw new Error('图集已被源站移除或暂时不可用');
  gallery.pages=Array.from({length:gallery.pageCount},(_,index) => ({
    src:`/api/image?${new URLSearchParams({gid,token,page:String(index+1)})}`,
    alt:`${gallery.title} · 第 ${index+1} 页`
  }));
  return gallery;
}

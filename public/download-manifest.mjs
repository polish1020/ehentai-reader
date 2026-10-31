export const exportLimit=200;

export function exportRange(start,end,total) {
  start=Number(start);end=Number(end);total=Number(total);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>total||end-start+1>exportLimit)throw new Error(`请选择有效页码，每次最多 ${exportLimit} 张图片`);
  return Array.from({length:end-start+1},(_,index)=>start+index);
}

export function makeManifest(gallery,pages,items) {
  const source=gallery.source||'e-hentai';
  return {version:1,name:gallery.title,items:pages.filter(page=>items.has(page)).map(page=>{
    const url=items.get(page),extension=new URL(url).pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
    const ext=['jpg','jpeg','png','gif','webp','heic','heif','avif','bmp','tif','tiff','svg'].includes(extension)?extension:'img';
    return {id:`${source}-${gallery.gid}-${page}`,url,filename:`${String(page).padStart(6,'0')}.${ext}`};
  })};
}

export class ManifestExport {
  constructor(gallery,{pageLinks,request,changed=()=>{}}) {
    this.gallery=gallery;this.pageLinks=pageLinks;this.request=request;this.changed=changed;
    this.items=new Map();this.failures=new Map();this.pages=[];this.running=false;this.generatedAt=null;
  }
  cancel(){this.controller?.abort();}
  async run(start,end,{fresh=false}={}) {
    if(this.running)return;
    const pages=exportRange(start,end,this.gallery.pageCount);
    if(fresh||pages.join()!==this.pages.join()){this.items.clear();this.failures.clear();this.generatedAt=null;}
    this.pages=pages;this.controller=new AbortController();this.running=true;this.changed();
    const signal=this.controller.signal;
    try {
      const missing=pages.filter(page=>!this.items.has(page));
      for(let offset=0;offset<missing.length;offset+=8) {
        signal.throwIfAborted();const batch=missing.slice(offset,offset+8);
        const links=await this.pageLinks(this.gallery,batch,signal);signal.throwIfAborted();
        const response=await this.request('/api/image-links?'+new URLSearchParams({source:this.gallery.source||'e-hentai'}),{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gid:this.gallery.gid,token:this.gallery.token,links}),signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])
        });
        signal.throwIfAborted();
        for(const page of batch)this.failures.delete(page);
        for(const item of response.items||[]) {
          if(!batch.includes(item.page))continue;
          const url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password)continue;
          this.items.set(item.page,url.href);this.generatedAt??=Date.now();
        }
        for(const page of batch)if(!this.items.has(page))this.failures.set(page,response.failures?.find(item=>item.page===page)?.error||'未取得图片地址');
        this.changed();
      }
    } finally {this.running=false;this.changed();}
  }
  manifest(){return makeManifest(this.gallery,this.pages,this.items);}
}

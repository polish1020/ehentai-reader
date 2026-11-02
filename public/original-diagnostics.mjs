const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const positive=value=>number(value)>0?value:null;
const redact=value=>String(value||'').replace(/(?:https?:\/\/|blob:)[^\s"'<>]+/gi,'[URL已隐藏]').replace(/\b(?:Cookie|Authorization)\s*:[^\r\n]*/gi,'[凭证已隐藏]').replace(/(["']?(?:ipb_[a-z_]+|igneous|scope|token|key)["']?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1=[已隐藏]').slice(0,800);
const elapsed=(end,start)=>number(end)!==null&&number(start)!==null?Math.max(0,end-start):null;

export function originalFailureReport({gallery,index,immersive,state,error},environment=globalThis) {
  const nav=environment.navigator||{},viewport=environment.visualViewport,connection=nav.connection,controller=nav.serviceWorker?.controller;
  const failedAt=state.failedAt||Date.now(),id=/^(?:ex\/)?\d{1,12}\/[a-f0-9]{6,32}$/.test(gallery.id)?gallery.id:null;
  let server=null,resource=null,scriptPath=null;
  try {
    const url=new URL(state.sourceURL);
    server={protocol:url.protocol,host:url.host};
    resource=environment.performance?.getEntriesByName(url.href)?.at(-1)||null;
  }catch{ /* The address lookup may have failed before an image URL existed. */ }
  try {scriptPath=new URL(controller.scriptURL).pathname;}catch{ /* No active service worker. */ }
  return {
    app:'Gallery Reader',type:'original-image-error',version:1,time:new Date(failedAt).toISOString(),
    gallery:{id,url:id&&environment.location?.origin?new URL(`/#gallery/${id}`,environment.location.origin).href:null,page:index+1,pages:gallery.pages.length},
    mode:immersive?'immersive':'photo',stage:state.phase,
    timing:{startedAt:new Date(state.started).toISOString(),elapsedMs:elapsed(failedAt,state.started),addressMs:elapsed(state.addressAt||(state.phase==='address'?failedAt:null),state.started),imageMs:elapsed(state.loadedAt||(state.phase==='image'?failedAt:null),state.addressAt),decodeMs:state.phase==='decode'?elapsed(failedAt,state.loadedAt):null},
    error:{name:redact(error.name),message:redact(state.error),apiStatus:number(error.status),timeout:error.name==='AbortError'&&!state.cancelled},
    original:{width:positive(state.info?.width),height:positive(state.info?.height),size:/^\d+(?:\.\d+)?\s*(?:KiB|MiB|GiB|KB|MB|GB|B)$/i.test(state.info?.size||'')?state.info.size:null,server},
    image:state.image?{complete:!!state.image.complete,width:number(state.image.width),height:number(state.image.height)}:null,
    resource:resource?{durationMs:number(resource.duration),workerStartMs:number(resource.workerStart),httpStatus:positive(resource.responseStatus),transferBytes:positive(resource.transferSize),encodedBytes:positive(resource.encodedBodySize),decodedBytes:positive(resource.decodedBodySize)}:null,
    network:{online:typeof nav.onLine==='boolean'?nav.onLine:null,type:['slow-2g','2g','3g','4g'].includes(connection?.effectiveType)?connection.effectiveType:null,rttMs:number(connection?.rtt),downlinkMbps:number(connection?.downlink),saveData:typeof connection?.saveData==='boolean'?connection.saveData:null},
    browser:{userAgent:redact(nav.userAgent),language:redact(nav.language),deviceMemoryGB:number(nav.deviceMemory)},
    viewport:{width:number(environment.innerWidth),height:number(environment.innerHeight),pixelRatio:number(environment.devicePixelRatio),scale:number(viewport?.scale)},
    serviceWorker:{controlled:!!controller,state:controller?.state||null,scriptPath,shellCaches:[],imageCached:null,imageResponseType:null}
  };
}

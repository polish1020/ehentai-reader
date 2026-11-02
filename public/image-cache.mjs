export const imageCachePrefix='yijing-images-v1-';
export const imageCacheName=(source,scope) => imageCachePrefix+(source === 'exhentai' ? `ex-${scope}` : 'public');
const imageFlights=new Map();

export async function loadCachedImage(request,context,fetchImage=fetch,keepAlive=()=>{}) {
  if (!context || context.source === 'exhentai' && !context.scope) return fetchImage(request);
  const url=new URL(request.url),retry=url.searchParams.has('retry');
  url.searchParams.delete('retry');
  const key=url.href;
  const cache=await caches.open(imageCacheName(context.source,context.scope));
  if (!retry) { const saved=await cache.match(key); if (saved) return saved; }
  const flightKey=imageCacheName(context.source,context.scope)+'|'+request.url;
  if (imageFlights.has(flightKey)) return (await imageFlights.get(flightKey)).clone();
  let writing;
  const pending=(async()=>{
    const response=await fetchImage(request);
    if (response.ok || response.type === 'opaque') {
      writing=(async()=>{
        try {
          await cache.put(key,response.clone());
          const keys=await cache.keys();
          for (const old of keys.slice(0,Math.max(0,keys.length-200))) await cache.delete(old);
        } catch { /* The image still displays when browser storage is full. */ }
      })();
      keepAlive(writing);
    }
    return response;
  })();
  imageFlights.set(flightKey,pending);
  try { return (await pending).clone(); }
  finally {
    const cleanup=()=>{if (imageFlights.get(flightKey) === pending) imageFlights.delete(flightKey);};
    if(writing)writing.then(cleanup);else cleanup();
  }
}

export async function clearImageCaches(scope=null) {
  const keys=await caches.keys();
  await Promise.all(keys.filter(key => scope ? key === imageCacheName('exhentai',scope) : key.startsWith(imageCachePrefix)).map(key => caches.delete(key)));
}
export async function clearPrivateImageCaches(scope=null) {
  const keys=await caches.keys();
  await Promise.all(keys.filter(key => scope ? key === imageCacheName('exhentai',scope) : key.startsWith(imageCachePrefix+'ex-')).map(key => caches.delete(key)));
}
export async function imageCacheCount() {
  const keys=(await caches.keys()).filter(key => key.startsWith(imageCachePrefix));
  return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).length))).reduce((total,n) => total+n,0);
}

export async function cacheStorageUsage(storage=globalThis.navigator?.storage) {
  if(!storage?.estimate)return null;
  try {
    const estimate=await storage.estimate(),cache=estimate.usageDetails?.caches;
    if(typeof cache==='number'&&Number.isFinite(cache)&&cache>=0)return {kind:'cache',bytes:cache};
    if(typeof estimate.usage==='number'&&Number.isFinite(estimate.usage)&&estimate.usage>=0)return {kind:'site',bytes:estimate.usage};
  }catch{ /* Some browsers disable storage estimates in private mode. */ }
  return null;
}
export function formatBytes(bytes) {
  if(bytes===0)return '0 B';
  const units=['B','KB','MB','GB','TB'],index=Math.min(units.length-1,Math.max(0,Math.floor(Math.log(bytes)/Math.log(1024))));
  return `${(bytes/1024**index).toLocaleString('zh-CN',{maximumFractionDigits:index?1:0})} ${units[index]}`;
}

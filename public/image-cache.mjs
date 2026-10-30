export const imageCachePrefix='yijing-images-v1-';
export const imageCacheName=(source,scope) => imageCachePrefix+(source === 'exhentai' ? `ex-${scope}` : 'public');
const imageFlights=new Map();

export async function loadCachedImage(request,context,fetchImage=fetch) {
  if (!context || context.source === 'exhentai' && !context.scope) return fetchImage(request);
  const url=new URL(request.url),retry=url.searchParams.has('retry');
  url.searchParams.delete('retry');
  const key=url.href;
  const cache=await caches.open(imageCacheName(context.source,context.scope));
  if (!retry) { const saved=await cache.match(key); if (saved) return saved; }
  const flightKey=imageCacheName(context.source,context.scope)+'|'+request.url;
  if (imageFlights.has(flightKey)) return (await imageFlights.get(flightKey)).clone();
  const pending=(async()=>{
    const response=await fetchImage(request);
    if (response.ok || response.type === 'opaque') {
      try {
        await cache.put(key,response.clone());
        const keys=await cache.keys();
        for (const old of keys.slice(0,Math.max(0,keys.length-200))) await cache.delete(old);
      } catch { /* The image still displays when browser storage is full. */ }
    }
    return response;
  })();
  imageFlights.set(flightKey,pending);
  try { return (await pending).clone(); }
  finally {
    if (imageFlights.get(flightKey) === pending) imageFlights.delete(flightKey);
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

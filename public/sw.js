import {loadCachedImage,clearPrivateImageCaches} from './image-cache.mjs';
const VERSION = 'yijing-live-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/source.mjs', '/filters.mjs', '/navigation.mjs', '/reader-preload.mjs', '/photo-thumbnails.mjs', '/photo-viewer.mjs', '/image-cache.mjs', '/manifest.webmanifest', '/assets/icon.svg'];
const contexts=new Map();
const contextCache='yijing-image-context-v1';
const contextKey=id=>new URL(`/__image_context/${id}`,self.location.origin).href;
self.addEventListener('install', event => event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('yijing-live-') || key === 'yijing-v1') && key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message',event=>{
  if(event.data?.type==='image-context' && event.source?.id){
    const context={source:event.data.source,scope:event.data.scope || null};
    contexts.set(event.source.id,context);
    event.ports[0]?.postMessage({ok:true});
    event.waitUntil(caches.open(contextCache).then(cache=>cache.put(contextKey(event.source.id),Response.json(context))));
  }
  if(event.data?.type==='clear-private-images')event.waitUntil(clearPrivateImageCaches(event.data.scope));
});
async function imageContext(event,url){
  if(url.pathname==='/api/image' && url.origin===self.location.origin)return {source:url.searchParams.get('source') || 'e-hentai',scope:url.searchParams.get('scope')};
  if(url.pathname==='/api/thumbnail' && url.origin===self.location.origin)return {source:'exhentai',scope:url.searchParams.get('scope')};
  if(url.origin===self.location.origin && url.pathname.startsWith('/assets/'))return {source:'e-hentai'};
  if(contexts.has(event.clientId))return contexts.get(event.clientId);
  const saved=await (await caches.open(contextCache)).match(contextKey(event.clientId));
  return saved ? saved.json() : null;
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method!=='GET')return;
  if(event.request.destination==='image' && /^https?:$/.test(url.protocol)){
    event.respondWith(imageContext(event,url).then(context=>loadCachedImage(event.request,context)).catch(()=>fetch(event.request)));
    return;
  }
  if(url.origin!==self.location.origin || url.pathname.startsWith('/api/'))return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('/index.html') : new Response('Offline', {status: 503}))));
});

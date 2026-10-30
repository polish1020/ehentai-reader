import {load} from 'cheerio';

import {credentialCookie,authError} from './ex-session.mjs';
const sourceOrigin=source => source === 'exhentai' ? 'https://exhentai.org' : 'https://e-hentai.org';
const galleryURL=(gid,token,source) => `${sourceOrigin(source)}/g/${encodeURIComponent(gid)}/${encodeURIComponent(token)}/`;
const sourceName=source => source === 'exhentai' ? 'ExHentai' : 'E-Hentai';

async function upstream(input,options={},context={source:'e-hentai'}) {
  let url=new URL(input);
  const {source,credentials}=context;
  for (let redirects=0;redirects<5;redirects++) {
    const headers={'User-Agent':'YijingReader/0.3',...options.headers};
    if (source === 'exhentai' && url.protocol === 'https:' && (!url.port || url.port === '443') && ['exhentai.org','s.exhentai.org'].includes(url.hostname)) headers.Cookie=credentialCookie(credentials);
    const response=await fetch(url,{...options,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000),headers});
    if (credentials) for (const cookie of response.headers.getSetCookie()) {
      const match=cookie.match(/^igneous=([a-zA-Z0-9_-]+)/);
      if (match && url.hostname === 'exhentai.org') credentials.igneous=match[1];
    }
    if ([301,302,303,307,308].includes(response.status)) {
      const next=new URL(response.headers.get('location'),url);
      if (next.origin !== url.origin) throw new Error(`${sourceName(source)} 返回了站外跳转，请重新验证凭证`);
      await response.body?.cancel();url=next;continue;
    }
    if (!response.ok) throw Object.assign(new Error(`${sourceName(source)} 请求失败（${response.status}）`),{status:source === 'exhentai' && [401,403].includes(response.status) ? 401 : 502});
    if (source === 'exhentai' && !context.image && (response.headers.get('content-type') || '').startsWith('image/')) {
      await response.body?.cancel();throw authError('ExHentai 未接受当前凭证，请重新验证或更新 igneous');
    }
    return response;
  }
  throw new Error('源站重定向次数过多');
}

export async function verifyExSession(input) {
  const credentials={...input},original=credentials.igneous;
  const check=async () => parseListing(await (await upstream('https://exhentai.org/',{},{source:'exhentai',credentials})).text(),'exhentai');
  try { await check(); }
  catch (error) {
    if (!original) throw error;
    delete credentials.igneous;
    await check();
  }
  return {credentials,refreshedIgneous:!!credentials.igneous && credentials.igneous !== original};
}

export async function exMetadata(ids,credentials) {
  const gmetadata=[];
  for (let offset=0;offset<ids.length;offset+=25) {
    const response=await upstream('https://s.exhentai.org/api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'gdata',gidlist:ids.slice(offset,offset+25),namespace:1})},{source:'exhentai',credentials});
    const data=await response.json();
    if (!data.gmetadata) throw new Error('ExHentai 元数据暂时不可用，请检查凭证');
    gmetadata.push(...data.gmetadata);
  }
  return {gmetadata};
}

export async function exThumbnail(src,credentials) {
  const url=new URL(src);
  if (url.protocol !== 'https:' || url.hostname !== 's.exhentai.org' || url.port && url.port !== '443' || url.username || url.password || !/^\/(?:w|t|lt)\//.test(url.pathname)) throw Object.assign(new Error('不是源站缩略图地址'),{status:400});
  const context={source:'exhentai',credentials,image:true};
  let response;
  try { response=await upstream(url,{},context); }
  catch (error) {
    if (!(error instanceof TypeError) || error.message !== 'fetch failed') throw error;
    response=await upstream(url,{},context);
  }
  if (!(response.headers.get('content-type') || '').startsWith('image/')) throw authError('缩略图暂时不可用，请检查 ExHentai 凭证');
  return response;
}

export function parseListing(html,source='e-hentai') {
  const origin=sourceOrigin(source);
  const $=load(html), ids=new Map();
  $('a[href*="/g/"]').each((_,node) => {
    const match=$(node).attr('href').match(/\/g\/(\d+)\/([a-f0-9]+)\//);
    if (match) ids.set(match[1],[Number(match[1]),match[2]]);
  });
  const nextURL=$('#unext').attr('href');
  const next=nextURL ? new URL(nextURL,origin).searchParams.get('next') : null;
  const message=$('#ipb, .d, .homebox').first().text().trim();
  if (!ids.size && !/No (?:hits|galleries) found|Search (?:found|returned) no|No results found/i.test($.text())) {
    if (source === 'exhentai') throw authError('ExHentai 未返回图集列表，请检查凭证、igneous 或账户权限');
    throw new Error(`E-Hentai 未返回图集列表${message ? `：${message.slice(0,160)}` : '，请稍后重试'}`);
  }
  return {ids:[...ids.values()],next};
}

export async function listGalleries({query='',next='',excludedCategories='',source='e-hentai',credentials}={}) {
  const url=new URL(sourceOrigin(source));
  url.searchParams.set('inline_set','dm_l');
  if (query) url.searchParams.set('f_search',query);
  if (next) url.searchParams.set('next',next);
  if (excludedCategories) url.searchParams.set('f_cats',excludedCategories);
  const listing=parseListing(await (await upstream(url,{},{source,credentials})).text(),source);
  return listing;
}

export function parsePages(html) {
  const $=load(html);
  return [...new Set($('#gdt a[href*="/s/"]').map((_,node) => $(node).attr('href')).get())];
}

export async function resolveImage(gid,token,page,context={source:'e-hentai'}) {
  const origin=sourceOrigin(context.source);
  const url=galleryURL(gid,token,context.source);
  let links=parsePages(await (await upstream(url,{},context)).text());
  let pageURL=links.find(link => Number(link.match(/-(\d+)$/)?.[1]) === Number(page));
  if (!pageURL && links.length) {
    const index=Math.floor((Number(page)-1)/links.length);
    links=parsePages(await (await upstream(`${url}?p=${index}`,{},context)).text());
    pageURL=links.find(link => Number(link.match(/-(\d+)$/)?.[1]) === Number(page));
  }
  if (!pageURL) throw new Error('源站未返回此页图片，可能暂时不可用');
  const $=load(await (await upstream(new URL(pageURL,origin),{},context)).text());
  const src=$('#img').attr('src');
  if (!src) throw new Error('源站图片暂时不可用，请稍后重试');
  return new URL(src,origin).href;
}

export function apiError(error) {
  console.error('Gallery request failed:',error.message);
  return Response.json({error:error.message || '源站请求失败，请稍后重试'},{status:error.status || 502,headers:{'Cache-Control':'no-store'}});
}

export const json=data => Response.json(data,{headers:{'Cache-Control':'no-store'}});

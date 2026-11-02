import {load} from 'cheerio';

import {credentialCookie,authError} from './ex-session.mjs';
import {categories} from '../public/filters.mjs';
export const sourceOrigin=source => source === 'exhentai' ? 'https://exhentai.org' : 'https://e-hentai.org';
export const galleryURL=(gid,token,source) => `${sourceOrigin(source)}/g/${encodeURIComponent(gid)}/${encodeURIComponent(token)}/`;
const sourceName=source => source === 'exhentai' ? 'ExHentai' : 'E-Hentai';

export async function upstream(input,options={},context={source:'e-hentai'}) {
  let url=new URL(input);
  const {source,credentials}=context;
  for (let redirects=0;redirects<5;redirects++) {
    const headers={'User-Agent':'YijingReader/0.3',...options.headers};
    const credentialHost=source === 'exhentai' ? ['exhentai.org','s.exhentai.org'] : context.account ? ['e-hentai.org','api.e-hentai.org'] : [];
    if (credentials && url.protocol === 'https:' && (!url.port || url.port === '443') && credentialHost.includes(url.hostname)) headers.Cookie=credentialCookie(credentials);
    if (options.method==='POST' && (context.account || source==='exhentai')) {
      headers.Origin=sourceOrigin(source);headers.Referer=sourceOrigin(source)+'/';
    }
    const {returnRedirect,...fetchOptions}=options;
    const timeout=AbortSignal.timeout(30000);
    const response=await fetch(url,{...fetchOptions,redirect:'manual',cache:'no-store',signal:fetchOptions.signal?AbortSignal.any([fetchOptions.signal,timeout]):timeout,headers});
    if (credentials) for (const cookie of response.headers.getSetCookie()) {
      const match=cookie.match(/^igneous=([a-zA-Z0-9_-]+)/);
      if (match && url.hostname === 'exhentai.org') credentials.igneous=match[1];
    }
    if ([301,302,303,307,308].includes(response.status)) {
      if (returnRedirect) return response;
      const next=new URL(response.headers.get('location'),url);
      if (next.origin !== url.origin) throw new Error(`${sourceName(source)} 返回了站外跳转，请重新验证凭证`);
      if (response.status===303 && options.method!=='HEAD' || [301,302].includes(response.status) && options.method==='POST') {
        const headers=new Headers(options.headers);headers.delete('Content-Type');
        options={method:'GET',headers:Object.fromEntries(headers)};
      }
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
  if (!ids.size && !/No (?:hits|galleries|favorites|favorited galleries) found|You (?:have no|do not have any|have not added any) favorites|Search (?:found|returned) no|No results found|no watched tags|not set any watched tags/i.test($.text())) {
    if (source === 'exhentai') throw authError('ExHentai 未返回图集列表，请检查凭证、igneous 或账户权限');
    throw new Error(`E-Hentai 未返回图集列表${message ? `：${message.slice(0,160)}` : '，请稍后重试'}`);
  }
  return {ids:[...ids.values()],next};
}

export async function listGalleries({query='',next='',excludedCategories='',feed='latest',source='e-hentai',credentials,account=false,filters={}}={}) {
  const popular=feed === 'popular' && !query.trim();
  const ranks={yesterday:15,month:13,year:12,all:11};
  const ranked=Object.hasOwn(ranks,feed) && !query.trim();
  // Toplists are shared and exist only on E-Hentai. The selected source still
  // controls metadata and reading; its credentials never accompany this public request.
  const context=ranked ? {source:'e-hentai'} : {source,credentials,account};
  const url=new URL(ranked ? '/toplist.php' : feed === 'watched' ? '/watched' : feed === 'favorites' ? '/favorites.php' : popular ? '/popular' : '/',sourceOrigin(context.source));
  if (ranked) { url.searchParams.set('tl',ranks[feed]);url.searchParams.set('p',String(Math.max(0,Number(next)||0))); }
  url.searchParams.set('inline_set',feed==='favorites'?'fs_f':'dm_l');
  if (query) url.searchParams.set('f_search',query);
  if (next && !popular && !ranked) url.searchParams.set('next',next);
  if (excludedCategories) url.searchParams.set('f_cats',excludedCategories);
  for (const name of ['f_srdd','f_spf','f_spt','f_sto','f_sh','f_shash','fs_similar','fs_covers','fs_exp','favcat']) if (filters[name] !== undefined && filters[name] !== '') url.searchParams.set(name,String(filters[name]));
  const html=await (await upstream(url,{},context)).text();
  if (account && /<title>[^<]*Login/i.test(html)) throw authError('源站账号会话已失效，请重新验证凭证');
  const listing=parseListing(html,context.source);
  if (popular) listing.next=null;
  if (ranked) {
    const $=load(html),page=Number(url.searchParams.get('p'));
    const more=$('a[href*="toplist.php"]').toArray().some(node=>{const nextURL=new URL($(node).attr('href'),url);return Number(nextURL.searchParams.get('tl'))===ranks[feed] && Number(nextURL.searchParams.get('p'))===page+1;});
    listing.next=more ? String(page+1) : null;
    // The native toplist ignores f_cats; filter its known categories before
    // requesting metadata to avoid relaying entries the user has excluded.
    if (Number(excludedCategories)) {
      const blocked=new Set();
      $('.cn,.cs').each((_,node)=>{
        const category=categories.find(category=>category.name===$(node).text().trim());
        if (category && (Number(excludedCategories)&category.bit)) $(node).closest('tr').find('a[href*="/g/"]').each((_,link)=>{
          const gid=$(link).attr('href').match(/\/g\/(\d+)\//)?.[1];if(gid)blocked.add(Number(gid));
        });
      });
      listing.ids=listing.ids.filter(([gid])=>!blocked.has(gid));
    }
  }
  return listing;
}

export function parsePages(html) {
  const $=load(html);
  return [...new Set($('#gdt a[href*="/s/"]').map((_,node) => $(node).attr('href')).get())];
}

export function parseThumbnails(html,origin='https://e-hentai.org') {
  const $=load(html),pages=[];
  $('#gdt a[href*="/s/"]').each((_,node)=>{
    const link=$(node),match=link.attr('href').match(/-(\d+)$/);
    if (!match) return;
    const image=link.find('img').first(),styled=link.find('[style*="url("]').first();
    const style=styled.attr('style') || '',background=style.match(/url\(["']?([^)'"\s]+)["']?\)\s*(-?[\d.]+)px\s*(-?[\d.]+)(?:px)?/);
    const src=background?.[1] || image.attr('src');
    if (!src) return;
    pages.push({index:Number(match[1])-1,src:new URL(src,origin).href,pageURL:new URL(link.attr('href'),origin).href,
      width:Number(style.match(/(?:^|;)\s*width:([\d.]+)px/)?.[1] || image.attr('width') || 100),
      height:Number(style.match(/(?:^|;)\s*height:([\d.]+)px/)?.[1] || image.attr('height') || 140),
      ...(background ? {x:Number(background[2]),y:Number(background[3]),sprite:true} : {})});
  });
  if (!pages.length) throw new Error('源站缩略图暂时不可用，请重试');
  return {pages,perPage:pages.length};
}

export async function galleryThumbnails(gid,token,page=0,context={source:'e-hentai'}) {
  const url=`${galleryURL(gid,token,context.source)}?p=${page}`;
  return parseThumbnails(await (await upstream(url,{},context)).text(),sourceOrigin(context.source));
}

async function imagePage(gid,token,page,context,{freeOriginal=false}={}) {
  const origin=sourceOrigin(context.source);
  const url=galleryURL(gid,token,context.source);
  const response=await upstream(url,{},context),value=await response.text();
  if(freeOriginal) {
    const $=load(value),postedText=$('#gdd tr').toArray().map(row=>$(row).find('td').map((_,cell)=>$(cell).text().trim()).get()).find(cells=>cells[0]==='Posted:')?.[1];
    const posted=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(postedText||'')?Date.parse(postedText.replace(' ','T')+':00Z'):NaN;
    const now=Math.max(Date.now(),Date.parse(response.headers.get('date'))||0),age=now-posted;
    // New galleries are exempt from original-download GP fees. Stay below
    // three calendar months and 90 days; never use FIQ or off-peak eligibility.
    if(!Number.isFinite(age)||age<0||age>=88*24*60*60*1000)throw Object.assign(new Error('此图册无法确认免积分，已取消原图请求；仅支持近期可确认免费的原图'),{status:403});
  }
  let links=parsePages(value);
  let pageURL=links.find(link => Number(link.match(/-(\d+)$/)?.[1]) === Number(page));
  if (!pageURL && links.length) {
    const index=Math.floor((Number(page)-1)/links.length);
    links=parsePages(await (await upstream(`${url}?p=${index}`,{},context)).text());
    pageURL=links.find(link => Number(link.match(/-(\d+)$/)?.[1]) === Number(page));
  }
  if (!pageURL) throw new Error('源站未返回此页图片，可能暂时不可用');
  return load(await (await upstream(new URL(pageURL,origin),{},context)).text());
}

export async function resolveImage(gid,token,page,context={source:'e-hentai'}) {
  const $=await imagePage(gid,token,page,context);
  const src=$('#img').attr('src');
  if (!src) throw new Error('源站图片暂时不可用，请稍后重试');
  return new URL(src,sourceOrigin(context.source)).href;
}

export async function resolveOriginalImage(gid,token,page,context) {
  const origin=sourceOrigin(context.source),$=await imagePage(gid,token,page,context,{freeOriginal:true});
  const link=$('a[href]').toArray().map(node=>new URL($(node).attr('href'),origin)).find(url=>url.origin===origin && /^\/fullimg(?:\.php|\/)/.test(url.pathname));
  if(!link)throw new Error('源站未提供原图入口，当前图片可能已是原图');
  // Resolve only the protected entry. The browser downloads the actual image.
  const response=await upstream(link,{returnRedirect:true},context);
  const location=response.headers.get('location');
  await response.body?.cancel();
  if(![301,302,303,307,308].includes(response.status)||!location)throw new Error('无法获取原图，请检查账号凭证、积分或图片配额');
  const target=new URL(location,origin);
  const imageHost=target.hostname.endsWith('.hath.network') || target.hostname==='ehgt.org' || target.hostname.endsWith('.ehgt.org');
  if(target.protocol!=='https:' || target.username || target.password || !imageHost)throw new Error('源站未返回可直接加载的原图地址，请检查账号凭证或图片配额');
  return target.href;
}

export function apiError(error) {
  console.error('Gallery request failed:',error.message);
  return Response.json({error:error.message || '源站请求失败，请稍后重试'},{status:error.status || 502,headers:{'Cache-Control':'no-store'}});
}

export const json=data => Response.json(data,{headers:{'Cache-Control':'no-store'}});

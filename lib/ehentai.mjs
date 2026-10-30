import {load} from 'cheerio';

const origin='https://e-hentai.org';
const galleryURL=(gid,token) => `${origin}/g/${encodeURIComponent(gid)}/${encodeURIComponent(token)}/`;

async function upstream(url,options={}) {
  const response=await fetch(url,{...options,cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'YijingReader/0.2',...options.headers}});
  if (!response.ok) throw new Error(`E-Hentai 请求失败（${response.status}）`);
  return response;
}

export function parseListing(html) {
  const $=load(html), ids=new Map();
  $('a[href*="/g/"]').each((_,node) => {
    const match=$(node).attr('href').match(/\/g\/(\d+)\/([a-f0-9]+)\//);
    if (match) ids.set(match[1],[Number(match[1]),match[2]]);
  });
  const nextURL=$('#unext').attr('href');
  const next=nextURL ? new URL(nextURL,origin).searchParams.get('next') : null;
  const message=$('#ipb, .d, .homebox').first().text().trim();
  if (!ids.size && !/No (?:hits|galleries) found|Search (?:found|returned) no|No results found/i.test($.text())) {
    throw new Error(`E-Hentai 未返回图集列表${message ? `：${message.slice(0,160)}` : '，请稍后重试'}`);
  }
  return {ids:[...ids.values()],next};
}

export async function listGalleries({query='',next='',excludedCategories=''}={}) {
  const url=new URL(origin);
  url.searchParams.set('inline_set','dm_l');
  if (query) url.searchParams.set('f_search',query);
  if (next) url.searchParams.set('next',next);
  if (excludedCategories) url.searchParams.set('f_cats',excludedCategories);
  const listing=parseListing(await (await upstream(url)).text());
  return listing;
}

export function parsePages(html) {
  const $=load(html);
  return [...new Set($('#gdt a[href*="/s/"]').map((_,node) => $(node).attr('href')).get())];
}

export async function resolveImage(gid,token,page) {
  const url=galleryURL(gid,token);
  let links=parsePages(await (await upstream(url)).text());
  let pageURL=links.find(link => Number(link.match(/-(\d+)$/)?.[1]) === Number(page));
  if (!pageURL && links.length) {
    const index=Math.floor((Number(page)-1)/links.length);
    links=parsePages(await (await upstream(`${url}?p=${index}`)).text());
    pageURL=links.find(link => Number(link.match(/-(\d+)$/)?.[1]) === Number(page));
  }
  if (!pageURL) throw new Error('源站未返回此页图片，可能暂时不可用');
  const $=load(await (await upstream(new URL(pageURL,origin))).text());
  const src=$('#img').attr('src');
  if (!src) throw new Error('源站图片暂时不可用，请稍后重试');
  return new URL(src,origin).href;
}

export function apiError(error) {
  console.error('E-Hentai request failed:',error.message);
  return Response.json({error:error.message || '源站请求失败，请稍后重试'},{status:502,headers:{'Cache-Control':'no-store'}});
}

export const json=data => Response.json(data,{headers:{'Cache-Control':'no-store'}});

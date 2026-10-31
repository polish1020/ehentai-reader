import {load} from 'cheerio';
import {upstream,sourceOrigin} from './ehentai.mjs';
import {galleryRef} from './source-features.mjs';
import {authError} from './ex-session.mjs';

const bad=message=>Object.assign(new Error(message),{status:400});

export async function imageLinks(input,context,signal) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw bad('请求内容不正确');
  const {gid}=galleryRef(input),origin=sourceOrigin(context.source);
  if(!Array.isArray(input.links)||!input.links.length||input.links.length>8)throw bad('每批仅支持解析 1–8 张图片');
  const seen=new Set();
  const links=input.links.map(item=>{
    const page=Number(item?.page);let url;
    try {url=new URL(item?.url);} catch {throw bad('图片页地址不正确');}
    if(!Number.isSafeInteger(page)||page<1||page>1_000_000||seen.has(page)||url.origin!==origin||url.username||url.password||url.search||url.hash||!new RegExp(`^/s/[a-f0-9]{6,32}/${gid}-${page}$`).test(url.pathname))throw bad('图片页必须属于当前图集和内容源');
    seen.add(page);return {page,url};
  });
  const items=[],failures=[];let next=0,fatal;
  async function worker() {
    while(next<links.length&&!fatal) {
      signal?.throwIfAborted();const {page,url}=links[next++];
      try {
        const $=load(await(await upstream(url,{signal},context)).text()),src=$('#img').attr('src');
        if(!src){if(/log\s*in/i.test($('title').text()))throw authError();throw new Error('源站未返回此页图片地址');}
        const image=new URL(src,origin);
        if(/\/509\.(?:gif|png)$/.test(image.pathname))throw Object.assign(new Error('源站图片访问额度不足，请稍后再生成清单'),{status:429});
        if(image.protocol!=='https:'||image.username||image.password)throw new Error('此图片没有可导出的 HTTPS 直链');
        items.push({page,url:image.href});
      } catch(error) {
        if(signal?.aborted)throw error;
        if([401,429].includes(error.status))fatal=error;
        else failures.push({page,error:error.message});
      }
    }
  }
  await Promise.all([worker(),worker()]);
  if(fatal)throw fatal;
  return {items:items.sort((a,b)=>a.page-b.page),failures:failures.sort((a,b)=>a.page-b.page)};
}

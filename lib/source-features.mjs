import {load} from 'cheerio';
import {upstream,sourceOrigin,galleryURL,parseListing} from './ehentai.mjs';
import {authError} from './ex-session.mjs';

const fail=message=>Object.assign(new Error(message),{status:400});
export function galleryRef(input) {
  const gid=String(input.gid || ''),token=String(input.token || '');
  if (!/^\d{1,12}$/.test(gid) || !/^[a-f0-9]{6,32}$/.test(token)) throw fail('图集地址不正确');
  return {gid:Number(gid),token};
}
const form=values=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values).toString()});
async function html(url,options,context) {
  const value=await (await upstream(url,options,context)).text();
  if (/<title>[^<]*(?:Login|Log In)/i.test(value) || /You must be logged in/i.test(value)) throw authError('请在设置中验证源站账号凭证');
  return value;
}
function apiKeys(value) {
  const apiuid=Number(value.match(/\bapiuid\s*=\s*(-?\d+)/)?.[1]),apikey=value.match(/\bapikey\s*=\s*["']([a-zA-Z0-9_-]+)["']/)?.[1];
  if (!(apiuid>0) || !apikey) throw authError('源站没有返回账号操作权限，请重新验证凭证');
  return {apiuid,apikey};
}
async function api(context,keys,data) {
  const endpoint=context.source === 'exhentai' ? 'https://exhentai.org/api.php' : 'https://api.e-hentai.org/api.php';
  const result=await (await upstream(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,...keys})},context)).json();
  if (result.login) throw authError('源站账号会话已失效');
  if (result.error) throw fail(String(result.error));
  return result;
}
export function parseGalleryInfo(value) {
  const $=load(value);
  const comments=$('#cdiv > .c1').map((_,node)=>{
    const item=$(node),body=item.find('.c6').first();body.find('br').replaceWith('\n');
    return {id:Number((body.attr('id')||'').match(/\d+/)?.[0]),author:item.find('.c3 a').first().text().trim(),posted:item.find('.c3').text().split(' by:')[0].replace(/^Posted on /,'').trim(),score:item.find('.c5 span').first().text().trim(),text:body.text().trim(),own:item.find('.c4 a').toArray().some(a=>$(a).text().trim()==='Edit')};
  }).get();
  return {title:$('#gn').text(),rating:$('#rating_label').text().trim(),ratingCount:Number($('#rating_count').text()||0),favorite:$('#favoritelink').text().trim(),comments};
}
export async function galleryInfo(input,context) {
  const {gid,token}=galleryRef(input);
  return parseGalleryInfo(await html(galleryURL(gid,token,context.source),{},context));
}
export function parseTags(value) {
  const $=load(value);
  return {sets:$('#tagset_outer select option,#tagset option').map((_,node)=>({id:Number($(node).attr('value')),name:$(node).text()})).get(),tags:$('#usertags_outer > div[id^="usertag_"]').map((_,node)=>{
    const item=$(node),id=Number(item.attr('id').replace('usertag_',''));
    if (!id) return null;
    return {id,tag:item.find(`#tagpreview_${id}`).attr('title') || '',watch:item.find(`#tagwatch_${id}`).is('[checked]'),hidden:item.find(`#taghide_${id}`).is('[checked]'),color:item.find(`#tagcolor_${id}`).attr('value') || '',weight:Number(item.find(`#tagweight_${id}`).attr('value') || 10)};
  }).get()};
}
export async function accountTags(input,context) {
  const set=Math.min(10,Math.max(1,Number(input.set)||1));
  return parseTags(await html(`https://e-hentai.org/mytags?tagset=${set}`,{},{...context,source:'e-hentai',account:true}));
}
export async function updateTag(input,context) {
  const set=Math.min(10,Math.max(1,Number(input.set)||1)),tag=String(input.tag || '').trim();
  if (!tag || tag.length>200) throw fail('请填写标签');
  const weight=Math.min(99,Math.max(-99,Number(input.weight)||0)),color=String(input.color||'').replace(/^#/,'');
  if (color && !/^[a-f0-9]{6}$/i.test(color)) throw fail('标签颜色不正确');
  const url=`https://e-hentai.org/mytags?tagset=${set}`,account={...context,source:'e-hentai',account:true};
  let value;
  if (input.id && input.remove) {
    value=await html(url,form({usertag_action:'mass',usertag_target:'0','modify_usertags[]':String(Number(input.id)),tagname_new:'',tagcolor_new:'',tagweight_new:'10'}),account);
  } else if (input.id) {
    const current=await html(url,{},account);
    await api(account,apiKeys(current),{method:'setusertag',tagid:Number(input.id),tagcolor:color,tagweight:String(weight),tagwatch:input.watch?1:0,taghide:input.hidden?1:0});
    return accountTags(input,context);
  } else {
    value=await html(url,form({usertag_action:'add',usertag_target:'0',tagname_new:tag,tagcolor_new:color,tagweight_new:String(weight),...(input.watch?{tagwatch_new:'on'}:{}),...(input.hidden?{taghide_new:'on'}:{})}),account);
  }
  if (/No more tags can be added/i.test(value)) throw fail('源站标签集已满，请删除部分标签或选择其他标签集');
  return parseTags(value);
}
export async function favoriteGroups(context) {
  const $=load(await html(`${sourceOrigin(context.source)}/favorites.php`,{},context));
  const groups=[];
  $('a[href*="favcat="]').each((_,node)=>{
    const id=new URL($(node).attr('href'),sourceOrigin(context.source)).searchParams.get('favcat');
    if (/^[0-9]$/.test(id) && !groups.some(group=>group.id===Number(id))) groups.push({id:Number(id),name:$(node).text().trim()});
  });
  if (!groups.length) $('.fp').each((i,node)=>{if(i<10)groups.push({id:i,name:$(node).find('.fpt').text().trim() || $(node).children('div').last().text().trim() || `收藏分组 ${i+1}`});});
  return {groups:Array.from({length:10},(_,id)=>groups.find(group=>group.id===id)||{id,name:`收藏分组 ${id+1}`})};
}
export async function favoriteInfo(input,context) {
  const {gid,token}=galleryRef(input),origin=sourceOrigin(context.source);
  const $=load(await html(`${origin}/gallerypopups.php?${new URLSearchParams({gid,t:token,act:'addfav'})}`,{},context));
  const groups=$('[name=favcat]').toArray().flatMap(node=>{
    const item=$(node);
    if(node.tagName==='select')return item.find('option').map((_,option)=>({id:Number($(option).attr('value')),name:$(option).text().trim()})).get().filter(group=>Number.isInteger(group.id)&&group.id>=0&&group.id<=9);
    const id=Number(item.attr('value'));
    return Number.isInteger(id)&&id>=0&&id<=9?[{id,name:item.closest('label').text().trim() || `收藏分组 ${id+1}`}]:[];
  });
  const selected=$('[name=favcat] option[selected]').attr('value') ?? $('[name=favcat][checked]').attr('value');
  return {groups:groups.length?groups:Array.from({length:10},(_,id)=>({id,name:`收藏分组 ${id+1}`})),group:selected===undefined?null:Number(selected),note:$('[name=favnote]').val()||''};
}
export async function updateFavorite(input,context) {
  const {gid,token}=galleryRef(input),group=Number(input.group);
  if (!input.remove && !(Number.isInteger(group)&&group>=0&&group<=9)) throw fail('请选择源站收藏分组');
  const note=String(input.note || '');
  if (new TextEncoder().encode(note).length>200) throw fail('收藏备注最多 200 字节');
  const value=await html(`${sourceOrigin(context.source)}/gallerypopups.php?${new URLSearchParams({gid,t:token,act:'addfav'})}`,form({favcat:input.remove?'favdel':String(group),favnote:note,apply:input.remove?'Apply Changes':'Add to Favorites',update:'1'}),context);
  if (/Invalid (?:Gallery|Token)|error|could not/i.test(load(value)('#messagebox').text())) throw fail('源站未保存收藏，请重试');
  return {saved:!input.remove};
}
export async function galleryAction(input,context) {
  const {gid,token}=galleryRef(input),url=galleryURL(gid,token,context.source);
  if (input.action==='comment') {
    const text=String(input.text || '').trim();
    if (!text || text.length>20000) throw fail('请填写评论，最多 20000 字');
    const before=new Set(parseGalleryInfo(await html(url,{},context)).comments.map(comment=>comment.id));
    const result=await html(url,form(input.editId?{edit_comment:String(Number(input.editId)),commenttext_edit:text}:{commenttext_new:text}),context);
    const parsed=parseGalleryInfo(result);
    const plain=text.replace(/\[\/?[a-z]+(?:=[^\]]*)?\]/gi,'').replace(/\s+/g,' ').trim();
    if (!plain || !parsed.comments.some(comment=>(input.editId?comment.id===Number(input.editId):!before.has(comment.id)) && comment.text.replace(/\s+/g,' ').includes(plain.slice(0,80)))) throw fail('源站未确认评论已发布，请检查评论内容及账号权限');
    return parsed;
  }
  const keys=apiKeys(await html(url,{},context));
  let data;
  if (input.action==='rating') {
    const rating=Number(input.rating);
    if (!(rating>=.5&&rating<=5&&Number.isInteger(rating*2))) throw fail('评分应为 0.5–5 星');
    data={method:'rategallery',rating:rating*2};
  } else if (input.action==='tag-vote') {
    if (![1,-1].includes(Number(input.vote)) || !String(input.tag||'').trim() || String(input.tag).length>200) throw fail('标签投票不正确');
    data={method:'taggallery',tags:input.tag,vote:Number(input.vote)};
  } else if (input.action==='comment-vote') {
    if (![1,-1].includes(Number(input.vote)) || !(Number(input.commentId)>0)) throw fail('评论投票不正确');
    data={method:'votecomment',comment_id:Number(input.commentId),comment_vote:Number(input.vote)};
  } else throw fail('不支持的图集操作');
  const result=await api(context,keys,{...data,gid,token});
  // Return only display values, never source API keys or untrusted HTML panes.
  return {ok:true,rating:result.rating_avg,score:result.comment_score};
}
function downloadURL(value,origin) {
  try {
    const url=new URL(value,origin);
    if (url.protocol!=='https:' || url.username || url.password || url.port && url.port!=='443') return null;
    return /(?:^|\.)(?:e-hentai\.org|exhentai\.org|hath\.network|hentaiathome\.net|ehtracker\.org)$/.test(url.hostname) ? url.href : null;
  }catch{return null;}
}
export function parseTorrents(value,origin) {
  const $=load(value),torrents=[];
  $('#torrentinfo a[href]').each((_,node)=>{
    const url=downloadURL($(node).attr('href'),origin);
    if (!url || !/\.torrent(?:\?|$)/.test(url)) return;
    const hash=url.match(/([a-f0-9]{40})/i)?.[1];
    torrents.push({title:$(node).text().trim(),url,magnet:hash?`magnet:?xt=urn:btih:${hash}`:null,info:$(node).closest('form').text().replace(/\s+/g,' ').trim().slice(0,600)});
  });
  return {torrents};
}
export async function torrents(input,context) {
  const {gid,token}=galleryRef(input),origin=sourceOrigin(context.source);
  return parseTorrents(await html(`${origin}/gallerytorrents.php?${new URLSearchParams({gid,t:token})}`,{},context),origin);
}
export function parseArchive(value,origin) {
  const $=load(value),options=[];
  $('script,style,iframe').remove();
  $('form').each((_,node)=>{
    const item=$(node),kind=item.find('[name=dltype]').attr('value');
    if (!['org','res'].includes(kind)) return;
    options.push({kind,label:kind==='org'?'原始压缩包':'重采样压缩包',description:item.parent().text().replace(/\s+/g,' ').trim().slice(0,700)});
  });
  const links=$('a[href]').map((_,node)=>({label:$(node).text().trim(),url:downloadURL($(node).attr('href'),origin),continuation:$(node).closest('#continue').length>0})).get().filter(link=>link.url && (link.continuation || /\/archive\/|\.zip(?:\?|$)|\/hathdl\//.test(link.url))).map(({continuation,...link})=>link);
  return {options,links,message:($('#db').text() || $('body').text()).replace(/\s+/g,' ').trim().slice(0,1400)};
}
export async function archive(input,context,prepare=false) {
  const {gid,token}=galleryRef(input),origin=sourceOrigin(context.source);
  if (prepare && !['org','res'].includes(input.kind)) throw fail('请选择压缩包类型');
  const options=prepare?form({dltype:input.kind,dlcheck:input.kind==='org'?'Download Original Archive':'Download Resample Archive'}):{};
  return parseArchive(await html(`${origin}/archiver.php?${new URLSearchParams({gid,token})}`,options,context),origin);
}
export async function imageSearch(formData,context) {
  const file=formData.get('file');
  if (!(file instanceof Blob) || !file.size || file.size>3*1024*1024 || !/^image\//.test(file.type)) throw fail('请选择不超过 3 MB 的图片');
  const data=new FormData();data.set('sfile',file,'search-image');data.set('f_sfile','File Search');data.set('fs_exp','on');
  if (formData.get('similar')!=='false') data.set('fs_similar','on');
  if (formData.get('covers')==='true') data.set('fs_covers','on');
  const url=context.source==='exhentai'?'https://exhentai.org/upld/image_lookup.php':'https://upld.e-hentai.org/image_lookup.php';
  const response=await upstream(url,{method:'POST',headers:{Origin:sourceOrigin(context.source),Referer:sourceOrigin(context.source)+'/'},body:data,returnRedirect:true},context);
  const location=response.headers.get('location');
  await response.body?.cancel();
  if (!location) throw fail('源站未返回图片搜索结果，请换一张图片重试');
  const target=new URL(location,sourceOrigin(context.source));
  if (target.origin!==sourceOrigin(context.source) || target.pathname!=='/') throw fail('源站返回了非预期的图片搜索地址');
  const hash=target.searchParams.get('f_shash');
  if (!/^[a-f0-9]{40}$/i.test(hash||'')) throw fail('源站未返回图片搜索哈希');
  return {hash,filters:{fs_similar:target.searchParams.get('fs_similar') || (formData.get('similar')!=='false'?'on':''),fs_covers:target.searchParams.get('fs_covers') || (formData.get('covers')==='true'?'on':''),fs_exp:'on'}};
}

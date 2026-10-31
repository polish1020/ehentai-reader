import {metadata,errorMessage,getGallery,galleryWithPages,galleryReference,setExScope,thumbnailSource} from './source.mjs';
import {categories,excludedCategories,tagQuery} from './filters.mjs';
import {ListStore} from './navigation.mjs';
import {ReaderPreloader,preloadNeighbors} from './reader-preload.mjs';
import {ThumbnailStore,ThumbnailView} from './photo-thumbnails.mjs';
import {PhotoViewer} from './photo-viewer.mjs';
import {discoveryPage} from './discovery.mjs';
import {Favorites,favoriteMatches} from './favorites.mjs';
import {InfiniteList} from './list-loader.mjs';
import {SourceFeatures} from './source-features.mjs';
import {feeds,feedFor,searchOptions,accepts,quickTags} from './source-options.mjs';
import {icon,decorateIcons} from './icons.mjs';
import {imageCacheCount,cacheStorageUsage,formatBytes,clearImageCaches,clearPrivateImageCaches} from './image-cache.mjs';
import {cleanSearchHistory,saveSearch,recentSearches,searchScope,visitTime} from './user-records.mjs';
document.addEventListener('keydown',event => {
  if (event.key === 'Tab') document.documentElement.dataset.keyboardFocus = 'true';
},true);
document.addEventListener('pointerdown',() => { delete document.documentElement.dataset.keyboardFocus; },true);
const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const names = {discover:'发现', favorites:'收藏', history:'足迹', library:'全部图集'};
const pageNames={...names,search:'搜索'};
const icons = {search:icon('search'),discover:icon('discover'), favorites:icon('heart'), history:icon('clock'), library:icon('grid')};
let state;
try { state = JSON.parse(localStorage.getItem('yijing-v1')) || {}; } catch { state = {}; }
if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
state.favorites = Array.isArray(state.favorites) ? state.favorites.filter(id => typeof id === 'string') : [];
state.progress = state.progress && typeof state.progress === 'object' && !Array.isArray(state.progress) ? state.progress : {};
state.searchHistory = cleanSearchHistory(state.searchHistory);
state.mode = 'scroll';
state.direction = state.direction === 'rtl' ? 'rtl' : 'ltr';
state.theme = ['light','dark','system'].includes(state.theme) ? state.theme : 'system';
state.categories = Array.isArray(state.categories) ? categories.map(category => category.name).filter(name => state.categories.includes(name)) : categories.map(category => category.name);
state.source = state.source === 'exhentai' ? 'exhentai' : 'e-hentai';
state.tagPreferences = Array.isArray(state.tagPreferences) ? state.tagPreferences.filter(pref=>pref&&typeof pref.tag==='string') : [];
let exSession = {configured:false,scope:null}, authRequest = 0;
let authQueue = Promise.resolve();
const popularFeed = target => target.view === 'discover' && feedFor(target)==='popular' && !searchOptions(target.query,target.filters).query && !target.filters?.f_shash;
const rankingFeed = target => target.view==='discover' && ['yesterday','month','year','all'].includes(feedFor(target)) && !searchOptions(target.query,target.filters).query && !target.filters?.f_shash;
const accountList = target => feedFor(target)==='watched' || feedFor(target)==='favorites';
const collectionView = target => target.view==='search' ? target.searchScope || 'search' : target.view;
const favoriteCollection=target=>collectionView(target)==='favorites';
const localCollection = target => collectionView(target)==='history';
const searchReady = target => !!searchOptions(target.query,target.filters).query || Object.entries(target.filters||{}).some(([key,value])=>key!=='favcat'&&!!value);
const knownGalleries = new Map(), thumbnailStores = new Map();
const favoriteChecks=new Map();
let detailThumbnails, photoRequest = 0;
let session;
try { session = sessionStorage; } catch { /* Keep navigation in memory. */ }
const lists = new ListStore(session);
let list, entry, appliedEntry = null, restoringScroll = false, leavingPage = false;
let activeGallery = null, currentPage = 0, readerMode = state.mode;
let readerPreloader, readerScrollFrame, readerRenderVersion = 0, toastTimer, renderTimer, debounceTarget, scrollTimer, readerRequest = 0, detailRequest = 0;
let storageWarning = false;
history.scrollRestoration = 'manual';
async function requestJSON(path,options={}) {
  const response = await fetch(path,{...options,cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(errorMessage(data.error)),{status:response.status});
  return data;
}
const imageFor = g => g.thumb;
function tagAttributes(tag) {
  const color=String(state.tagPreferences.find(pref=>pref.tag===tag)?.color || '').replace(/^#/,'');
  return /^[a-f0-9]{6}$/i.test(color) ? `data-tag-highlight style="--tag-highlight:#${color}"` : '';
}
const pageCount = g => g.pageCount;

function save() {
  try { localStorage.setItem('yijing-v1', JSON.stringify(state)); }
  catch { if (!storageWarning) { toast('浏览器存储不可用，本次收藏和进度无法持久保存'); storageWarning = true; } }
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function theme() {
  document.documentElement.classList.toggle('dark', state.theme === 'dark' || state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('[data-action=theme]').innerHTML = icon(document.documentElement.classList.contains('dark')?'sun':'moon');
  $('meta[name=theme-color]').content = document.documentElement.classList.contains('dark') ? '#18221d' : '#f5f4ef';
}
theme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
function route() { return list?.view || 'discover'; }
function updateFavorites() {
  for(const target of lists.lists.values())if(favoriteCollection(target)&&target.authScope===exSession.scope){
    target.galleries=[...new Map([...favorites.galleries(target.source),...target.galleries].map(gallery=>[gallery.id,gallery])).values()].filter(gallery=>favorites.has(gallery.id));
    target.remoteFavoriteIds=target.galleries.filter(gallery=>favorites.remote(gallery.id)).map(gallery=>gallery.id);
  }
  paintFavoriteButtons();
  if(activeGallery)updateReaderFavorite();
  if(entry?.screen==='list'){renderResults();remember();}
}
function paintFavoriteButtons(root=document) {
  for(const button of root.querySelectorAll('[data-favorite]')){
    const id=button.dataset.favorite,checking=favoriteChecks.has(id),busy=checking||favorites.busy(id),selected=favorites.has(id);
    const label=busy?checking?'读取收藏…':favorites.removing(id)?'正在取消…':'正在收藏…':favorites.localOnly(id)?'仅本地':selected?'已收藏':'收藏图集';
    button.disabled=busy;button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-busy',String(busy));button.dataset.favoriteLabel=label;
    button.setAttribute('aria-label',busy?label:selected?favorites.localOnly(id)?'仅本地收藏':'已收藏':'收藏图集');
  }
  for(const button of root.querySelectorAll('[data-sync-favorite]')){
    const busy=favorites.busy(button.dataset.syncFavorite);button.disabled=busy;button.setAttribute('aria-busy',String(busy));
    button.innerHTML=busy?'<span class="loading-spinner" aria-hidden="true"></span><span>正在同步…</span>':'同步到账号';
  }
  decorateIcons(root);
}
async function checkGalleryFavorite(gallery) {
  const token=Symbol(),id=gallery.id;favoriteChecks.set(id,token);paintFavoriteButtons();
  try {
    await refreshExSession();
    const scope=exSession.scope;
    if(scope&&!favorites.statusKnown(id)){
      const info=await requestJSON('/api/source?'+new URLSearchParams({action:'favorite-info',source:gallery.source,gid:gallery.gid,token:gallery.token}));
      if(favoriteChecks.get(id)===token)favorites.confirm(gallery,info,scope);
    }
  }catch{ /* Keep the last confirmed state; saving will report any source failure. */ }
  finally{if(favoriteChecks.get(id)===token)favoriteChecks.delete(id);paintFavoriteButtons();}
}
function favoriteResult(result) {
  return result.remoteSaved?result.remove?`取消同步收藏失败，仍保持已收藏：${result.error}`:`账号中已收藏，但更新失败：${result.error}`:result.synced?result.remove?'已取消收藏':'已收藏并同步到账号':result.remove?`已从本地移除；取消同步失败：${result.error}`:`收藏同步失败，已保存在本地：${result.error}`;
}
async function saveFavorite(gallery,change={}) {
  const result=await favorites.set(gallery,change);toast(favoriteResult(result));return result;
}
function favorite(id) {
  const gallery=knownGalleries.get(id)||favorites.meta(id).gallery||activeGallery?.id===id&&activeGallery;
  if(!gallery)return toast('图集信息尚未加载，请稍后重试');
  return saveFavorite(gallery,{remove:favorites.has(id)});
}

function progressFor(gallery) {
  const p = state.progress[gallery.id];
  return p && Number.isInteger(p.page) ? Math.max(0, Math.min(pageCount(gallery) - 1, p.page)) : 0;
}
function nav() {
  const selected=route()==='search' ? list.searchOrigin || 'library' : route();
  const html = Object.entries(names).map(([key, value]) => `<a href="#${key}" class="nav-link ${selected === key ? 'active' : ''}" ${selected === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icons[key]}</span>${value}</a>`).join('');
  $('#desktop-nav').innerHTML = html; $('#mobile-nav').innerHTML = html; $('#breadcrumb').textContent = pageNames[route()];
}
function card(g) {
  const p = state.progress[g.id], percent = p ? Math.round((progressFor(g) + 1) / pageCount(g) * 100) : 0;
  const confirmed=favorites.statusKnown(g.id)&&favorites.remote(g.id)&&favorites.has(g.id);
  const rating=Number(g.rating),rated=Number.isFinite(rating)&&rating>0&&rating<=5;
  return `<article class="card"><button class="card-open" data-open="${escape(g.id)}" aria-label="查看 ${escape(g.title)}${confirmed?'（已收藏）':''}"><div class="cover-wrap"><img src="${escape(imageFor(g))}" alt="${escape(g.title)} 封面" loading="lazy" width="600" height="800"><span class="cover-label">${escape(g.category)}</span><span class="page-badge">${confirmed?`<span class="card-favorite-state" aria-label="已同步收藏">${icon('heart')}</span>`:''}${pageCount(g)} P</span>${rated?`<span class="rating-badge" aria-label="评分 ${rating.toFixed(1)} 星">${icon('star')}<span>${rating.toFixed(1)}</span></span>`:''}</div><div class="card-text"><h3>${escape(g.title)}</h3><div class="card-sub"><span>${escape(g.creator)}</span><span>${escape(g.date)}</span>${rated?`<span class="card-inline-rating" aria-label="评分 ${rating.toFixed(1)} 星">${icon('star')}<span>${rating.toFixed(1)}</span></span>`:''}</div>${favoriteCollection(list)&&favorites.localOnly(g.id)?'<span class="favorite-local-label">仅本地</span>':''}${p ? `<div class="progress-track" aria-label="已读 ${percent}%"><span style="width:${percent}%"></span></div>` : ''}</div></button>${localCollection(list)?historyInfo(g):''}${favoriteCollection(list)&&favorites.localOnly(g.id)?`<button class="favorite-sync" data-sync-favorite="${escape(g.id)}" ${favorites.busy(g.id)?'disabled':''}>${favorites.busy(g.id)?'正在同步…':'同步到账号'}</button>`:''}</article>`;
}
function filtered() {
  if(list.view==='search'&&!searchReady(list))return [];
  if(favoriteCollection(list))list.galleries=[...new Map([...favorites.galleries(list.source),...list.galleries].map(gallery=>[gallery.id,gallery])).values()].filter(gallery=>favorites.has(gallery.id));
  if (localCollection(list)) {
    const ids = collectionView(list) === 'favorites' ? state.favorites : Object.keys(state.progress);
    const known = ids.map(id => knownGalleries.get(id)).filter(g => g?.source === list.source);
    list.galleries = [...new Map([...list.galleries,...known].map(g => [g.id,g])).values()];
  }
  let items = list.galleries.filter(g => g.source === list.source && state.categories.includes(g.category) && accepts(g,list.filters,state.tagPreferences) && (!favoriteCollection(list)||favorites.has(g.id)) && (collectionView(list) !== 'history' || state.progress[g.id]));
  const q = list.query.trim().toLowerCase();
  if(q&&favoriteCollection(list))items=items.filter(gallery=>favoriteMatches(gallery,list.query));
  if (q && localCollection(list)) items = items.filter(g => [g.title,g.creator,...g.tags].join(' ').toLowerCase().includes(q));
  return items.sort((a,b) => collectionView(list) === 'history' ? (state.progress[b.id]?.time || 0) - (state.progress[a.id]?.time || 0) : list.sort === 'source' ? 0 : list.sort === 'title' ? a.title.localeCompare(b.title,'zh-CN') : list.sort === 'pages' ? pageCount(b) - pageCount(a) : b.date.localeCompare(a.date));
}
function historyInfo(g) {
  const time=visitTime(state.progress[g.id]?.time);
  return `<div class="history-meta"><time ${time.datetime?`datetime="${time.datetime}"`:''} title="最近访问：${escape(time.title)}">访问于 ${escape(time.label)}</time><button class="icon-button history-remove" data-remove-history="${escape(g.id)}" aria-label="删除 ${escape(g.title)} 的足迹">${icon('trash')}</button></div>`;
}
function renderSearchHistory() {
  const root=$('#search-history');if(!root)return;
  const records=recentSearches(state.searchHistory,list);
  root.hidden=!records.length||!!list.query.trim();
  root.innerHTML=`<div class="search-history-heading"><h2>最近搜索</h2><button class="text-button" data-action="clear-search-history">清空</button></div><div class="search-history-items">${records.map((item,index)=>`<div class="search-history-item"><button class="search-history-query" data-recent-search="${index}" title="${escape(item.query)}">${icon('clock')}<span>${escape(item.query)}</span></button><button class="icon-button" data-remove-search="${index}" aria-label="删除搜索记录 ${escape(item.query)}">${icon('close')}</button></div>`).join('')}</div>`;
}
function rememberSearch() {
  if(list?.view!=='search'||!list.query.trim())return;
  if(list.source==='exhentai'&&(!exSession.scope||list.authScope!==exSession.scope)||searchScope(list)==='favorites'&&list.authScope&&list.authScope!==exSession.scope)return;
  if(recentSearches(state.searchHistory,list)[0]?.query===list.query.trim())return;
  state.searchHistory=saveSearch(state.searchHistory,list);save();
}
function removeHistory(id) {
  delete state.progress[id];save();renderResults();remember();toast('已删除足迹和阅读进度');
}
const listLoading=()=>'<div class="loading list-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>正在获取实时图集…</span></div>';
const regularDivider=()=>'<div class="regular-divider" role="separator" aria-label="以下为常规图集"><span>以下为常规图集</span></div>';
function rankPlaceholder(title,message) {
  return `<div class="rank-placeholder" role="status"><h2>${escape(title)}</h2><p>${escape(message)}</p></div>`;
}
function discoveryContent(items) {
  if (!state.categories.length) return null;
  if (popularFeed(list)) {
    const ordinary=list.discoveryLatest || list.pendingAppend && list.discoveryContinuation;
    const ids=new Set(list.popularIds||[]),ranked=items.filter(gallery=>ids.has(gallery.id)),regular=items.filter(gallery=>!ids.has(gallery.id));
    if (!ids.size && !ordinary) return null;
    const missing=!ranked.length ? list.discoveryFallback==='unavailable'
      ? rankPlaceholder('热门榜暂时不可用','以下先展示常规图集，可稍后刷新重试热门榜。')
      : rankPlaceholder('当前筛选下暂无热门图集','可调整全局分类或筛选条件，以下继续浏览常规图集。') : '';
    const remainder=ordinary ? regular.length ? regular.map(card).join('') : list.isLoading ? listLoading() : !list.listError ? '<p class="regular-empty">暂无符合条件的常规图集。</p>' : '' : '';
    return ranked.map(card).join('')+missing+(ordinary?regularDivider()+remainder:'');
  }
  if (rankingFeed(list) && !items.length && !list.isLoading && !list.listError) {
    const name=feeds.find(([id])=>id===feedFor(list))?.[1]||'榜单';
    return rankPlaceholder(`${name}暂无符合条件的图集`,list.nextCursor?'本页没有匹配结果，继续上滑查看后续排名，或调整筛选条件。':'当前分类或筛选条件下没有榜单结果，可调整筛选或切换其他榜单。')+'<hr class="rank-empty-divider">';
  }
  return null;
}
function renderResults() {
  if (!$('#gallery-grid')) return;
  $('#listing-title').textContent = route()==='search' ? '搜索结果' : (searchOptions(list.query,list.filters).query || list.filters?.f_shash) && !localCollection(list) ? '搜索结果' : popularFeed(list) ? list.discoveryLatest ? list.popularIds?.length ? '热门与最新' : '最新图集' : '实时热门' : route()==='discover' ? (feeds.find(([id])=>id===feedFor(list))?.[1]||'发现') : pageNames[route()];
  const sourceSort = $('#sort option[value=source]');
  if (sourceSort) sourceSort.textContent = favoriteCollection(list)?'收藏顺序':popularFeed(list) ? list.discoveryLatest ? list.popularIds?.length ? '推荐顺序' : '最新顺序' : '热门顺序' : '默认顺序';
  const items = filtered(); $('#result-count').textContent = list.isLoading ? '加载中…' : `${items.length} 本图集`;
  const refresh=$('[data-action=refresh-list]');
  refresh.disabled=list.isLoading;refresh.setAttribute('aria-busy',String(list.isLoading));
  $('#result-heading h1').hidden = route()==='search' && !searchReady(list);
  $('#favorite-notice').textContent=favoriteCollection(list)?list.favoriteNotice||'':'';
  $('#favorite-notice').hidden=!$('#favorite-notice').textContent;
  $('#gallery-grid').className = `grid ${list.listMode ? 'list-mode' : ''}`;
  const emptyMessages = {favorites:['还没有收藏','进入图集详情，点击底部收藏按钮，把喜欢的作品留在这里。'], history:['还没有阅读足迹','打开一本图集开始阅读，之后可以从上次的位置继续。']};
  const [title, message] = route()==='search' && !searchReady(list) ? ['搜索图集','输入关键词，或在筛选中使用高级搜索与以图搜图。'] : !state.categories.length ? ['尚未选择分类','打开阅读偏好，选择你想浏览的分类。'] : rankingFeed(list) && list.nextCursor ? ['本页暂无符合筛选的图集','可继续加载后面的排名，或调整全局分类和筛选条件。'] : list.query || route()==='search' && searchReady(list) || state.categories.length < categories.length ? ['没有找到匹配图集','试试其他关键词，或调整全局分类。'] : emptyMessages[collectionView(list)] || ['暂无可阅读图集','稍后重试，或搜索你感兴趣的作品。'];
  $('#gallery-grid').innerHTML = discoveryContent(items) ?? (items.length ? items.map(card).join('') : list.isLoading ? listLoading() : list.listError ? '' : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${icons[route()]}</div><h3>${title}</h3><p>${message}</p></div>`);
  const more=!!list.nextCursor || popularFeed(list)&&list.discoveryContinuation;
  $('#list-status').innerHTML=list.listError?`<div class="empty"><p role="alert">${escape(errorMessage(list.listError))}</p><button class="outline-button" data-action="retry-list">重试</button></div>`:more?`<div class="load-sentinel" data-loading="${list.isLoading}" role="status" aria-live="polite">${list.isLoading?'正在加载…':'上滑加载更多'}</div>`:items.length&&!list.isLoading?'<span class="list-end">已经到底了</span>':'';
  listLoader.watch($('#list-status .load-sentinel'),list.key);
  paintFavoriteButtons();
}
function renderQuickTags() {
  const visible = list.galleries.filter(g => g.source === list.source && state.categories.includes(g.category) && accepts(g,list.filters,state.tagPreferences));
  const tags = quickTags(visible,state.tagPreferences);
  $('#tag-filters').innerHTML = ['全部',...tags].map(tag => { const active = tag === '全部' ? !list.query : list.query === tagQuery(tag); return `<button ${tagAttributes(tag)} class="chip ${active ? 'active' : ''} ${state.tagPreferences.some(pref=>pref.tag===tag&&pref.watch)?'watched-tag':''}" ${tag === '全部' ? 'data-action="clear-search"' : `data-search-tag="${escape(tag)}"`} aria-pressed="${active}">${escape(tag)}</button>`; }).join('');
}
function render() {
  nav();const view=route(),searchPage=view==='search';
  document.body.classList.toggle('searching',searchPage);
  const placeholder=favoriteCollection(list)?'搜索收藏':localCollection(list)?'搜索阅读足迹':'搜索图集或粘贴图集链接';
  const heading=searchPage?`<header class="search-page-header"><button class="icon-button" data-action="search-back" aria-label="返回上一页">${icon('back')}</button><form id="search-page-form"><label class="search"><span aria-hidden="true">${icon('search')}</span><input id="search" type="search" enterkeyhint="search" placeholder="${placeholder}" value="${escape(list.query)}" aria-label="搜索图集" autocomplete="off"></label><button class="primary-button search-submit" type="submit">搜索</button></form></header>`:'';
  const options=`<div class="list-tool-row"><span>全局分类</span><button class="category-button" data-action="settings" aria-label="设置全局分类">${state.categories.length===categories.length?'全部分类':`已选 ${state.categories.length} 类`} ${icon('next')}</button></div><label class="list-tool-row">排序<select id="sort" aria-label="图集排序">${view==='discover'||searchPage||feedFor(list)==='favorites'?'<option value="source">默认顺序</option>':''}<option value="newest">最近更新</option><option value="title">名称排序</option><option value="pages">页数最多</option></select></label><div class="list-tool-row"><span>显示方式</span><div class="list-tool-buttons"><button data-action="view" class="icon-button" aria-label="切换列表布局" aria-pressed="${list.listMode}">${icon(list.listMode?'grid':'list')}</button></div></div>`;
  $('#main').innerHTML=`${heading}${searchPage?'<section id="search-history" class="search-history" aria-label="最近搜索" hidden></section>':''}${features.controls(list)}<section aria-label="图集列表"><div class="section-heading" id="result-heading"><h1><span id="listing-title">${searchPage?'搜索结果':pageNames[view]}</span><small id="result-count"></small></h1><div class="list-heading-actions">${localCollection(list)?'<button class="text-button history-clear" data-action="clear-history">清空足迹</button>':''}<button class="icon-button" data-action="refresh-list" aria-label="刷新当前列表">${icon('refresh')}</button>${features.tools(list,options,state.categories.length!==categories.length)}</div></div><p id="favorite-notice" class="feature-note" role="status" hidden></p><div id="gallery-grid" class="grid"></div><div id="list-status" class="list-status"></div></section>`;
  $('#sort').value=list.sort;renderQuickTags();renderResults();renderSearchHistory();decorateIcons();
}
async function loadFavorites(target,{append,request,search,options,selected,cursor}) {
  const source=target.source,current=()=>request===target.requestId;
  target.favoriteNotice='';
  const ids=state.favorites.filter(id=>galleryReference(id).source===source);
  const missing=[];
  for(const id of ids){const known=knownGalleries.get(id);if(known)favorites.remember(known);if(!favorites.meta(id).gallery){const ref=galleryReference(id);missing.push([Number(ref.gid),ref.token]);}}
  const [local,auth]=await Promise.allSettled([metadata(missing,source),refreshExSession()]);
  if(!current())throw new DOMException('Navigation changed','AbortError');
  if(local.status==='fulfilled')for(const gallery of local.value){knownGalleries.set(gallery.id,gallery);favorites.remember(gallery);}
  target.authScope=exSession.scope;
  if(!exSession.configured||auth.status==='rejected'){
    target.favoriteNotice=auth.status==='rejected'?'暂时无法同步，当前展示本地收藏。':'未登录，当前展示本地收藏。';
    return {galleries:favorites.galleries(source),next:null};
  }
  const scope=exSession.scope;
  try {
    const data=await requestJSON('/api/galleries?'+new URLSearchParams({feed:'favorites',q:search,next:cursor||'',source,...options.params,f_cats:String(excludedCategories(selected))}));
    if(!current()||scope!==exSession.scope)throw new DOMException('Account changed','AbortError');
    const remote=await metadata(data.ids,source);
    if(!current()||scope!==exSession.scope)throw new DOMException('Account changed','AbortError');
    if(!append&&!search&&!Object.keys(target.filters||{}).length)favorites.resetRemote(source);
    favorites.ingest(remote,scope);
    target.remoteFavoriteIds=[...new Set([...(append?target.remoteFavoriteIds||[]:[]),...remote.map(gallery=>gallery.id)])];
    return {galleries:favorites.galleries(source),next:data.next};
  }catch(error){target.favoriteNotice='暂时无法读取收藏，已保留当前记录。';throw error;}
}
async function loadGalleries(append=false,target=list) {
  if (renderTimer && debounceTarget === target) { clearTimeout(renderTimer); renderTimer = null; debounceTarget = null; }
  const request = target.requestId = (target.requestId || 0) + 1;
  const view = target.view, rawSearch = target.query, source = target.source, cursor = append ? target.nextCursor : null;
  const options = searchOptions(rawSearch,target.filters),search = options.query,feed = feedFor(target);
  const selected = [...state.categories], discovery = popularFeed(target);
  target.isLoading = true; target.listError = ''; target.initialized = true;
  target.pendingAppend = append; target.categoryKey = selected.join('|'); target.authScope = source === 'exhentai' || accountList(target) ? exSession.scope : null;
  if (!append) { target.galleries = []; target.nextCursor = null; target.scrollY = 0;target.discoveryContinuation = false;target.discoveryLatest = false;target.popularIds = [];target.discoveryFallback = null; }
  const emptySearch=view==='search'&&!searchReady(target);
  if (!selected.length || emptySearch) { target.isLoading = false; target.nextCursor = null; }
  if (target === list) { renderQuickTags(); renderResults(); if (!append && entry.screen === 'list') restoreScroll(); }
  lists.save();
  if (!selected.length || emptySearch) return;
  target.pendingRequest = (async () => {
    try {
      let data;
      if(favoriteCollection(target)){
        data=await loadFavorites(target,{append,request,search,options,selected,cursor});
      } else if (localCollection(target)) {
        const ids = (collectionView(target) === 'favorites' ? state.favorites : Object.keys(state.progress)).filter(id => id.includes('/') && galleryReference(id).source === source);
        data = {galleries:await metadata(ids.map(id => { const {gid,token} = galleryReference(id); return [Number(gid),token]; }),source),next:null};
      } else {
        const match = search.trim().match(/^https:\/\/(e-hentai|exhentai)\.org\/g\/(\d+)\/([a-f0-9]+)\/?$/);
        if (match) data = {galleries:[await getGallery(match[2],match[3],match[1] === 'exhentai' ? 'exhentai' : 'e-hentai')],next:null};
        else {
          const load = async (feed,next) => {
            if (request !== target.requestId) throw new DOMException('Navigation changed','AbortError');
            const listing = await requestJSON(`/api/galleries?${new URLSearchParams({q:search,next:next || '',...(feed !== 'latest' ? {feed} : {}),...options.params,f_cats:String(excludedCategories(selected)),...(source === 'exhentai' ? {source} : {})})}`);
            if (request !== target.requestId) throw new DOMException('Navigation changed','AbortError');
            const details = new Map((await metadata(listing.ids,source)).map(gallery => [gallery.gid,gallery]));
            return {galleries:listing.ids.map(([gid]) => details.get(gid)).filter(gallery=>gallery && accepts(gallery,target.filters,state.tagPreferences)),next:listing.next};
          };
          data = discovery ? await discoveryPage({load,append,cursor,categories:selected,seen:target.galleries.map(gallery => gallery.id),onFallback:fallback=>{
            if(request!==target.requestId)return;
            target.discoveryFallback=fallback;target.discoveryLatest=true;target.popularIds=[];
            if(target===list)renderResults();lists.save();
          }}) : await load(options.params.f_shash || search.trim() && !['watched','favorites'].includes(feed) ? 'latest' : feed,cursor);
        }
      }
      if (request !== target.requestId) return;
      data.galleries.forEach(g => {knownGalleries.set(g.id,g);favorites.remember(g);});
      target.galleries = append ? [...new Map([...target.galleries,...data.galleries].map(g => [g.id,g])).values()] : data.galleries;
      target.nextCursor = append && data.next===cursor ? null : data.next;
      if (discovery) {
        target.discoveryContinuation = data.continuation;target.discoveryLatest = data.latest;
        if (data.popularIds) target.popularIds = data.popularIds;
        if ('fallback' in data) target.discoveryFallback = data.fallback;
      }
    } catch (error) { if (!leavingPage && request === target.requestId) target.listError = error.message; }
    finally {
      if (!leavingPage && request === target.requestId) {
        target.isLoading = false; target.pendingRequest = null;
        if (target === list) { renderQuickTags(); renderResults(); }
        lists.save();
      }
    }
  })();
  return target.pendingRequest;
}
function thumbnailStore(gallery) {
  if (!thumbnailStores.has(gallery.id)) thumbnailStores.set(gallery.id,new ThumbnailStore(async page=>{
    const params = new URLSearchParams({gid:gallery.gid,token:gallery.token,p:String(page),...(gallery.source === 'exhentai' ? {source:gallery.source} : {})});
    const data = await requestJSON(`/api/pages?${params}`);
    data.pages = data.pages.map(thumb=>({...thumb,src:thumbnailSource(thumb.src,gallery.source)}));
    return data;
  }));
  return thumbnailStores.get(gallery.id);
}
const photoViewer = new PhotoViewer($('#photo-viewer'),{
  back,
  dismiss:()=>{
    if(entry.photoOrigin==='reader')return back();
    remember();
    if (entry.albumSteps > 0) history.go(-entry.albumSteps);
    else {
      const album = makeEntry('detail',list,entry.galleryId,false);
      history.replaceState(album,'',entryHash(album));applyNavigation();
    }
  },
  fullscreen:()=>{
    if (entry.screen === 'photo-full') back();
    else navigate('photo-full',list,entry.galleryId,{photoIndex:photoViewer.index});
  },
  continuous:()=>{
    state.mode = 'scroll';save();navigate('reader',list,entry.galleryId,{replace:true});
  },
  retry:()=>openPhotos(entry.galleryId,entry.photoIndex || 0,entry.screen === 'photo-full'),
  change:(gallery,index)=>{
    if (!['photo','photo-full'].includes(entry?.screen)) return;
    state.progress[gallery.id] = {page:index,time:Date.now()};save();
    entry.photoIndex = index;history.replaceState(entry,'',entryHash(entry));
  }
});
async function openPhotos(id,index=0,immersive=false) {
  const request = ++photoRequest;
  $('#detail-dialog').close();$('#settings-dialog').close();
  document.body.classList.add('reading');$('.shell').inert = true;$('.sidebar').inert = true;$('.bottom-nav').inert = true;
  try {
    let gallery = knownGalleries.get(id);
    if (!gallery) { photoViewer.loading();const reference=galleryReference(id);gallery = await getGallery(reference.gid,reference.token,reference.source);knownGalleries.set(id,gallery); }
    if (request !== photoRequest || !['photo','photo-full'].includes(entry.screen) || entry.galleryId !== id) return;
    if (gallery.source === 'exhentai') await sendImageContext();
    if (request !== photoRequest) return;
    photoViewer.returnHint=entry.photoOrigin==='reader'?'轻点或下滑返回连续阅读 · 双击缩放':'轻点退出全屏 · 双击缩放 · 下滑返回图集';
    photoViewer.show(galleryWithPages(gallery),index,thumbnailStore(gallery),immersive);
    $('#photo-viewer .photo-dismiss-hint').textContent=photoViewer.returnHint;
  } catch (error) { if(request===photoRequest)photoViewer.error(error.message); }
}
function hidePhotos() {
  ++photoRequest;photoViewer.hide();document.body.classList.remove('reading');$('.shell').inert = false;$('.sidebar').inert = false;$('.bottom-nav').inert = false;
}
async function renderDetail(id) {
  const request = ++detailRequest;
  let g = knownGalleries.get(id);
  if (!g) {
    $('#detail-body').innerHTML = '<div class="dialog-header"><h2>图集详情</h2><button class="icon-button" data-action="close-detail" aria-label="关闭详情">✕</button></div><div class="loading">正在获取图集…</div>';
    decorateIcons($('#detail-body'));
    if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
    try { const {gid,token,source} = galleryReference(id); g = await getGallery(gid,token,source); knownGalleries.set(g.id,g); }
    catch (error) {
      if (request === detailRequest && entry.screen === 'detail') $('#detail-body').innerHTML = `<div class="dialog-header"><h2>图集详情</h2><button class="icon-button" data-action="close-detail" aria-label="关闭详情">✕</button></div><div class="empty"><p>${escape(error.message)}</p><button class="outline-button" data-action="retry-detail">重新加载</button><button class="outline-button" data-action="settings">设置凭证</button></div>`;
      decorateIcons($('#detail-body'));return;
    }
  }
  if (g.source === 'exhentai') await sendImageContext();
  if (request !== detailRequest || entry.screen !== 'detail' || entry.galleryId !== id) return;
  const progress = state.progress[g.id];
  if (progress) { progress.time = Date.now(); save(); }
  detailThumbnails?.close();
  $('#detail-body').innerHTML = `<div class="dialog-header"><button class="photo-album-back" data-action="close-detail" aria-label="返回图集列表">‹ 图集</button><span>${pageCount(g)} 张照片</span></div><div class="gallery-summary"><div class="gallery-summary-copy"><span class="eyebrow">${escape(g.category)}</span><h2>${escape(g.title)}</h2><div class="gallery-facts"><span>${escape(g.creator)}</span><span>${escape(g.date)}</span></div>${g.description && g.description !== g.title ? `<p>${escape(g.description)}</p>` : ''}</div></div><details class="gallery-tags photo-tag-panel" ${entry.tagsOpen ? 'open' : ''}><summary>标签 · ${g.tags.length}<span>按标签查找相关图集</span></summary><div class="card-tags">${g.tags.map(tag => `<button class="chip" data-search-tag="${escape(tag)}">${escape(tag)}</button>`).join('')}</div></details><div class="photo-album-grid">${Array.from({length:pageCount(g)},(_,index)=>`<button class="photo-tile" data-open-photo="${index}" aria-label="放大第 ${index+1} 张照片"><span class="photo-thumb" data-thumb="${index}"><span class="thumb-page">${index+1}</span></span></button>`).join('')}</div><div class="gallery-actions"><button class="primary-button" data-read="${escape(g.id)}">${state.progress[g.id] ? `继续阅读 · 第 ${progressFor(g)+1} 页` : '连续阅读'} <span>→</span></button><button class="outline-button" data-favorite="${escape(g.id)}" aria-pressed="${favorites.has(g.id)}" ${favorites.busy(g.id)?'disabled':''}>${favorites.has(g.id) ? '♥ 已收藏' : '♡ 收藏图集'}</button></div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  detailThumbnails = new ThumbnailView($('#detail-body').querySelector('.photo-album-grid'),$('#detail-dialog'),thumbnailStore(g));
  features.mountGallery(g,$('#detail-body'));paintFavoriteButtons($('#detail-body'));checkGalleryFavorite(g);
  $('#detail-dialog').scrollTop = entry.detailScroll || 0;
  if (Number.isInteger(entry.focusPhoto)) {
    const tile = $('#detail-body').querySelector(`[data-open-photo="${entry.focusPhoto}"]`);
    if (tile) {
      const box = tile.getBoundingClientRect(), top = $('#detail-dialog').querySelector('.dialog-header').getBoundingClientRect().bottom;
      const bottom = $('#detail-dialog').querySelector('.gallery-actions').getBoundingClientRect().top;
      if (box.top < top || box.bottom > bottom) tile.scrollIntoView({block:'center',behavior:'instant'});
      tile.focus({preventScroll:true});
    }
  }
}
function record() { if (!activeGallery) return; state.progress[activeGallery.id] = {page:currentPage, time:Date.now()}; save(); updateCounter(); }
function updateCounter() {
  $('#page-slider').value = String(currentPage + 1); $('#page-counter').textContent = `${currentPage + 1} / ${activeGallery.pages.length}`;
  $('[data-action=prev]').disabled = currentPage === 0; $('[data-action=next]').disabled = currentPage === activeGallery.pages.length - 1;
}
function updateReaderFavorite() { const button=$('#reader-favorite');button.dataset.favorite=activeGallery.id;paintFavoriteButtons($('#reader')); }
function readerImage(page,index) {
  const dimensions = readerPreloader?.loaded.get(index) || page;
  return `<div class="reader-page" data-index="${index}" style="aspect-ratio:${dimensions.width || 600}/${dimensions.height || 800}"><span class="reader-placeholder" aria-hidden="true">第 ${index+1} 页</span><img data-src="${escape(page.src)}" alt="${escape(page.alt || `${activeGallery.title} · 第 ${index+1} 页`)}" data-page="${index}" decoding="async" draggable="false" width="${dimensions.width || 600}" height="${dimensions.height || 800}"></div>`;
}
function imageDimensions(index,dimensions) {
  if (!activeGallery || !dimensions.width || !dimensions.height) return;
  const content = $('#reader-content');
  const anchor = content.querySelector(`[data-index="${currentPage}"]`);
  const offset = anchor ? anchor.offsetTop-content.scrollTop : 0;
  const box = content.querySelector(`[data-index="${index}"]`);
  if (box) box.style.aspectRatio = `${dimensions.width}/${dimensions.height}`;
  Object.assign(activeGallery.pages[index],dimensions);
  if (readerMode === 'scroll' && anchor && index < currentPage) content.scrollTop = anchor.offsetTop-offset;
}
function activateImage(index,visible=false) {
  const img = $('#reader-content').querySelector(`img[data-page="${index}"]`);
  if (img && !img.hasAttribute('src')) { img.fetchPriority = visible || index === currentPage ? 'high' : 'low'; img.src = img.dataset.src; }
}
function activateVisibleImages() {
  if (!activeGallery || readerMode !== 'scroll') return;
  const content = $('#reader-content'), boxes = content.querySelectorAll('.reader-page');
  for (let index=currentPage;index<boxes.length && boxes[index].offsetTop<content.scrollTop+content.clientHeight;index++) activateImage(index,true);
}
function updatePreloadWindow() {
  if (!activeGallery || !readerPreloader) return;
  activateImage(currentPage);
  for (const index of preloadNeighbors(currentPage,activeGallery.pages.length)) if (readerPreloader.loaded.has(index)) activateImage(index);
  readerPreloader.update(currentPage);
}
function makePreloader(gallery) {
  return new ReaderPreloader(gallery.pages.length,(index,signal)=>new Promise((resolve,reject)=>{
    const image = new Image();image.decoding = 'async';image.fetchPriority = 'low';
    const cleanup = () => { image.onload = null;image.onerror = null;signal.removeEventListener('abort',abort); };
    const abort = () => { cleanup();image.removeAttribute('src');reject(new DOMException('Reader closed','AbortError')); };
    image.onload = () => { const dimensions={width:image.naturalWidth,height:image.naturalHeight};cleanup();resolve(dimensions); };
    image.onerror = () => { cleanup();reject(new Error('Image preload failed')); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort',abort,{once:true});image.src = gallery.pages[index].src;
  }),(index,dimensions)=>{
    if (activeGallery !== gallery) return;
    imageDimensions(index,dimensions);
    if (Math.abs(index-currentPage) <= 5) activateImage(index);
  });
}
function renderReader() {
  cancelAnimationFrame(readerScrollFrame);const version = ++readerRenderVersion;
  const content = $('#reader-content');content.className = `reader-content ${readerMode}`;
  content.innerHTML = readerMode === 'paged' ? readerImage(activeGallery.pages[currentPage],currentPage) : activeGallery.pages.map(readerImage).join('');
  content.querySelectorAll('img').forEach(img => {
    const index = Number(img.dataset.page);
    img.addEventListener('load',()=>{
      if (version !== readerRenderVersion || !activeGallery) return;
      const dimensions={width:img.naturalWidth,height:img.naturalHeight};
      readerPreloader?.markLoaded(index,dimensions);imageDimensions(index,dimensions);img.parentElement.dataset.loaded = 'true';
      activateVisibleImages();
    });
    img.addEventListener('error',()=>{
      if (version !== readerRenderVersion || !activeGallery) return;
      const box = document.createElement('div');box.className = 'image-error';box.innerHTML = '<span>图片暂时无法加载，请检查网络连接。</span><button class="outline-button">重新加载</button>';
      box.querySelector('button').onclick = () => {
        box.remove();const retry = new URL(img.dataset.src,location.origin);retry.searchParams.set('retry',String(Date.now()));img.src = retry.href;
      };img.after(box);
    });
  });
  const selected = content.querySelector(`[data-index="${currentPage}"]`);
  content.scrollTop = readerMode === 'scroll' && selected ? selected.offsetTop : 0;
  updatePreloadWindow();activateVisibleImages();
  $('[data-action=reader-mode]').textContent = readerMode === 'paged' ? '连续' : '照片';
  $('[data-action=reader-mode]').setAttribute('aria-label',readerMode === 'paged' ? '切换纵向滚动' : '切换横向照片浏览');
  record();
}
$('#reader-content').addEventListener('scroll',()=>{
  if (!activeGallery || readerMode !== 'scroll') return;
  cancelAnimationFrame(readerScrollFrame);
  readerScrollFrame = requestAnimationFrame(()=>{
    if (!activeGallery || readerMode !== 'scroll') return;
    const content = $('#reader-content'), boxes = content.querySelectorAll('.reader-page');
    let low = 0, high = boxes.length-1;
    while (low < high) { const mid = Math.ceil((low+high)/2);if (boxes[mid].offsetTop <= content.scrollTop+1) low = mid;else high = mid-1; }
    if (content.scrollTop+content.clientHeight >= content.scrollHeight-2) low = boxes.length-1;
    if (currentPage !== low) { currentPage = low;record();updatePreloadWindow(); }
    activateVisibleImages();
  });
},{passive:true});
let readerWidth = 0;
new ResizeObserver(entries=>{
  const width = entries[0].contentRect.width;
  if (!width || width === readerWidth) return;
  const previousWidth = readerWidth;
  readerWidth = width;
  if (previousWidth && activeGallery && readerMode === 'scroll') goPage(currentPage);
}).observe($('#reader-content'));
async function openReader(id) {
  const request = ++readerRequest;
  $('#detail-dialog').close(); $('#settings-dialog').close();
  $('#reader').hidden = false; document.body.classList.add('reading'); $('.shell').inert = true; $('.sidebar').inert = true; $('.bottom-nav').inert = true;
  $('#reader-title').textContent = '正在获取图集…'; $('#reader-source').textContent = '';
  $('#reader-content').innerHTML = '<div class="loading">正在获取图集…</div>';
  $('#page-counter').textContent = ''; $('#page-slider').disabled = true;
  for (const action of ['prev','next','reader-mode','reader-favorite']) $(`[data-action=${action}]`).disabled = true;
  $('[data-action=exit-reader]').focus({preventScroll:true});
  try {
    const {gid,token,source} = galleryReference(id);
    const known = knownGalleries.get(id);
    const g = known ? galleryWithPages(known) : await getGallery(gid,token,source);
    if (request !== readerRequest || entry.screen !== 'reader' || entry.galleryId !== id) return;
    knownGalleries.set(g.id,g);
    activeGallery = g; currentPage = entry.readerRestore&&Number.isInteger(entry.readerRestore.page)?Math.max(0,Math.min(g.pages.length-1,entry.readerRestore.page)):progressFor(g); readerMode = state.mode; readerPreloader?.close(); readerPreloader = makePreloader(g);
    $('#reader-title').textContent = g.title; $('#reader-source').textContent = g.category;
    $('#page-slider').disabled = false;
    for (const action of ['reader-mode','reader-favorite']) $(`[data-action=${action}]`).disabled = false;
    $('#page-slider').max = String(g.pages.length); updateReaderFavorite(); renderReader();
    if(entry.readerRestore){$('#reader-content').scrollTop+=Number(entry.readerRestore.offset)||0;delete entry.readerRestore;remember();}
  } catch (error) {
    if (request !== readerRequest || entry.screen !== 'reader' || entry.galleryId !== id) return;
    $('#reader-content').innerHTML = `<div class="image-error"><h3>图集暂时无法加载</h3><p role="alert">${escape(error.message)}</p><button class="outline-button" data-action="retry-reader">重新加载</button><button class="outline-button" data-action="settings">设置凭证</button></div>`;
  }
}
function hideReader() {
  ++readerRequest; ++readerRenderVersion; cancelAnimationFrame(readerScrollFrame); record(); readerPreloader?.close(); readerPreloader = null; activeGallery = null;
  $('#reader').hidden = true; document.body.classList.remove('reading'); $('.shell').inert = false; $('.sidebar').inert = false; $('.bottom-nav').inert = false;
  $('#reader-content').replaceChildren();
}
function goPage(page) {
  if (!activeGallery) return; currentPage = Math.max(0,Math.min(activeGallery.pages.length - 1,page));
  if (readerMode === 'scroll') { const box = $('#reader-content').querySelector(`[data-index="${currentPage}"]`); updatePreloadWindow(); if (box) $('#reader-content').scrollTo({top:box.offsetTop,behavior:'instant'}); record(); }
  else renderReader();
}
function remember() {
  if (!list || !entry) return;
  if (!restoringScroll && !document.body.classList.contains('reading')) list.scrollY = window.scrollY;
  if (entry.screen==='reader'&&activeGallery) {const content=$('#reader-content'),anchor=content.querySelector(`[data-index="${currentPage}"]`);entry.readerPage=currentPage;entry.readerOffset=anchor?content.scrollTop-anchor.offsetTop:0;}
  if ($('#detail-dialog').open) { entry.detailScroll = $('#detail-dialog').scrollTop;entry.tagsOpen = !!$('#detail-dialog').querySelector('.photo-tag-panel')?.open; }
  history.replaceState({...entry,fallback:{view:list.view,query:list.query,sort:list.sort,listMode:list.listMode,source:list.source,feed:list.feed,filters:list.filters,searchOrigin:list.searchOrigin,searchScope:list.searchScope,searchFeed:list.searchFeed}},'');
  lists.save();
}
function restoreScroll() {
  const target = list, y = target.scrollY;
  restoringScroll = true;
  requestAnimationFrame(() => {
    if (target === list && entry.screen !== 'reader') window.scrollTo({top:y,behavior:'instant'});
    requestAnimationFrame(() => { restoringScroll = false;listLoader.check(); });
  });
}
function makeEntry(screen,target,galleryId=null,parent=false,photoIndex=0) {
  return {yijingNav:1,key:crypto.randomUUID(),listKey:target.key,view:target.view,source:target.source,screen,galleryId,parent,photoIndex,fallback:{view:target.view,query:target.query,sort:target.sort,listMode:target.listMode,source:target.source,feed:target.feed,filters:target.filters,searchOrigin:target.searchOrigin,searchScope:target.searchScope,searchFeed:target.searchFeed}};
}
function entryHash(value) {
  if (['photo','photo-full'].includes(value.screen)) return `#${value.screen}/${value.galleryId}/${(value.photoIndex || 0)+1}`;
  return value.screen === 'reader' ? `#read/${value.galleryId}` : value.screen === 'detail' ? `#gallery/${value.galleryId}` : `#${value.view}`;
}
function adoptLocation() {
  const hash = location.hash || '#discover';
  if (history.state?.yijingNav === 1 && entryHash(history.state) === hash) return history.state;
  const [screen,...parts] = hash.slice(1).split('/');
  const browseScreen=!!names[screen]||screen==='search';
  const view = browseScreen ? screen : 'discover';
  const target = browseScreen ? lists.tab(view,state.source) || lists.create(view,'',state.source) : list || lists.tab(view,state.source) || lists.create(view,'',state.source);
  const photoScreen = ['photo','photo-full'].includes(screen);
  const photoIndex = photoScreen ? Math.max(0,Number(parts.pop())-1 || 0) : 0;
  const value = makeEntry(photoScreen ? screen : screen === 'read' ? 'reader' : screen === 'gallery' ? 'detail' : 'list',target,parts.join('/') || null,false,photoIndex);
  history.replaceState(value,'',entryHash(value));
  return value;
}
function applyNavigation() {
  rememberSearch();flushSearch();
  const next = adoptLocation();
  if (next.key === appliedEntry) return;
  const legacy=lists.lists.get(next.listKey);
  if(next.screen==='list' && legacy && legacy.view!=='search' && searchReady(legacy)){
    const origin=legacy.view,feed=feedFor(legacy),root=lists.create(origin,'',legacy.source);
    Object.assign(root,{feed:legacy.feed,filters:legacy.filters?.favcat===undefined?{}:{favcat:legacy.filters.favcat}});
    Object.assign(legacy,{view:'search',searchOrigin:origin,searchScope:origin,searchFeed:['watched','favorites'].includes(feed)?feed:'latest'});
    lists.activate(root);lists.activate(legacy);lists.save();
    const parent=makeEntry('list',root);history.replaceState(parent,'',entryHash(parent));
    const search=makeEntry('list',legacy,null,true);history.pushState(search,'',entryHash(search));
    return applyNavigation();
  }
  const previous = list, previousEntry = entry;
  if(next.screen==='reader'&&previousEntry?.photoOrigin==='reader'&&previousEntry.galleryId===next.galleryId){const index=photoViewer.gallery?.id===next.galleryId?photoViewer.index:previousEntry.photoIndex,same=index===next.readerZoomIndex;next.readerRestore={page:same?next.readerPage:index,offset:same?next.readerOffset:0};}
  if (next.screen === 'detail' && previousEntry?.galleryId === next.galleryId && ['reader','photo','photo-full'].includes(previousEntry.screen)) next.focusPhoto = previousEntry.screen === 'reader' ? currentPage : photoViewer.index;
  if (next.screen === 'photo' && previousEntry?.galleryId === next.galleryId) {
    if (previousEntry.screen === 'photo-full') next.photoIndex = photoViewer.index;
    if (previousEntry.screen === 'reader') next.photoIndex = currentPage;
    history.replaceState(next,'',entryHash(next));
  }
  entry = next; appliedEntry = next.key;
  list = lists.lists.get(next.listKey);
  if (!list) {
    list = lists.create(next.fallback?.view || next.view,next.fallback?.query || '',next.source || next.fallback?.source || 'e-hentai');
    Object.assign(list,{sort:next.fallback?.sort || list.sort,listMode:!!next.fallback?.listMode,feed:next.fallback?.feed || list.feed,filters:next.fallback?.filters || {},searchOrigin:next.fallback?.searchOrigin,searchScope:next.fallback?.searchScope,searchFeed:next.fallback?.searchFeed});
    entry.listKey = list.key; history.replaceState(entry,'');
  }
  if (list.source === 'exhentai' && !exSession.configured) {
    list.galleries = []; list.initialized = false;
  } else { state.source = list.source; save(); }
  lists.activate(list);
  features.cancel();
  sendImageContext();
  if(favoriteCollection(list)&&list.authScope===exSession.scope&&exSession.scope)favorites.ingest(list.galleries.filter(gallery=>list.remoteFavoriteIds?.includes(gallery.id)),exSession.scope,{cached:true});
  list.galleries.forEach(g => {knownGalleries.set(g.id,g);favorites.remember(g);});
  ++detailRequest;detailThumbnails?.close();detailThumbnails = null;
  if (!['photo','photo-full'].includes(entry.screen) && !$('#photo-viewer').hidden) hidePhotos();
  if (!$('#reader').hidden) hideReader();
  $('#detail-dialog').close(); $('#settings-dialog').close();
  const changed = previous !== list;
  if (changed || !$('#gallery-grid')) render();
  else if (entry.screen === 'list') renderResults();
  if (entry.screen === 'reader') openReader(entry.galleryId);
  else if (['photo','photo-full'].includes(entry.screen)) openPhotos(entry.galleryId,entry.photoIndex || 0,entry.screen === 'photo-full');
  else {
    restoreScroll();
    if (entry.screen === 'detail') renderDetail(entry.galleryId);
    if (entry.screen === 'list' && (!list.initialized || list.categoryKey !== state.categories.join('|') || (list.source === 'exhentai' || accountList(list)) && list.authScope !== exSession.scope)) loadGalleries(false,list);
    else if (list.initialized && list.isLoading && !list.pendingRequest) loadGalleries(list.pendingAppend,list);
  }
  lists.save();
}
function navigate(screen,target=list,galleryId=null,{replace=false,photoIndex=0,photoOrigin=null}={}) {
  rememberSearch();remember();
  const value = makeEntry(screen,target,galleryId,replace ? !!entry?.parent : true,photoIndex);
  if(photoOrigin)value.photoOrigin=photoOrigin;
  if (galleryId && galleryId === entry?.galleryId && ['reader','photo','photo-full'].includes(screen)) {
    const steps = entry.screen === 'detail' ? 0 : entry.albumSteps;
    if (Number.isInteger(steps)) value.albumSteps = steps + (replace ? 0 : 1);
  }
  history[replace ? 'replaceState' : 'pushState'](value,'',entryHash(value));
  applyNavigation();
}
function navigateTab(view) {
  if (entry.screen === 'list' && list.view === view) return;
  navigate('list',lists.tab(view,state.source) || lists.create(view,'',state.source));
}
function back() {
  rememberSearch();remember();
  if (entry.parent) history.back();
  else if(list.view==='search'){const view=list.searchOrigin||'library';navigate('list',lists.tab(view,list.source)||lists.create(view,'',list.source),null,{replace:true});}
  else navigate('list',list,null,{replace:true});
}
function searchTag(tag) { openSearch(tagQuery(tag),{},true); }
function flushSearch() {
  if (!renderTimer) return;
  clearTimeout(renderTimer); renderTimer = null;
  const target = debounceTarget; debounceTarget = null;
  if (target) loadGalleries(false,target);
}
$('#detail-dialog').addEventListener('cancel',event => { event.preventDefault(); back(); });
window.addEventListener('popstate',applyNavigation);
window.addEventListener('hashchange',applyNavigation);
window.addEventListener('scroll',() => {
  if (restoringScroll || entry?.screen !== 'list') return;
  list.scrollY = window.scrollY;
  clearTimeout(scrollTimer); scrollTimer = setTimeout(remember,150);
},{passive:true});
function sendImageContext() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve();
  const source = entry?.galleryId && entry.screen !== 'list' ? galleryReference(entry.galleryId).source : list?.source || state.source;
  return new Promise(resolve=>{
    const channel = new MessageChannel();
    const finish = () => { clearTimeout(timer);channel.port1.close();resolve(); };
    const timer = setTimeout(finish,1000);
    channel.port1.onmessage = finish;
    worker.postMessage({type:'image-context',source,scope:exSession.scope},[channel.port2]);
  });
}
async function refreshExSession({fillForm=false}={}) {
  const form = $('#ex-credentials-form');
  const initial = fillForm ? Object.fromEntries(new FormData(form)) : null;
  const request = ++authRequest, {credentials,...checked} = await requestExSession(undefined,fillForm);
  if (request === authRequest) {
    exSession = checked; setExScope(exSession.scope); sendImageContext();
    if (fillForm && $('#settings-dialog').open) for (const input of form.querySelectorAll('input[name]')) {
      if (input.value === initial[input.name]) input.value = credentials?.[input.name] || '';
    }
  }
  return exSession;
}
function requestExSession(options,fillForm=false) {
  // Complete any cookie renewal before a save or deletion can change the session.
  const request = authQueue.then(() => requestJSON('/api/ex-session'+(fillForm ? '?credentials=1' : ''),options));
  authQueue = request.catch(() => {});
  return request;
}
function updateSourceSettings() {
  const option = $('#source-setting option[value="exhentai"]');
  option.disabled = !exSession.configured;
  option.textContent = exSession.configured ? 'ExHentai' : 'ExHentai（需要凭证）';
  $('#source-setting').value = state.source;
  $('#verify-ex').textContent = exSession.configured ? '更新凭证' : '验证并保存到本机';
  $('#ex-session-status').textContent = exSession.configured ? '凭证已保存在本机，关闭浏览器后仍可使用。可以切换到 ExHentai。' : '尚未保存凭证，请输入后验证。';
}
function purgeExLists() {
  state.searchHistory=state.searchHistory.filter(item=>item.source!=='exhentai'&&item.scope!=='favorites');save();
  features.clearPrivate();
  for (const target of lists.lists.values()) if (target.source === 'exhentai' || accountList(target)) target.requestId = (target.requestId || 0) + 1;
  lists.removeSource('exhentai');
  for (const [key,target] of lists.lists) if(accountList(target)){
    if(favoriteCollection(target))Object.assign(target,{initialized:false,isLoading:false,authScope:null,remoteFavoriteIds:[],nextCursor:null,listError:'',galleries:target.galleries.filter(gallery=>state.favorites.includes(gallery.id))});
    else lists.lists.delete(key);
  }
  for (const key of Object.keys(lists.tabs)) if (!lists.lists.has(lists.tabs[key])) delete lists.tabs[key];
  for (const [key,g] of knownGalleries) if (g.source === 'exhentai') { knownGalleries.delete(key);thumbnailStores.delete(key); }
}
function switchSource(source) {
  if (source === 'exhentai' && !exSession.configured) { updateSourceSettings(); return; }
  if (source === state.source && list.source === source) return;
  state.source = source; save();
  const target = lists.tab(route(),source) || lists.create(route(),list.query,source);
  navigate('list',target); sendImageContext();
}
async function clearExSession() {
  ++authRequest;
  try {
    await requestExSession({method:'DELETE'});
    await clearPrivateImageCaches().catch(() => {});
    navigator.serviceWorker?.controller?.postMessage({type:'clear-private-images',scope:exSession.scope});
    exSession = {configured:false,scope:null}; setExScope(null); purgeExLists();state.tagPreferences=[];save();
    $('#ex-credentials-form').reset();
    if (state.source === 'exhentai' || list.source === 'exhentai') switchSource('e-hentai');
    updateFavorites();updateSourceSettings(); $('#ex-session-status').textContent = '已清除凭证和对应的私有图片缓存。';
  } catch (error) { $('#ex-session-status').textContent = error.message; }
}
let imageCountRequest=0;
async function updateImageCount() {
  const request=++imageCountRequest;
  const [count,usage]=await Promise.allSettled([imageCacheCount(),cacheStorageUsage()]);
  if(request!==imageCountRequest)return;
  $('#image-cache-count').textContent=count.status==='fulfilled'?`已缓存 ${count.value} 张图片`:'当前浏览器暂不支持图片缓存';
  const data=usage.status==='fulfilled'?usage.value:null;
  $('#image-cache-usage').textContent=data?`${data.kind==='cache'?'缓存占用':'本站存储占用'}约 ${formatBytes(data.bytes)}${data.kind==='cache'?'（含应用资源）':'（含缓存及其他本地数据）'}`:'当前浏览器不提供存储占用统计';
}
$('#ex-credentials-form').addEventListener('submit',async event => {
  event.preventDefault();
  ++authRequest;
  const form = event.currentTarget, button = $('#verify-ex');
  button.disabled = true; $('#ex-session-status').textContent = '正在验证 ExHentai 访问权限…';
  try {
    const values = Object.fromEntries(new FormData(form));
    const checked = await requestExSession({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const oldScope = exSession.scope;
    if (oldScope && oldScope!==checked.scope) {state.tagPreferences=[];save();}
    if (oldScope) await clearImageCaches(oldScope).catch(() => {});
    purgeExLists(); exSession = checked; setExScope(checked.scope); form.reset(); updateSourceSettings(); sendImageContext();
    await refreshExSession({fillForm:true});
    $('#ex-session-status').textContent = checked.refreshedIgneous ? '验证成功，已自动更新 igneous 并保存到本机。关闭浏览器后仍可使用。' : '验证成功，凭证已保存到本机。关闭浏览器后仍可使用。';
    if (list.source === 'exhentai' || accountList(list)) {const target=lists.create(route(),list.query,list.source);Object.assign(target,{feed:list.feed,filters:list.filters});navigate('list',target);}
  } catch (error) { $('#ex-session-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#settings-dialog').addEventListener('close',() => $('#ex-credentials-form').reset());
function categoryCount() {
  const count = $('#category-options').querySelectorAll('input:checked').length;
  $('#category-count').textContent = `已选 ${count} / ${categories.length} 类`;
}
function selectCategories(all) {
  $('#category-options').querySelectorAll('input').forEach(input => { input.checked = all; });
  categoryCount();
}
function applyCategories() {
  const selected = [...$('#category-options').querySelectorAll('input:checked')].map(input => input.value);
  const changed = selected.join('|') !== state.categories.join('|');
  state.categories = selected; save(); $('#settings-dialog').close();
  if (changed && entry.screen !== 'reader') {
    clearTimeout(renderTimer); renderTimer = null; debounceTarget = null; render(); loadGalleries();
  }
  toast('已应用全局分类');
}
function settings() {
  updateSourceSettings(); refreshExSession({fillForm:true}).then(updateSourceSettings).catch(error => { $('#ex-session-status').textContent = error.message; }); updateImageCount();
  $('#category-options').innerHTML = categories.map(category => `<label class="category-option"><input type="checkbox" name="category" value="${escape(category.name)}" ${state.categories.includes(category.name) ? 'checked' : ''}><span>${escape(category.name)}<small>${escape(category.label)}</small></span></label>`).join('');
  categoryCount();
  $('#theme-setting').value = state.theme;
  $('#settings-dialog').showModal();
  $('#settings-dialog').scrollTop = 0;
}
document.addEventListener('click', event => {
  const tools=$('.advanced-tools[open]');
  if(tools && (!tools.contains(event.target)||event.target.closest('[data-action=settings],[data-feature], [data-search-tag]')))tools.open=false;
  const link = event.target.closest('a[href^="#"]');
  if (link && names[link.hash.slice(1)] && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigateTab(link.hash.slice(1)); return; }
  const button = event.target.closest('button'); if (!button) return;
  if (button.hasAttribute('data-open-photo')) return navigate('photo',list,entry.galleryId,{photoIndex:Number(button.dataset.openPhoto)});
  if (button.dataset.open) return navigate('detail',list,button.dataset.open);
  if(button.dataset.removeHistory)return removeHistory(button.dataset.removeHistory);
  if(button.hasAttribute('data-recent-search')){
    const record=recentSearches(state.searchHistory,list)[Number(button.dataset.recentSearch)];if(!record)return;
    list.query=record.query;$('#search').value=record.query;rememberSearch();renderSearchHistory();clearTimeout(renderTimer);renderTimer=null;debounceTarget=null;loadGalleries(false,list);remember();return;
  }
  if(button.hasAttribute('data-remove-search')){
    const record=recentSearches(state.searchHistory,list)[Number(button.dataset.removeSearch)];
    state.searchHistory=state.searchHistory.filter(item=>item!==record&&!(item.query===record?.query&&item.source===record?.source&&item.scope===record?.scope));save();renderSearchHistory();return;
  }
  if(button.dataset.favorite){
    if(button.closest('.gallery-actions')&&favorites.has(button.dataset.favorite))return features.openFavorite();
    return favorite(button.dataset.favorite);
  }
  if(button.dataset.syncFavorite){const gallery=favorites.meta(button.dataset.syncFavorite).gallery;return gallery&&saveFavorite(gallery);}
  if (button.dataset.read) return navigate('reader',list,button.dataset.read);
  if (button.dataset.searchTag) return searchTag(button.dataset.searchTag);
  const actions = {
    'clear-search-history':()=>{if(confirm('清空当前搜索范围的搜索记录？')){state.searchHistory=state.searchHistory.filter(item=>item.source!==list.source||item.scope!==searchScope(list));save();renderSearchHistory();}},
    'clear-ex-session':clearExSession, 'clear-image-cache':async () => { await clearImageCaches(); updateImageCount(); toast('已清除图片缓存'); },
    'select-all-categories':() => selectCategories(true), 'clear-categories':() => selectCategories(false), 'apply-categories':applyCategories,
    'clear-search':() => { list.query = ''; clearTimeout(renderTimer); renderTimer = null; debounceTarget = null; render(); remember(); if (!localCollection(list)) loadGalleries(); },
    'refresh-list':() => loadGalleries(), 'retry-detail':() => renderDetail(entry.galleryId),
    'load-more':() => loadGalleries(true), 'retry-list':() => loadGalleries(list.pendingAppend), 'retry-reader':() => openReader(entry.galleryId),
    theme:() => { state.theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'; save(); theme(); },
    'search-back':back,settings, 'close-settings':() => $('#settings-dialog').close(), 'close-detail':back,
    'exit-reader':back, 'reader-mode':() => { if (readerMode === 'scroll') navigate('photo',list,activeGallery.id,{replace:true,photoIndex:currentPage}); else { readerMode = 'scroll';state.mode = 'scroll';save();renderReader(); } },
    'reader-favorite':() => favorite(activeGallery.id), prev:() => goPage(currentPage - 1), next:() => goPage(currentPage + 1),
    view:() => { remember(); list.listMode = !list.listMode; render(); restoreScroll(); remember(); }, 'clear-history':() => { if (confirm('清除这台设备上的全部阅读记录？收藏会保留。')) { state.progress = {}; save(); renderResults(); remember(); toast('已清除阅读记录'); } }
  }; actions[button.dataset.action]?.();
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    if (debounceTarget && debounceTarget !== list) flushSearch();
    list.query = event.target.value;renderSearchHistory(); clearTimeout(renderTimer);
    const localIds=localCollection(list)?(collectionView(list)==='favorites'?state.favorites:Object.keys(state.progress)).filter(id=>galleryReference(id).source===list.source):[];
    if (localCollection(list) && localIds.every(id=>knownGalleries.has(id))) renderResults();
    else {
      const target = list; target.requestId = (target.requestId || 0) + 1; target.isLoading = true; target.pendingAppend = false; target.pendingRequest = null;
      debounceTarget = target;
      renderTimer = setTimeout(() => { renderTimer = null; debounceTarget = null; loadGalleries(false,target); },450);
    }
    remember();
  }
  if (event.target.id === 'page-slider') goPage(Number(event.target.value)-1);
});
document.addEventListener('change', event => {
  if (event.target.id === 'source-setting') switchSource(event.target.value);
  if (event.target.name === 'category') categoryCount();
  const id = event.target.id;
  if (id === 'sort') { list.sort = event.target.value; renderResults(); remember(); }
  if (id === 'theme-setting') { state.theme = event.target.value; save(); theme(); }
});
document.addEventListener('keydown', event => {
  if(event.key==='Escape'&&$('.advanced-tools[open]')){const tools=$('.advanced-tools');tools.open=false;tools.querySelector('summary').focus();return;}
  if (entry.screen !== 'reader') return;
  if (event.key === 'Escape') { event.preventDefault(); back(); }
  if (!activeGallery) return;
  if (event.target.matches('input,select')) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); goPage(currentPage + (state.direction === 'rtl' ? -1 : 1)); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); goPage(currentPage + (state.direction === 'rtl' ? 1 : -1)); }
});
let touchStart = null;
$('#reader-content').addEventListener('touchstart', event => { touchStart = event.touches.length === 1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY} : null; }, {passive:true});
$('#reader-content').addEventListener('touchend', event => {
  if (!touchStart || readerMode !== 'paged' || (window.visualViewport?.scale || 1) > 1.05) return;
  const dx = event.changedTouches[0].clientX - touchStart.x, dy = event.changedTouches[0].clientY - touchStart.y; touchStart = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) goPage(currentPage + (dx < 0 ? 1 : -1) * (state.direction === 'rtl' ? -1 : 1));
}, {passive:true});
$('#reader-content').addEventListener('click', event => {
  if (!activeGallery || event.target.tagName !== 'IMG') return;
  if(readerMode==='scroll'){entry.readerZoomIndex=Number(event.target.dataset.page);return navigate('photo-full',list,activeGallery.id,{photoIndex:entry.readerZoomIndex,photoOrigin:'reader'});}
  if(readerMode!=='paged')return;
  const x = event.clientX / innerWidth;
  if (x < .25 || x > .75) goPage(currentPage + (x > .75 ? 1 : -1) * (state.direction === 'rtl' ? -1 : 1));
});
function connectivity() { $('#network').textContent = navigator.onLine ? '实时图集' : '网络已断开'; $('#network').classList.toggle('offline',!navigator.onLine); }
window.addEventListener('online',connectivity); window.addEventListener('offline',connectivity); connectivity();
function suspendPage() { leavingPage = true; rememberSearch();record(); remember(); }
window.addEventListener('beforeunload',suspendPage);
window.addEventListener('pagehide',suspendPage);
window.addEventListener('pageshow',event => {
  leavingPage = false;
  if (!event.persisted || !list?.isLoading) return;
  const target = list, pending = target.pendingRequest;
  Promise.resolve(pending).finally(() => {
    if (target.isLoading && target.pendingRequest === pending) { target.pendingRequest = null; loadGalleries(target.pendingAppend,target); }
  });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { record(); remember(); } });

function openSearch(query='',filters={},global=false) {
  const target=lists.create('search',query,list.source);
  target.searchOrigin=list.searchOrigin||(names[list.view]?list.view:'library');
  target.searchScope=global?'source':list.searchScope||list.view;
  target.searchFeed=global?'latest':['watched','favorites'].includes(feedFor(list))?feedFor(list):'latest';
  target.filters=filters;target.sort='source';
  navigate('list',target,null,{replace:list.view==='search'&&entry.screen==='list'});
  if(query.trim())rememberSearch();
}
document.addEventListener('submit',event=>{
  if(event.target.id!=='search-page-form')return;
  event.preventDefault();rememberSearch();renderSearchHistory();clearTimeout(renderTimer);renderTimer=null;debounceTarget=null;
  if(!list.isLoading||!list.pendingRequest)loadGalleries(false,list);
  remember();$('#search')?.blur();
});

const favorites=new Favorites({state,save,getScope:()=>exSession.scope,ensureScope:async()=>{await refreshExSession();return exSession.configured?exSession.scope:null;},request:requestJSON,onChange:updateFavorites});
for(const target of lists.lists.values())for(const gallery of target.galleries)favorites.remember(gallery);

const features = new SourceFeatures({
  request:requestJSON,toast,state,save,getList:()=>list,getScope:()=>exSession.scope,
  exportPageLinks:async(gallery,pages,signal)=>{
    const store=thumbnailStore(gallery),links=[];
    for(const page of pages){signal.throwIfAborted();const thumbnail=await store.ensure(page-1);signal.throwIfAborted();if(!thumbnail?.pageURL)throw new Error('暂时无法读取图片页链接，请刷新图集后重试');links.push({page,url:thumbnail.pageURL});}
    return links;
  },
  ensureAccount:async()=>{await refreshExSession();return exSession.configured;},
  onFeed:feed=>{
    const target=[...lists.lists.values()].find(target=>target.source===list.source&&target.view==='discover'&&feedFor(target)===feed&&!target.query&&JSON.stringify(target.filters||{})===JSON.stringify(list.filters||{}))||lists.create('discover','',list.source);
    target.feed=feed;target.filters={...list.filters};delete target.filters.f_shash;navigate('list',target);
  },
  onOpenSearch:()=>{openSearch('',{...list.filters});$('#search')?.focus({preventScroll:true});},
  onSearch:(query,filters,view)=>openSearch(query,filters,view==='library'),
  onPreferences:tags=>{state.tagPreferences=tags;save();if($('#gallery-grid')){renderQuickTags();renderResults();}},
  favoriteInfo:gallery=>favorites.info(gallery.id),
  onFavoriteKnown:(gallery,info,scope)=>favorites.confirm(gallery,info,scope),
  onFavoriteSave:saveFavorite,
  favoriteMessage:favoriteResult
});
const listLoader=new InfiniteList(
  key=>{if(list?.key===key)loadGalleries(true,list);},
  key=>list?.key===key&&entry?.screen==='list'&&!list.isLoading&&!list.listError&&!restoringScroll&&!document.querySelector('dialog[open]')&&document.visibilityState!=='hidden'&&(!!list.nextCursor||popularFeed(list)&&list.discoveryContinuation)
);
decorateIcons();

async function boot() {
  const pendingList=lists.lists.get(history.state?.listKey) || lists.tab(location.hash.slice(1),state.source) || history.state?.fallback;
  if (state.source === 'exhentai' || history.state?.source === 'exhentai' || location.hash.includes('/ex/') || pendingList && accountList(pendingList)) {
    try { await refreshExSession(); } catch { /* The settings page can retry verification. */ }
    if (!exSession.configured) { state.source = 'e-hentai'; purgeExLists(); await clearPrivateImageCaches().catch(() => {}); save(); }
  }
  applyNavigation();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange',sendImageContext);
    navigator.serviceWorker.register('/sw.js',{type:'module',updateViaCache:'none'}).then(() => navigator.serviceWorker.ready).then(sendImageContext).catch(() => {});
  }
}
boot();

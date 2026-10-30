import {metadata,getGallery,galleryWithPages,galleryReference,setExScope} from './source.mjs';
import {categories,excludedCategories,tagQuery} from './filters.mjs';
import {ListStore} from './navigation.mjs';
import {imageCacheCount,clearImageCaches,clearPrivateImageCaches} from './image-cache.mjs';
const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const names = {discover:'发现', favorites:'收藏', history:'足迹', library:'全部图集'};
const icons = {discover:'✧', favorites:'♡', history:'◷', library:'▥'};
let state;
try { state = JSON.parse(localStorage.getItem('yijing-v1')) || {}; } catch { state = {}; }
if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
state.favorites = Array.isArray(state.favorites) ? state.favorites.filter(id => typeof id === 'string') : [];
state.progress = state.progress && typeof state.progress === 'object' && !Array.isArray(state.progress) ? state.progress : {};
state.mode = ['paged','scroll'].includes(state.mode) ? state.mode : 'paged';
state.direction = state.direction === 'rtl' ? 'rtl' : 'ltr';
state.theme = ['light','dark','system'].includes(state.theme) ? state.theme : 'system';
state.categories = Array.isArray(state.categories) ? categories.map(category => category.name).filter(name => state.categories.includes(name)) : categories.map(category => category.name);
state.source = state.source === 'exhentai' ? 'exhentai' : 'e-hentai';
let exSession = {configured:false,scope:null}, authRequest = 0;
const sourceName = source => source === 'exhentai' ? 'ExHentai' : 'E-Hentai';
const knownGalleries = new Map();
let session;
try { session = sessionStorage; } catch { /* Keep navigation in memory. */ }
const lists = new ListStore(session);
let list, entry, appliedEntry = null, restoringScroll = false, leavingPage = false;
let activeGallery = null, currentPage = 0, readerMode = state.mode;
let observer, toastTimer, renderTimer, debounceTarget, scrollTimer, readerRequest = 0, detailRequest = 0;
let storageWarning = false;
history.scrollRestoration = 'manual';
async function requestJSON(path,options={}) {
  const response = await fetch(path,{...options,cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '请求失败，请稍后重试'),{status:response.status});
  return data;
}
const imageFor = g => g.thumb;
const pageCount = g => g.pageCount;

function save() {
  try { localStorage.setItem('yijing-v1', JSON.stringify(state)); }
  catch { if (!storageWarning) { toast('浏览器存储不可用，本次收藏和进度无法持久保存'); storageWarning = true; } }
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function theme() {
  document.documentElement.classList.toggle('dark', state.theme === 'dark' || state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').content = document.documentElement.classList.contains('dark') ? '#18221d' : '#f5f4ef';
}
theme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
function route() { return list?.view || 'discover'; }
function favorite(id) {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter(value => value !== id) : [...state.favorites, id]; save();
  document.querySelectorAll(`[data-favorite="${CSS.escape(id)}"]`).forEach(button => { button.textContent = state.favorites.includes(id) ? '♥' : '♡'; button.setAttribute('aria-pressed', String(state.favorites.includes(id))); });
  if (activeGallery?.id === id) updateReaderFavorite();
  if (entry?.screen === 'list') { renderResults(); remember(); }
}
function progressFor(gallery) {
  const p = state.progress[gallery.id];
  return p && Number.isInteger(p.page) ? Math.max(0, Math.min(pageCount(gallery) - 1, p.page)) : 0;
}
function nav() {
  const html = Object.entries(names).map(([key, value]) => `<a href="#${key}" class="nav-link ${route() === key ? 'active' : ''}" ${route() === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icons[key]}</span>${value}</a>`).join('');
  $('#desktop-nav').innerHTML = html; $('#mobile-nav').innerHTML = html; $('#breadcrumb').textContent = names[route()];
}
function card(g) {
  const p = state.progress[g.id], percent = p ? Math.round((progressFor(g) + 1) / pageCount(g) * 100) : 0;
  return `<article class="card"><button class="card-open" data-open="${escape(g.id)}" aria-label="查看 ${escape(g.title)}"><div class="cover-wrap"><img src="${escape(imageFor(g))}" alt="${escape(g.title)} 封面" loading="lazy" width="600" height="800"><span class="cover-label">${escape(g.category)}</span><span class="page-badge">${pageCount(g)} P</span></div><div class="card-text"><h3>${escape(g.title)}</h3><div class="card-sub"><span>${escape(g.creator)}</span><span>${escape(g.date)}</span></div><div class="card-tags">${g.tags.slice(0,3).map(tag => `<span>${escape(tag)}</span>`).join('')}</div>${p ? `<div class="progress-track" aria-label="已读 ${percent}%"><span style="width:${percent}%"></span></div>` : ''}</div></button><button class="favorite-button" data-favorite="${escape(g.id)}" aria-label="收藏 ${escape(g.title)}" aria-pressed="${state.favorites.includes(g.id)}">${state.favorites.includes(g.id) ? '♥' : '♡'}</button></article>`;
}
function filtered() {
  if (['favorites','history'].includes(route())) {
    const ids = route() === 'favorites' ? state.favorites : Object.keys(state.progress);
    const known = ids.map(id => knownGalleries.get(id)).filter(g => g?.source === list.source);
    list.galleries = [...new Map([...list.galleries,...known].map(g => [g.id,g])).values()];
  }
  let items = list.galleries.filter(g => g.source === list.source && state.categories.includes(g.category) && (route() !== 'favorites' || state.favorites.includes(g.id)) && (route() !== 'history' || state.progress[g.id]));
  const q = list.query.trim().toLowerCase();
  if (q && ['favorites','history'].includes(route())) items = items.filter(g => [g.title,g.creator,...g.tags].join(' ').toLowerCase().includes(q));
  return items.sort((a,b) => route() === 'history' ? (state.progress[b.id]?.time || 0) - (state.progress[a.id]?.time || 0) : list.sort === 'title' ? a.title.localeCompare(b.title,'zh-CN') : list.sort === 'pages' ? pageCount(b) - pageCount(a) : b.date.localeCompare(a.date));
}
function renderResults() {
  if (!$('#gallery-grid')) return;
  const items = filtered(); $('#result-count').textContent = list.isLoading ? '正在请求源站…' : `${items.length} 本图集`;
  $('#gallery-grid').className = `grid ${list.listMode ? 'list-mode' : ''}`;
  const emptyMessages = {favorites:['还没有收藏','点击图集右上角的爱心，把喜欢的作品留在这里。'], history:['还没有阅读足迹','打开一本图集开始阅读，之后可以从上次的位置继续。']};
  const [title, message] = !state.categories.length ? ['尚未选择分类','打开阅读偏好，选择你想浏览的分类。'] : list.query || state.categories.length < categories.length ? ['没有找到匹配图集','试试其他关键词，或调整全局分类。'] : emptyMessages[route()] || ['暂无可阅读图集','稍后重试，或搜索你感兴趣的作品。'];
  $('#gallery-grid').innerHTML = items.length ? items.map(card).join('') : list.isLoading ? '<div class="loading">正在获取实时图集…</div>' : list.listError ? '' : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${icons[route()]}</div><h3>${title}</h3><p>${message}</p></div>`;
  $('#list-status').innerHTML = list.listError ? `<div class="empty"><p role="alert">${escape(list.listError)}</p><button class="outline-button" data-action="retry-list">重新加载</button></div>` : list.nextCursor ? `<button class="outline-button" data-action="load-more" ${list.isLoading ? 'disabled' : ''}>${list.isLoading ? '正在加载…' : '加载更多'}</button>` : '';
}
function renderHero() {
  const visible = list.galleries.filter(g => g.source === list.source && state.categories.includes(g.category));
  const hero = visible[0];
  $('#hero').innerHTML = route() === 'discover' && hero ? `<section class="hero"><div class="hero-copy"><span class="hero-tag">✧ 实时发现 · ${escape(sourceName(list.source))}</span><h2>翻开新的世界<br>发现此刻的灵感</h2><p>从喜欢的作品出发，<br>收藏每一次新的相遇。</p><button class="primary-button" data-open="${escape(hero.id)}">翻开图集 <span>↗</span></button></div><img class="hero-art" src="${escape(imageFor(hero))}" alt="${escape(hero.title)}"><span class="hero-edition">YOUR GALLERY READER</span></section>` : '';
  const tags = [...new Set(visible.flatMap(g => g.tags))].slice(0,5);
  $('#tag-filters').innerHTML = ['全部',...tags].map(tag => { const active = tag === '全部' ? !list.query : list.query === tagQuery(tag); return `<button class="chip ${active ? 'active' : ''}" ${tag === '全部' ? 'data-action="clear-search"' : `data-search-tag="${escape(tag)}"`} aria-pressed="${active}">${escape(tag)}</button>`; }).join('');
}
function render() {
  nav(); const view = route(), titles = {discover:['每一次翻阅，都是新的发现。','实时浏览图集，挑一本慢慢翻阅。'], favorites:['收藏你的心动瞬间。','喜欢的作品，在这里重逢。'], history:['从上次停下的地方，继续。','每一段阅读，都值得被记住。'], library:['属于你的，图像世界。','搜索源站图集，寻找下一次灵感。']};
  $('#main').innerHTML = `<div class="heading-row"><div><div class="eyebrow">${view === 'discover' ? 'A QUIET SPACE FOR YOUR INSPIRATION' : 'YOUR PERSONAL COLLECTION'}</div><h1>${titles[view][0]}</h1><p class="intro">${titles[view][1]}</p></div><span class="date-note">A little escape, a new perspective.</span></div><div id="hero"></div><section aria-label="图集列表"><div class="section-heading"><h2>${view === 'discover' ? '最新图集' : names[view]}<small id="result-count"></small></h2><div class="view-options"><button class="category-button" data-action="settings" aria-label="设置全局分类">分类 · ${state.categories.length === categories.length ? '全部' : state.categories.length}</button><button class="icon-button" data-action="refresh-list" aria-label="刷新当前列表">↻</button><select id="sort" aria-label="图集排序"><option value="newest">最近更新</option><option value="title">名称排序</option><option value="pages">页数最多</option></select><button data-action="view" class="icon-button" aria-label="切换列表布局" aria-pressed="${list.listMode}">${list.listMode ? '▦' : '☷'}</button></div></div><div class="toolbar"><div id="tag-filters" class="chips"></div><label class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="${['favorites','history'].includes(view) ? '搜索当前列表' : `搜索 ${sourceName(list.source)} 图集或粘贴图集链接`}" value="${escape(list.query)}" aria-label="搜索图集"></label></div><div id="gallery-grid" class="grid"></div><div id="list-status" class="list-status"></div></section><div class="content-notice">图集来自 ${escape(sourceName(list.source))}，已加载图片优先从本地缓存读取。收藏、阅读进度与设置仅保存在当前设备。</div>`;
  $('#sort').value = list.sort; renderHero(); renderResults();
}
async function loadGalleries(append=false,target=list) {
  if (renderTimer && debounceTarget === target) { clearTimeout(renderTimer); renderTimer = null; debounceTarget = null; }
  const request = target.requestId = (target.requestId || 0) + 1;
  const view = target.view, search = target.query, source = target.source, cursor = append ? target.nextCursor : null;
  const selected = [...state.categories];
  target.isLoading = true; target.listError = ''; target.initialized = true;
  target.pendingAppend = append; target.categoryKey = selected.join('|'); target.authScope = source === 'exhentai' ? exSession.scope : null;
  if (!append) { target.galleries = []; target.nextCursor = null; target.scrollY = 0; }
  if (!selected.length) { target.isLoading = false; target.nextCursor = null; }
  if (target === list) { renderHero(); renderResults(); if (!append && entry.screen === 'list') restoreScroll(); }
  lists.save();
  if (!selected.length) return;
  target.pendingRequest = (async () => {
    try {
      let data;
      if (['favorites','history'].includes(view)) {
        const ids = (view === 'favorites' ? state.favorites : Object.keys(state.progress)).filter(id => id.includes('/') && galleryReference(id).source === source);
        data = {galleries:await metadata(ids.map(id => { const {gid,token} = galleryReference(id); return [Number(gid),token]; }),source),next:null};
      } else {
        const match = search.trim().match(/^https:\/\/(e-hentai|exhentai)\.org\/g\/(\d+)\/([a-f0-9]+)\/?$/);
        if (match) data = {galleries:[await getGallery(match[2],match[3],match[1] === 'exhentai' ? 'exhentai' : 'e-hentai')],next:null};
        else {
          const listing = await requestJSON(`/api/galleries?${new URLSearchParams({q:search,next:cursor || '',f_cats:String(excludedCategories(selected)),...(source === 'exhentai' ? {source} : {})})}`);
          data = {galleries:await metadata(listing.ids,source),next:listing.next};
        }
      }
      if (request !== target.requestId) return;
      data.galleries.forEach(g => knownGalleries.set(g.id,g));
      target.galleries = append ? [...new Map([...target.galleries,...data.galleries].map(g => [g.id,g])).values()] : data.galleries;
      target.nextCursor = data.next;
    } catch (error) { if (!leavingPage && request === target.requestId) target.listError = error.message; }
    finally {
      if (!leavingPage && request === target.requestId) {
        target.isLoading = false; target.pendingRequest = null;
        if (target === list) { renderHero(); renderResults(); }
        lists.save();
      }
    }
  })();
  return target.pendingRequest;
}
async function renderDetail(id) {
  const request = ++detailRequest;
  let g = knownGalleries.get(id);
  if (!g) {
    $('#detail-body').innerHTML = '<div class="dialog-header"><h2>图集详情</h2><button class="icon-button" data-action="close-detail" aria-label="关闭详情">✕</button></div><div class="loading">正在获取图集…</div>';
    if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
    try { const {gid,token,source} = galleryReference(id); g = await getGallery(gid,token,source); knownGalleries.set(g.id,g); }
    catch (error) {
      if (request === detailRequest && entry.screen === 'detail') $('#detail-body').innerHTML = `<div class="dialog-header"><h2>图集详情</h2><button class="icon-button" data-action="close-detail" aria-label="关闭详情">✕</button></div><div class="empty"><p>${escape(error.message)}</p><button class="outline-button" data-action="retry-detail">重新加载</button><button class="outline-button" data-action="settings">设置凭证</button></div>`;
      return;
    }
  }
  if (request !== detailRequest || entry.screen !== 'detail' || entry.galleryId !== id) return;
  $('#detail-body').innerHTML = `<div class="dialog-header"><h2>图集详情</h2><button class="icon-button" data-action="close-detail" aria-label="关闭详情">✕</button></div><div class="gallery-summary"><img class="gallery-cover" src="${escape(imageFor(g))}" alt="${escape(g.title)}"><div class="gallery-summary-copy"><span class="eyebrow">${escape(sourceName(g.source))} / ${escape(g.category)}</span><h2>${escape(g.title)}</h2><div class="gallery-facts"><span>${escape(g.creator)}</span><span>${pageCount(g)} P</span><span>${escape(g.date)}</span></div>${g.description && g.description !== g.title ? `<p>${escape(g.description)}</p>` : ''}</div></div><div class="gallery-tags"><div class="gallery-tags-heading"><b>标签</b><span>点击标签查找相关图集</span></div><div class="card-tags">${g.tags.map(tag => `<button class="chip" data-search-tag="${escape(tag)}">${escape(tag)}</button>`).join('')}</div></div><div class="gallery-actions"><button class="primary-button" data-read="${escape(g.id)}">${state.progress[g.id] ? `继续阅读 · 第 ${progressFor(g)+1} 页` : '开始阅读'} <span>→</span></button><button class="outline-button" data-favorite="${escape(g.id)}" aria-pressed="${state.favorites.includes(g.id)}">${state.favorites.includes(g.id) ? '♥ 已收藏' : '♡ 收藏图集'}</button></div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = entry.detailScroll || 0;
}
function record() { if (!activeGallery) return; state.progress[activeGallery.id] = {page:currentPage, time:Date.now()}; save(); updateCounter(); }
function updateCounter() {
  $('#page-slider').value = String(currentPage + 1); $('#page-counter').textContent = `${currentPage + 1} / ${activeGallery.pages.length}`;
  $('[data-action=prev]').disabled = currentPage === 0; $('[data-action=next]').disabled = currentPage === activeGallery.pages.length - 1;
}
function updateReaderFavorite() { const b = $('#reader-favorite'); b.textContent = state.favorites.includes(activeGallery.id) ? '♥' : '♡'; b.setAttribute('aria-pressed', String(state.favorites.includes(activeGallery.id))); }
function readerImage(page, index) { return `<img src="${escape(page.src)}" alt="${escape(page.alt || `${activeGallery.title} · 第 ${index + 1} 页`)}" data-page="${index}" ${readerMode === 'scroll' ? 'loading="lazy"' : ''} draggable="false" width="${page.width || 600}" height="${page.height || 800}">`; }
function renderReader() {
  observer?.disconnect(); const content = $('#reader-content'); content.className = `reader-content ${readerMode}`;
  content.innerHTML = readerMode === 'paged' ? readerImage(activeGallery.pages[currentPage], currentPage) : activeGallery.pages.map(readerImage).join('');
  content.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
    const box = document.createElement('div'); box.className = 'image-error'; box.innerHTML = '<span>图片暂时无法加载，请检查网络连接。</span><button class="outline-button">重新加载</button>';
    box.querySelector('button').onclick = () => {
      box.remove();
      const retry = new URL(activeGallery.pages[Number(img.dataset.page)].src,location.origin);
      retry.searchParams.set('retry',String(Date.now()));
      img.src = retry.href;
    }; img.after(box);
  }));
  if (readerMode === 'scroll') {
    observer = new IntersectionObserver(entries => { const best = entries.filter(e => e.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0]; if (best) { currentPage = Number(best.target.dataset.page); record(); } }, {root:content,threshold:[0,.2,.5,.75]});
    content.querySelectorAll('img').forEach(img => observer.observe(img));
    requestAnimationFrame(() => { const img = content.querySelector(`[data-page="${currentPage}"]`); if (img) content.scrollTop = img.offsetTop; });
  } else {
    content.scrollTop = 0;
  }
  $('[data-action=reader-mode]').textContent = readerMode === 'paged' ? '▤' : '▣';
  $('[data-action=reader-mode]').setAttribute('aria-label', readerMode === 'paged' ? '切换纵向滚动' : '切换逐页翻阅');
  record();
}
async function openReader(id) {
  const request = ++readerRequest;
  $('#detail-dialog').close(); $('#settings-dialog').close();
  $('#reader').hidden = false; document.body.classList.add('reading'); $('.shell').inert = true; $('.sidebar').inert = true; $('.bottom-nav').inert = true;
  $('#reader-title').textContent = '正在获取图集…'; $('#reader-source').textContent = sourceName(galleryReference(id).source);
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
    activeGallery = g; currentPage = progressFor(g); readerMode = state.mode;
    $('#reader-title').textContent = g.title; $('#reader-source').textContent = `${sourceName(g.source)} · ${g.category}`;
    $('#page-slider').disabled = false;
    for (const action of ['reader-mode','reader-favorite']) $(`[data-action=${action}]`).disabled = false;
    $('#page-slider').max = String(g.pages.length); updateReaderFavorite(); renderReader();
  } catch (error) {
    if (request !== readerRequest || entry.screen !== 'reader' || entry.galleryId !== id) return;
    $('#reader-content').innerHTML = `<div class="image-error"><h3>图集暂时无法加载</h3><p role="alert">${escape(error.message)}</p><button class="outline-button" data-action="retry-reader">重新加载</button><button class="outline-button" data-action="settings">设置凭证</button></div>`;
  }
}
function hideReader() {
  ++readerRequest; record(); observer?.disconnect(); activeGallery = null;
  $('#reader').hidden = true; document.body.classList.remove('reading'); $('.shell').inert = false; $('.sidebar').inert = false; $('.bottom-nav').inert = false;
  $('#reader-content').replaceChildren();
}
function goPage(page) {
  if (!activeGallery) return; currentPage = Math.max(0,Math.min(activeGallery.pages.length - 1,page));
  if (readerMode === 'scroll') { const img = $('#reader-content').querySelector(`[data-page="${currentPage}"]`); $('#reader-content').scrollTo({top:img.offsetTop,behavior:'instant'}); record(); }
  else renderReader();
}
function remember() {
  if (!list || !entry) return;
  if (!restoringScroll && !document.body.classList.contains('reading')) list.scrollY = window.scrollY;
  if ($('#detail-dialog').open) entry.detailScroll = $('#detail-dialog').scrollTop;
  history.replaceState({...entry,fallback:{view:list.view,query:list.query,sort:list.sort,listMode:list.listMode,source:list.source}},'');
  lists.save();
}
function restoreScroll() {
  const target = list, y = target.scrollY;
  restoringScroll = true;
  requestAnimationFrame(() => {
    if (target === list && entry.screen !== 'reader') window.scrollTo({top:y,behavior:'instant'});
    requestAnimationFrame(() => { restoringScroll = false; });
  });
}
function makeEntry(screen,target,galleryId=null,parent=false) {
  return {yijingNav:1,key:crypto.randomUUID(),listKey:target.key,view:target.view,source:target.source,screen,galleryId,parent,fallback:{view:target.view,query:target.query,sort:target.sort,listMode:target.listMode,source:target.source}};
}
function entryHash(value) { return value.screen === 'reader' ? `#read/${value.galleryId}` : value.screen === 'detail' ? `#gallery/${value.galleryId}` : `#${value.view}`; }
function adoptLocation() {
  const hash = location.hash || '#discover';
  if (history.state?.yijingNav === 1 && entryHash(history.state) === hash) return history.state;
  const [screen,...parts] = hash.slice(1).split('/');
  const view = names[screen] ? screen : 'discover';
  const target = names[screen] ? lists.tab(view,state.source) || lists.create(view,'',state.source) : list || lists.tab(view,state.source) || lists.create(view,'',state.source);
  const value = makeEntry(screen === 'read' ? 'reader' : screen === 'gallery' ? 'detail' : 'list',target,parts.join('/') || null);
  history.replaceState(value,'',entryHash(value));
  return value;
}
function applyNavigation() {
  flushSearch();
  const next = adoptLocation();
  if (next.key === appliedEntry) return;
  const previous = list;
  entry = next; appliedEntry = next.key;
  list = lists.lists.get(next.listKey);
  if (!list) {
    list = lists.create(next.fallback?.view || next.view,next.fallback?.query || '',next.source || next.fallback?.source || 'e-hentai');
    Object.assign(list,{sort:next.fallback?.sort || 'newest',listMode:!!next.fallback?.listMode});
    entry.listKey = list.key; history.replaceState(entry,'');
  }
  if (list.source === 'exhentai' && !exSession.configured) {
    list.galleries = []; list.initialized = false;
  } else { state.source = list.source; save(); }
  lists.activate(list);
  sendImageContext();
  list.galleries.forEach(g => knownGalleries.set(g.id,g));
  ++detailRequest;
  if (!$('#reader').hidden) hideReader();
  $('#detail-dialog').close(); $('#settings-dialog').close();
  const changed = previous !== list;
  if (changed || !$('#gallery-grid')) render();
  else if (entry.screen === 'list') renderResults();
  if (entry.screen === 'reader') openReader(entry.galleryId);
  else {
    restoreScroll();
    if (entry.screen === 'detail') renderDetail(entry.galleryId);
    if (entry.screen === 'list' && (!list.initialized || list.categoryKey !== state.categories.join('|') || list.source === 'exhentai' && list.authScope !== exSession.scope)) loadGalleries(false,list);
    else if (list.initialized && list.isLoading && !list.pendingRequest) loadGalleries(list.pendingAppend,list);
  }
  lists.save();
}
function navigate(screen,target=list,galleryId=null,{replace=false}={}) {
  remember();
  const value = makeEntry(screen,target,galleryId,!replace);
  history[replace ? 'replaceState' : 'pushState'](value,'',entryHash(value));
  applyNavigation();
}
function navigateTab(view) {
  if (entry.screen === 'list' && list.view === view) return;
  navigate('list',lists.tab(view,state.source) || lists.create(view,'',state.source));
}
function back() {
  remember();
  if (entry.parent) history.back();
  else navigate('list',list,null,{replace:true});
}
function searchTag(tag) { navigate('list',lists.create('library',tagQuery(tag),list.source)); }
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
  navigator.serviceWorker?.controller?.postMessage({type:'image-context',source:list?.source || state.source,scope:exSession.scope});
}
async function refreshExSession() {
  const request = ++authRequest, checked = await requestJSON('/api/ex-session');
  if (request === authRequest) { exSession = checked; setExScope(exSession.scope); sendImageContext(); }
  return exSession;
}
function updateSourceSettings() {
  const option = $('#source-setting option[value="exhentai"]');
  option.disabled = !exSession.configured;
  option.textContent = exSession.configured ? 'ExHentai' : 'ExHentai（需要凭证）';
  $('#source-setting').value = state.source;
  if (exSession.configured) $('#ex-session-status').textContent = '凭证已验证，可以切换到 ExHentai。';
}
function purgeExLists() {
  for (const target of lists.lists.values()) if (target.source === 'exhentai') target.requestId = (target.requestId || 0) + 1;
  lists.removeSource('exhentai');
  for (const [key,g] of knownGalleries) if (g.source === 'exhentai') knownGalleries.delete(key);
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
    await requestJSON('/api/ex-session',{method:'DELETE'});
    await clearPrivateImageCaches().catch(() => {});
    navigator.serviceWorker?.controller?.postMessage({type:'clear-private-images',scope:exSession.scope});
    exSession = {configured:false,scope:null}; setExScope(null); purgeExLists();
    if (state.source === 'exhentai' || list.source === 'exhentai') switchSource('e-hentai');
    updateSourceSettings(); $('#ex-session-status').textContent = '已清除凭证和对应的私有图片缓存。';
  } catch (error) { $('#ex-session-status').textContent = error.message; }
}
async function updateImageCount() {
  try { $('#image-cache-count').textContent = `已缓存 ${await imageCacheCount()} 张图片`; }
  catch { $('#image-cache-count').textContent = '当前浏览器暂不支持图片缓存'; }
}
$('#ex-credentials-form').addEventListener('submit',async event => {
  event.preventDefault();
  ++authRequest;
  const form = event.currentTarget, button = $('#verify-ex');
  button.disabled = true; $('#ex-session-status').textContent = '正在验证 ExHentai 访问权限…';
  try {
    const values = Object.fromEntries(new FormData(form));
    const checked = await requestJSON('/api/ex-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const oldScope = exSession.scope;
    if (oldScope) await clearImageCaches(oldScope).catch(() => {});
    purgeExLists(); exSession = checked; setExScope(checked.scope); form.reset(); updateSourceSettings(); sendImageContext();
    $('#ex-session-status').textContent = checked.refreshedIgneous ? '验证成功，已自动更新 igneous。现在可以切换到 ExHentai。' : '验证成功，现在可以切换到 ExHentai。';
    if (list.source === 'exhentai') navigate('list',lists.create(route(),list.query,'exhentai'));
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
  updateSourceSettings(); refreshExSession().then(updateSourceSettings).catch(() => {}); updateImageCount();
  $('#category-options').innerHTML = categories.map(category => `<label class="category-option"><input type="checkbox" name="category" value="${escape(category.name)}" ${state.categories.includes(category.name) ? 'checked' : ''}><span>${escape(category.name)}<small>${escape(category.label)}</small></span></label>`).join('');
  categoryCount();
  $('#mode-setting').value = state.mode; $('#direction-setting').value = state.direction; $('#theme-setting').value = state.theme;
  $('#source-info').textContent = `当前来源：${sourceName(list.source)}。返回时保留列表，点击刷新可获取最新信息。已缓存图片可从本机读取，未缓存图片需要网络。`;
  $('#settings-dialog').showModal();
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (link && names[link.hash.slice(1)] && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigateTab(link.hash.slice(1)); return; }
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.open) return navigate('detail',list,button.dataset.open);
  if (button.dataset.favorite) return favorite(button.dataset.favorite);
  if (button.dataset.read) return navigate('reader',list,button.dataset.read);
  if (button.dataset.searchTag) return searchTag(button.dataset.searchTag);
  const actions = {
    'clear-ex-session':clearExSession, 'clear-image-cache':async () => { await clearImageCaches(); updateImageCount(); toast('已清除图片缓存'); },
    'select-all-categories':() => selectCategories(true), 'clear-categories':() => selectCategories(false), 'apply-categories':applyCategories,
    'clear-search':() => { list.query = ''; clearTimeout(renderTimer); renderTimer = null; debounceTarget = null; render(); remember(); if (!['favorites','history'].includes(route())) loadGalleries(); },
    'refresh-list':() => loadGalleries(), 'retry-detail':() => renderDetail(entry.galleryId),
    'load-more':() => loadGalleries(true), 'retry-list':() => loadGalleries(list.pendingAppend), 'retry-reader':() => openReader(entry.galleryId),
    theme:() => { state.theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'; save(); theme(); },
    settings, 'close-settings':() => $('#settings-dialog').close(), 'close-detail':back,
    'exit-reader':back, 'reader-mode':() => { readerMode = readerMode === 'paged' ? 'scroll' : 'paged'; state.mode = readerMode; save(); renderReader(); },
    'reader-favorite':() => favorite(activeGallery.id), prev:() => goPage(currentPage - 1), next:() => goPage(currentPage + 1),
    view:() => { remember(); list.listMode = !list.listMode; render(); restoreScroll(); remember(); }, 'clear-history':() => { if (confirm('清除这台设备上的全部阅读记录？收藏会保留。')) { state.progress = {}; save(); renderResults(); remember(); toast('已清除阅读记录'); } }
  }; actions[button.dataset.action]?.();
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    if (debounceTarget && debounceTarget !== list) flushSearch();
    list.query = event.target.value; clearTimeout(renderTimer);
    if (['favorites','history'].includes(route())) renderResults();
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
  if (['mode-setting','direction-setting','theme-setting'].includes(id)) { state[id.split('-')[0]] = event.target.value; save(); theme(); }
});
document.addEventListener('keydown', event => {
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
  if (!activeGallery || readerMode !== 'paged' || event.target.tagName !== 'IMG') return;
  const x = event.clientX / innerWidth;
  if (x < .25 || x > .75) goPage(currentPage + (x > .75 ? 1 : -1) * (state.direction === 'rtl' ? -1 : 1));
});
function connectivity() { $('#network').textContent = navigator.onLine ? '实时图集' : '网络已断开'; $('#network').classList.toggle('offline',!navigator.onLine); }
window.addEventListener('online',connectivity); window.addEventListener('offline',connectivity); connectivity();
function suspendPage() { leavingPage = true; record(); remember(); }
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
async function boot() {
  if (state.source === 'exhentai' || history.state?.source === 'exhentai' || location.hash.includes('/ex/')) {
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

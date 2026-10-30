import {metadata,getGallery} from './source.mjs';
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
const knownGalleries = new Map();
let galleries = [], activeGallery = null, currentPage = 0, readerMode = state.mode;
let filter = '全部', query = '', sort = 'newest', listMode = false, observer, toastTimer, renderTimer, returnRoute = 'discover';
let storageWarning = false, nextCursor = null, listRequest = 0, readerRequest = 0, isLoading = false, listError = '';
async function requestJSON(path) {
  const response = await fetch(path,{cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试');
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
function route() { const value = location.hash.slice(1).split('/')[0]; return names[value] ? value : 'discover'; }
function favorite(id) {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter(value => value !== id) : [...state.favorites, id]; save();
  document.querySelectorAll(`[data-favorite="${CSS.escape(id)}"]`).forEach(button => { button.textContent = state.favorites.includes(id) ? '♥' : '♡'; button.setAttribute('aria-pressed', String(state.favorites.includes(id))); });
  if (activeGallery?.id === id) updateReaderFavorite();
  if (route() === 'favorites' && !activeGallery) render();
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
  let items = galleries.filter(g => (route() !== 'favorites' || state.favorites.includes(g.id)) && (route() !== 'history' || state.progress[g.id]));
  if (filter !== '全部') items = items.filter(g => g.tags.includes(filter));
  const q = query.trim().toLowerCase();
  if (q && ['favorites','history'].includes(route())) items = items.filter(g => [g.title,g.creator,...g.tags].join(' ').toLowerCase().includes(q));
  return items.sort((a,b) => route() === 'history' ? (state.progress[b.id]?.time || 0) - (state.progress[a.id]?.time || 0) : sort === 'title' ? a.title.localeCompare(b.title,'zh-CN') : sort === 'pages' ? pageCount(b) - pageCount(a) : b.date.localeCompare(a.date));
}
function renderResults() {
  if (!$('#gallery-grid')) return;
  const items = filtered(); $('#result-count').textContent = isLoading ? '正在请求源站…' : `${items.length} 本图集`;
  $('#gallery-grid').className = `grid ${listMode ? 'list-mode' : ''}`;
  const emptyMessages = {favorites:['还没有收藏','点击图集右上角的爱心，把喜欢的作品留在这里。'], history:['还没有阅读足迹','打开一本图集开始阅读，之后可以从上次的位置继续。']};
  const [title, message] = query || filter !== '全部' ? ['没有找到匹配图集','试试其他关键词，或切换为「全部」。'] : emptyMessages[route()] || ['暂无可阅读图集','稍后重试，或搜索你感兴趣的作品。'];
  $('#gallery-grid').innerHTML = items.length ? items.map(card).join('') : isLoading ? '<div class="loading">正在获取实时图集…</div>' : listError ? '' : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${icons[route()]}</div><h3>${title}</h3><p>${message}</p></div>`;
  $('#list-status').innerHTML = listError ? `<div class="empty"><p role="alert">${escape(listError)}</p><button class="outline-button" data-action="retry-list">重新加载</button></div>` : nextCursor ? `<button class="outline-button" data-action="load-more" ${isLoading ? 'disabled' : ''}>${isLoading ? '正在加载…' : '加载更多'}</button>` : '';
}
function renderHero() {
  const hero = galleries[0];
  $('#hero').innerHTML = route() === 'discover' && hero ? `<section class="hero"><div class="hero-copy"><span class="hero-tag">✧ 实时发现 · E-HENTAI</span><h2>翻开新的世界<br>发现此刻的灵感</h2><p>从喜欢的作品出发，<br>收藏每一次新的相遇。</p><button class="primary-button" data-open="${escape(hero.id)}">翻开图集 <span>↗</span></button></div><img class="hero-art" src="${escape(imageFor(hero))}" alt="${escape(hero.title)}"><span class="hero-edition">YOUR GALLERY READER</span></section>` : '';
  const tags = [...new Set(galleries.flatMap(g => g.tags))].slice(0,5);
  $('#tag-filters').innerHTML = ['全部',...tags].map(tag => `<button class="chip ${filter === tag ? 'active' : ''}" data-tag="${escape(tag)}" aria-pressed="${filter === tag}">${escape(tag)}</button>`).join('');
}
function render() {
  nav(); const view = route(), titles = {discover:['每一次翻阅，都是新的发现。','实时浏览图集，挑一本慢慢翻阅。'], favorites:['收藏你的心动瞬间。','喜欢的作品，在这里重逢。'], history:['从上次停下的地方，继续。','每一段阅读，都值得被记住。'], library:['属于你的，图像世界。','搜索源站图集，寻找下一次灵感。']};
  $('#main').innerHTML = `<div class="heading-row"><div><div class="eyebrow">${view === 'discover' ? 'A QUIET SPACE FOR YOUR INSPIRATION' : 'YOUR PERSONAL COLLECTION'}</div><h1>${titles[view][0]}</h1><p class="intro">${titles[view][1]}</p></div><span class="date-note">A little escape, a new perspective.</span></div><div id="hero"></div><section aria-label="图集列表"><div class="section-heading"><h2>${view === 'discover' ? '最新图集' : names[view]}<small id="result-count"></small></h2><div class="view-options"><select id="sort" aria-label="图集排序"><option value="newest">最近更新</option><option value="title">名称排序</option><option value="pages">页数最多</option></select><button data-action="view" class="icon-button" aria-label="切换列表布局" aria-pressed="${listMode}">${listMode ? '▦' : '☷'}</button></div></div><div class="toolbar"><div id="tag-filters" class="chips"></div><label class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="${['favorites','history'].includes(view) ? '搜索当前列表' : '搜索 E-Hentai 图集或粘贴图集链接'}" value="${escape(query)}" aria-label="搜索图集"></label></div><div id="gallery-grid" class="grid"></div><div id="list-status" class="list-status"></div></section><div class="content-notice">图集与图片实时从 E-Hentai 获取。收藏、阅读进度与设置仅保存在当前设备。</div>`;
  $('#sort').value = sort; renderHero(); renderResults();
}
async function loadGalleries(append=false) {
  const request = ++listRequest, view = route(), cursor = append ? nextCursor : null;
  isLoading = true; listError = '';
  if (!append) { galleries = []; nextCursor = null; renderHero(); }
  renderResults();
  try {
    let data;
    if (['favorites','history'].includes(view)) {
      const ids = (view === 'favorites' ? state.favorites : Object.keys(state.progress)).filter(id => id.includes('/'));
      data = {galleries:await metadata(ids.map(id => { const [gid,token] = id.split('/'); return [Number(gid),token]; })),next:null};
    } else {
      const match = query.trim().match(/^https:\/\/e-hentai\.org\/g\/(\d+)\/([a-f0-9]+)\/?$/);
      if (match) data = {galleries:[await getGallery(match[1],match[2])],next:null};
      else {
        const listing = await requestJSON(`/api/galleries?${new URLSearchParams({q:query,next:cursor || ''})}`);
        data = {galleries:await metadata(listing.ids),next:listing.next};
      }
    }
    if (request !== listRequest) return;
    data.galleries.forEach(g => knownGalleries.set(g.id,g));
    galleries = append ? [...new Map([...galleries,...data.galleries].map(g => [g.id,g])).values()] : data.galleries;
    nextCursor = data.next; renderHero();
  } catch (error) { if (request === listRequest) listError = error.message; }
  finally { if (request === listRequest) { isLoading = false; renderResults(); } }
}
function detail(id) {
  const g = knownGalleries.get(id); if (!g) return;
  $('#detail-body').innerHTML = `<div class="dialog-header"><h2>图集详情</h2><button class="icon-button" data-action="close-detail" aria-label="关闭详情">✕</button></div><div class="detail-layout"><img class="detail-cover" src="${escape(imageFor(g))}" alt="${escape(g.title)}"><div class="detail-info"><span class="eyebrow">E-HENTAI / ${escape(g.category)}</span><h2>${escape(g.title)}</h2><div class="card-tags">${g.tags.map(tag => `<button class="chip" data-tag="${escape(tag)}">${escape(tag)}</button>`).join('')}</div><p>${escape(g.description)}</p><div class="detail-meta">上传者 / ${escape(g.creator)}<br>页数 / ${pageCount(g)} P<br>来源 / E-Hentai<br>更新 / ${escape(g.date)}${state.progress[g.id] ? `<br>上次读到 / 第 ${progressFor(g)+1} 页` : ''}</div></div><div class="detail-actions"><button class="primary-button" data-read="${escape(g.id)}">${state.progress[g.id] ? '继续阅读' : '开始阅读'} <span>→</span></button><button class="outline-button" data-favorite="${escape(g.id)}" aria-pressed="${state.favorites.includes(g.id)}">${state.favorites.includes(g.id) ? '♥ 已收藏' : '♡ 收藏图集'}</button></div></div>`;
  $('#detail-dialog').showModal();
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
    requestAnimationFrame(() => { const img = content.querySelector(`[data-page="${currentPage}"]`); content.scrollTop = img.offsetTop; });
  } else {
    content.scrollTop = 0;
  }
  $('[data-action=reader-mode]').textContent = readerMode === 'paged' ? '▤' : '▣';
  $('[data-action=reader-mode]').setAttribute('aria-label', readerMode === 'paged' ? '切换纵向滚动' : '切换逐页翻阅');
  record();
}
async function openReader(id) {
  const request = ++readerRequest;
  ++listRequest; clearTimeout(renderTimer);
  $('#detail-dialog').close(); $('#settings-dialog').close();
  $('#main').innerHTML = '<div class="loading">正在获取图集…</div>';
  try {
    const [gid,token] = id.split('/');
    const g = await getGallery(gid,token);
    if (request !== readerRequest || location.hash !== `#read/${id}`) return;
    knownGalleries.set(g.id,g);
    activeGallery = g; currentPage = progressFor(g); readerMode = state.mode;
    $('#reader').hidden = false; document.body.classList.add('reading'); $('.shell').inert = true; $('.sidebar').inert = true; $('.bottom-nav').inert = true;
    $('#reader-title').textContent = g.title; $('#reader-source').textContent = `E-Hentai · ${g.category}`;
    $('#page-slider').max = String(g.pages.length); updateReaderFavorite(); renderReader(); $('[data-action=exit-reader]').focus();
  } catch (error) {
    if (request !== readerRequest || location.hash !== `#read/${id}`) return;
    $('#main').innerHTML = `<div class="empty"><h3>图集暂时无法加载</h3><p role="alert">${escape(error.message)}</p><button class="primary-button" data-action="retry-reader">重新加载</button><button class="outline-button" data-action="exit-reader">返回图集</button></div>`;
  }
}
function exitReader() {
  record(); observer?.disconnect(); activeGallery = null; $('#reader').hidden = true; document.body.classList.remove('reading'); $('.shell').inert = false; $('.sidebar').inert = false; $('.bottom-nav').inert = false; $('#reader-content').replaceChildren(); render(); $('#main').focus({preventScroll:true});
}
function goPage(page) {
  if (!activeGallery) return; currentPage = Math.max(0,Math.min(activeGallery.pages.length - 1,page));
  if (readerMode === 'scroll') { const img = $('#reader-content').querySelector(`[data-page="${currentPage}"]`); $('#reader-content').scrollTo({top:img.offsetTop,behavior:'instant'}); record(); }
  else renderReader();
}
function settings() {
  $('#mode-setting').value = state.mode; $('#direction-setting').value = state.direction; $('#theme-setting').value = state.theme;
  $('#source-info').textContent = '搜索、图集信息和阅读图片均实时从 E-Hentai 获取。收藏和历史记录重新打开时会请求最新图集信息；离线时只能打开应用界面。';
  $('#settings-dialog').showModal();
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.open) return detail(button.dataset.open);
  if (button.dataset.favorite) return favorite(button.dataset.favorite);
  if (button.dataset.read) { returnRoute = route(); location.hash = `read/${button.dataset.read}`; return; }
  if (button.dataset.tag) { filter = button.dataset.tag; $('#detail-dialog').close(); renderHero(); renderResults(); return; }
  const actions = {
    'load-more':() => loadGalleries(true), 'retry-list':() => loadGalleries(), 'retry-reader':() => openReader(location.hash.slice(6)),
    theme:() => { state.theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'; save(); theme(); },
    settings, 'close-settings':() => $('#settings-dialog').close(), 'close-detail':() => $('#detail-dialog').close(),
    'exit-reader':() => { location.hash = returnRoute; }, 'reader-mode':() => { readerMode = readerMode === 'paged' ? 'scroll' : 'paged'; state.mode = readerMode; save(); renderReader(); },
    'reader-favorite':() => favorite(activeGallery.id), prev:() => goPage(currentPage - 1), next:() => goPage(currentPage + 1),
    view:() => { listMode = !listMode; render(); }, 'clear-history':() => { if (confirm('清除这台设备上的全部阅读记录？收藏会保留。')) { state.progress = {}; save(); render(); toast('已清除阅读记录'); } }
  }; actions[button.dataset.action]?.();
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; filter = '全部'; clearTimeout(renderTimer);
    if (['favorites','history'].includes(route())) renderResults();
    else { ++listRequest; renderTimer = setTimeout(() => loadGalleries(),450); } }
  if (event.target.id === 'page-slider') goPage(Number(event.target.value)-1);
});
document.addEventListener('change', event => {
  const id = event.target.id;
  if (id === 'sort') { sort = event.target.value; renderResults(); }
  if (['mode-setting','direction-setting','theme-setting'].includes(id)) { state[id.split('-')[0]] = event.target.value; save(); theme(); }
});
document.addEventListener('keydown', event => {
  if (!activeGallery) return;
  if (event.key === 'Escape') { event.preventDefault(); location.hash = returnRoute; }
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
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#read/')) openReader(location.hash.slice(6));
  else { ++readerRequest; clearTimeout(renderTimer); if (activeGallery) exitReader(); filter = '全部'; query = ''; render(); loadGalleries(); window.scrollTo(0,0); }
});
function connectivity() { $('#network').textContent = navigator.onLine ? '实时图集' : '网络已断开'; $('#network').classList.toggle('offline',!navigator.onLine); }
window.addEventListener('online',connectivity); window.addEventListener('offline',connectivity); connectivity();
window.addEventListener('pagehide', record);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') record(); });
async function boot() {
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (location.hash.startsWith('#read/')) await openReader(location.hash.slice(6));
  else await loadGalleries();
}
boot();

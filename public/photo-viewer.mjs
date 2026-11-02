import {icon} from './icons.mjs';
import {ReaderPreloader,preloadNeighbors} from './reader-preload.mjs';
import {PhotoGestures} from './photo-gestures.mjs';
import {ThumbnailView} from './photo-thumbnails.mjs';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class PhotoViewer {
  constructor(root,callbacks) {
    this.root=root;this.callbacks=callbacks;this.index=0;this.gallery=null;
    root.innerHTML=`<header class="photo-header viewer-header"><button class="photo-back icon-button" data-photo-action="back" aria-label="返回图册" title="返回图册">${icon('back')}</button><div class="viewer-heading"><b class="photo-title viewer-title"></b></div><button class="photo-reading icon-button" data-photo-action="continuous" aria-label="切换连续模式" title="切换连续模式">${icon('list')}</button></header><div class="photo-track" tabindex="0" aria-label="照片，左右滑动翻页，双击或双指缩放"></div><footer class="photo-footer"><div class="photo-strip" aria-label="照片缩略图"></div><div class="photo-pagination"><span class="photo-count" role="status" aria-label="阅读页码"></span><button class="photo-original" data-photo-action="original" hidden></button></div></footer><span class="photo-dismiss-hint">轻点退出全屏 · 双击缩放 · 下滑返回图集</span>`;
    this.originals=new Map();this.originalButton=root.querySelector('.photo-original');
    this.track=root.querySelector('.photo-track');this.strip=root.querySelector('.photo-strip');this.gestures=new PhotoGestures(this);
    root.addEventListener('click',event=>{
      const thumbnail=event.target.closest('[data-photo-index]');
      if (thumbnail) return this.go(Number(thumbnail.dataset.photoIndex));
      const action=event.target.closest('[data-photo-action]')?.dataset.photoAction;
      if(action==='continuous')return callbacks.continuous();
      if(action==='back')return callbacks.back();
      if(action==='retry')return callbacks.retry();
      if(action==='original')return this.loadOriginal();
      const retry=event.target.closest('[data-photo-retry]');
      if(retry){const image=this.track.querySelector(`[data-photo-image="${retry.dataset.photoRetry}"]`);const url=new URL(image.dataset.src,location.origin);url.searchParams.set('retry',String(Date.now()));image.src=url.href;retry.remove();return;}
      if(event.target.closest('.photo-slide'))this.gestures.click(event);
    });
    this.track.addEventListener('scroll',()=>{
      this.ignoreClickUntil=Date.now()+180;
      cancelAnimationFrame(this.frame);
      this.frame=requestAnimationFrame(()=>{
        if (!this.gallery || this.resizing || this.gestures.drag || this.gestures.pointers.size) return;
        if (this.target!==null) {
          if(Math.abs(this.track.scrollLeft-this.target*this.track.clientWidth)<2)this.target=null;
          else return;
        }
        this.select(Math.max(0,Math.min(this.gallery.pages.length-1,Math.round(this.track.scrollLeft/this.track.clientWidth))));
      });
    },{passive:true});
    this.track.addEventListener('scrollend',()=>{this.target=null;});
    root.addEventListener('keydown',event=>{
      if(!this.gallery)return;
      if(event.key==='Escape'){event.preventDefault();callbacks.back();}
      if(event.key==='ArrowRight'){event.preventDefault();this.go(this.index+1);}
      if(event.key==='ArrowLeft'){event.preventDefault();this.go(this.index-1);}
    });
    this.resize=new ResizeObserver(()=>{
      if(!this.gallery)return;
      this.gestures.reset();this.resizing=true;this.track.scrollTo({left:this.index*this.track.clientWidth,behavior:'instant'});
      requestAnimationFrame(()=>{this.resizing=false;});
    });this.resize.observe(this.track);
  }
  loading(immersive=false) {this.hide();this.root.hidden=false;this.root.classList.toggle('immersive',immersive);this.root.querySelector('.photo-title').textContent='照片';this.root.querySelector('.photo-count').textContent='';this.track.innerHTML='<div class="loading" role="status">正在打开照片…</div>';this.track.focus({preventScroll:true});}
  error(message) {this.track.innerHTML=`<div class="photo-error"><p>${escape(message)}</p><button class="outline-button" data-photo-action="retry">重试</button></div>`;}
  show(gallery,index,store,immersive=false) {
    const same=this.gallery?.id===gallery.id && !this.root.hidden;
    if(!same){
      this.hide();this.gallery=gallery;this.root.hidden=false;this.target=null;
      this.track.innerHTML=gallery.pages.map((page,index)=>`<div class="photo-slide" data-photo-slide="${index}"><span aria-hidden="true">${index+1}</span><img data-photo-image="${index}" data-src="${escape(page.src)}" alt="${escape(page.alt)}" decoding="async" draggable="false"></div>`).join('');
      this.strip.innerHTML=gallery.pages.map((_,index)=>`<button class="photo-film" data-photo-index="${index}" aria-label="查看第 ${index+1} 张照片"><span class="photo-thumb" data-thumb="${index}"></span></button>`).join('');
      this.track.querySelectorAll('img').forEach(image=>{
        image.onload=()=>{image.parentElement.dataset.loaded='true';delete image.parentElement.dataset.failed;image.parentElement.querySelector('.photo-image-retry')?.remove();this.preloader?.markLoaded(Number(image.dataset.photoImage),{width:image.naturalWidth,height:image.naturalHeight});};
        image.onerror=()=>{image.parentElement.dataset.failed='true';if(image.parentElement.querySelector('.photo-image-retry'))return;const button=document.createElement('button');button.className='photo-image-retry';button.dataset.photoRetry=image.dataset.photoImage;button.textContent='图片加载失败，轻点重试';image.parentElement.append(button);};
      });
      this.preloader=new ReaderPreloader(gallery.pages.length,(index,signal)=>new Promise((resolve,reject)=>{
        const image=new Image();image.fetchPriority='low';image.decoding='async';
        const cleanup=()=>{image.onload=null;image.onerror=null;signal.removeEventListener('abort',abort);};
        const abort=()=>{cleanup();image.removeAttribute('src');reject(new DOMException('Viewer closed','AbortError'));};
        image.onload=()=>{const dimensions={width:image.naturalWidth,height:image.naturalHeight};cleanup();resolve(dimensions);};
        image.onerror=()=>{cleanup();reject(new Error('Preload failed'));};
        if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});image.src=gallery.pages[index].src;
      }),index=>{if(this.gallery===gallery&&Math.abs(index-this.index)<=5)this.activate(index);});
      this.thumbnails=new ThumbnailView(this.strip,this.strip,store);
    }
    if(this.immersive!==immersive)this.gestures.reset();
    this.root.classList.toggle('immersive',immersive);this.immersive=immersive;this.target=null;
    this.root.querySelector('.photo-title').textContent=gallery.title;
    const nextIndex=Math.max(0,Math.min(gallery.pages.length-1,index));
    if(this.index!==nextIndex)this.gestures.reset();
    this.index=nextIndex;
    this.track.scrollTo({left:this.index*this.track.clientWidth,behavior:'instant'});
    this.select(this.index,true);this.track.focus({preventScroll:true});
  }
  activate(index) {
    const image=this.track.querySelector(`[data-photo-image="${index}"]`);
    if(image&&!image.hasAttribute('src')){image.fetchPriority=index===this.index?'high':'low';image.src=image.dataset.src;}
  }
  select(index,force=false) {
    if(!this.gallery || index===this.index&&!force)return;
    if(index!==this.index)this.gestures.reset();
    this.index=index;this.activate(index);
    for(const page of preloadNeighbors(index,this.gallery.pages.length))if(this.preloader.loaded.has(page))this.activate(page);
    this.preloader.update(index);
    this.root.querySelector('.photo-count').textContent=`${index+1} / ${this.gallery.pages.length} P`;
    this.paintOriginal();
    const selected=this.strip.children[index];
    const previous=this.strip.querySelector('[aria-current="true"]');
    if(previous && previous!==selected)previous.setAttribute('aria-current','false');
    selected.setAttribute('aria-current','true');
    this.strip.scrollTo({left:selected.offsetLeft-(this.strip.clientWidth-selected.offsetWidth)/2,behavior:force?'instant':'smooth'});
    this.callbacks.change(this.gallery,index);
  }
  paintOriginal() {
    const state=this.originals.get(this.index),busy=state?.status==='loading',ready=state?.status==='ready';
    this.originalButton.hidden=!this.gallery;
    this.originalButton.disabled=busy||ready;
    this.originalButton.setAttribute('aria-busy',String(busy));
    this.originalButton.setAttribute('aria-label',ready?'已显示原图，可长按图片保存':busy?'正在加载原图':'查看原图');
    this.originalButton.title=ready?'长按图片可保存原图':'仅加载可确认免积分的原图，仍可能消耗图片访问配额';
    this.originalButton.innerHTML=(busy?'<span class="loading-spinner" aria-hidden="true"></span>':icon('image'))+`<span>${ready?'已是原图':busy?'加载中':'查看原图'}</span>`;
  }
  async loadOriginal() {
    const gallery=this.gallery,index=this.index;
    if(!gallery||this.originals.has(index))return;
    const controller=new AbortController(),state={status:'loading',controller};
    this.originals.set(index,state);this.paintOriginal();this.track.focus({preventScroll:true});
    const timeout=setTimeout(()=>controller.abort(),120000);
    const current=()=>this.gallery===gallery&&this.originals.get(index)===state;
    try {
      const {src}=await this.callbacks.original(gallery,index,controller.signal);
      if(!current()||controller.signal.aborted)return;
      const url=new URL(src);
      if(url.protocol!=='https:')throw new Error('原图地址无效');
      const preview=new Image();preview.referrerPolicy='no-referrer';preview.fetchPriority='high';
      await new Promise((resolve,reject)=>{
        const cleanup=()=>{preview.onload=null;preview.onerror=null;controller.signal.removeEventListener('abort',abort);};
        const abort=()=>{cleanup();preview.removeAttribute('src');reject(new DOMException('Original image cancelled','AbortError'));};
        preview.onload=()=>{cleanup();resolve();};
        preview.onerror=()=>{cleanup();reject(new Error('原图加载失败，请重试'));};
        controller.signal.addEventListener('abort',abort,{once:true});
        if(controller.signal.aborted)return abort();
        preview.src=url.href;
      });
      if(!current())return;
      const image=this.track.querySelector(`[data-photo-image="${index}"]`);
      image.referrerPolicy='no-referrer';image.src=url.href;image.dataset.original='true';state.status='ready';
      if(this.index===index){this.paintOriginal();this.callbacks.notify?.('已切换原图，长按图片可保存');}
    } catch(error) {
      if(!current())return;
      this.originals.delete(index);
      if(this.index===index){this.paintOriginal();this.callbacks.notify?.(error.name==='AbortError'?'原图加载超时，请重试':error.message);}
    } finally {clearTimeout(timeout);}
  }
  go(index) {
    if(!this.gallery)return;
    index=Math.max(0,Math.min(this.gallery.pages.length-1,index));this.target=index;
    this.select(index);this.track.scrollTo({left:index*this.track.clientWidth,behavior:'smooth'});
  }
  resetDrag() {
    if(!this.track.style.transform)return;
    this.track.style.transition='transform .22s ease';this.track.style.transform='';
  }
  hide() {
    const originals=this.originals;this.originals=new Map();
    for(const state of originals.values())state.controller.abort();
    this.originalButton.hidden=true;
    this.gestures.close();
    this.preloader?.close();this.preloader=null;this.thumbnails?.close();this.thumbnails=null;
    cancelAnimationFrame(this.frame);this.gallery=null;this.root.hidden=true;this.track.style.transform='';this.track.style.transition='';this.track.replaceChildren();this.strip.replaceChildren();
  }
}

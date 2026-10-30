import {ReaderPreloader,preloadNeighbors} from './reader-preload.mjs';
import {ThumbnailView} from './photo-thumbnails.mjs';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class PhotoViewer {
  constructor(root,callbacks) {
    this.root=root;this.callbacks=callbacks;this.index=0;this.gallery=null;
    root.innerHTML='<header class="photo-header"><button class="photo-back" data-photo-action="back" aria-label="返回图集">‹</button><div><b class="photo-title"></b><small class="photo-count"></small></div><button class="photo-reading" data-photo-action="continuous" aria-label="切换上下连续阅读">连续</button><button class="photo-expand" data-photo-action="fullscreen" aria-label="全屏查看">⛶</button></header><div class="photo-track" tabindex="0" aria-label="照片，左右滑动翻页"></div><footer class="photo-footer"><div class="photo-strip" aria-label="照片缩略图"></div></footer><span class="photo-dismiss-hint">轻点或向下滑动退出全屏</span>';
    this.track=root.querySelector('.photo-track');this.strip=root.querySelector('.photo-strip');
    root.addEventListener('click',event=>{
      const thumbnail=event.target.closest('[data-photo-index]');
      if (thumbnail) return this.go(Number(thumbnail.dataset.photoIndex));
      const action=event.target.closest('[data-photo-action]')?.dataset.photoAction;
      if(action==='continuous')return callbacks.continuous();
      if(action==='back')return callbacks.back();
      if(action==='fullscreen')return callbacks.fullscreen();
      if(action==='retry')return callbacks.retry();
      const retry=event.target.closest('[data-photo-retry]');
      if(retry){const image=this.track.querySelector(`[data-photo-image="${retry.dataset.photoRetry}"]`);const url=new URL(image.dataset.src,location.origin);url.searchParams.set('retry',String(Date.now()));image.src=url.href;retry.remove();return;}
      if(event.target.closest('.photo-slide') && Date.now()>(this.ignoreClickUntil || 0))callbacks.fullscreen();
    });
    this.track.addEventListener('scroll',()=>{
      this.ignoreClickUntil=Date.now()+180;
      cancelAnimationFrame(this.frame);
      this.frame=requestAnimationFrame(()=>{
        if (!this.gallery || this.resizing) return;
        if (this.target!==null) {
          if(Math.abs(this.track.scrollLeft-this.target*this.track.clientWidth)<2)this.target=null;
          else return;
        }
        this.select(Math.max(0,Math.min(this.gallery.pages.length-1,Math.round(this.track.scrollLeft/this.track.clientWidth))));
      });
    },{passive:true});
    this.track.addEventListener('scrollend',()=>{this.target=null;});
    this.track.addEventListener('pointerdown',event=>{
      this.target=null;this.drag={x:event.clientX,y:event.clientY,left:this.track.scrollLeft,type:event.pointerType};
      if(event.pointerType==='mouse')this.track.style.scrollBehavior='auto';
    });
    this.track.addEventListener('pointermove',event=>{
      if(this.drag && this.immersive){
        const dx=event.clientX-this.drag.x,dy=event.clientY-this.drag.y;
        if(dy>5 && dy>Math.abs(dx)*1.3 && (window.visualViewport?.scale || 1)<=1.05){
          this.track.style.transition='none';this.track.style.transform=`translateY(${dy}px) scale(${Math.max(.82,1-dy/(this.root.clientHeight*3))})`;return;
        }
      }
      if(this.drag?.type==='mouse' && Math.abs(event.clientX-this.drag.x)>5){this.track.setPointerCapture(event.pointerId);this.ignoreClickUntil=Date.now()+250;this.track.scrollLeft=this.drag.left-(event.clientX-this.drag.x);}
    });
    this.track.addEventListener('pointerup',event=>{
      if(!this.drag)return;
      const {x,y,type}=this.drag,dx=event.clientX-x,dy=event.clientY-y;this.drag=null;
      this.track.style.scrollBehavior='';
      this.resetDrag();
      if(Math.abs(dx)>10 || Math.abs(dy)>10)this.ignoreClickUntil=Date.now()+250;
      if(this.immersive && dy>80 && dy>Math.abs(dx)*1.3 && (window.visualViewport?.scale || 1)<=1.05)return callbacks.back();
      if(type==='mouse' && Math.abs(dx)>5)this.go(Math.round(this.track.scrollLeft/this.track.clientWidth));
    });
    this.track.addEventListener('pointercancel',()=>{this.drag=null;this.track.style.scrollBehavior='';this.resetDrag();});
    root.addEventListener('keydown',event=>{
      if(!this.gallery)return;
      if(event.key==='Escape'){event.preventDefault();callbacks.back();}
      if(event.key==='ArrowRight'){event.preventDefault();this.go(this.index+1);}
      if(event.key==='ArrowLeft'){event.preventDefault();this.go(this.index-1);}
    });
    this.resize=new ResizeObserver(()=>{
      if(!this.gallery)return;
      this.resizing=true;this.track.scrollTo({left:this.index*this.track.clientWidth,behavior:'instant'});
      requestAnimationFrame(()=>{this.resizing=false;});
    });this.resize.observe(this.track);
  }
  loading() {this.hide();this.root.hidden=false;this.root.classList.remove('immersive');this.root.querySelector('.photo-title').textContent='照片';this.root.querySelector('.photo-count').textContent='';this.track.innerHTML='<div class="loading">正在打开照片…</div>';}
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
    this.root.classList.toggle('immersive',immersive);this.immersive=immersive;this.target=null;
    this.root.querySelector('.photo-title').textContent=gallery.title;
    this.index=Math.max(0,Math.min(gallery.pages.length-1,index));
    this.track.scrollTo({left:this.index*this.track.clientWidth,behavior:'instant'});
    this.select(this.index,true);this.track.focus({preventScroll:true});
  }
  activate(index) {
    const image=this.track.querySelector(`[data-photo-image="${index}"]`);
    if(image&&!image.hasAttribute('src')){image.fetchPriority=index===this.index?'high':'low';image.src=image.dataset.src;}
  }
  select(index,force=false) {
    if(!this.gallery || index===this.index&&!force)return;
    this.index=index;this.activate(index);
    for(const page of preloadNeighbors(index,this.gallery.pages.length))if(this.preloader.loaded.has(page))this.activate(page);
    this.preloader.update(index);
    this.root.querySelector('.photo-count').textContent=`${index+1} / ${this.gallery.pages.length}`;
    const selected=this.strip.children[index];
    const previous=this.strip.querySelector('[aria-current="true"]');
    if(previous && previous!==selected)previous.setAttribute('aria-current','false');
    selected.setAttribute('aria-current','true');
    this.strip.scrollTo({left:selected.offsetLeft-(this.strip.clientWidth-selected.offsetWidth)/2,behavior:force?'instant':'smooth'});
    this.callbacks.change(this.gallery,index);
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
    this.preloader?.close();this.preloader=null;this.thumbnails?.close();this.thumbnails=null;
    cancelAnimationFrame(this.frame);this.gallery=null;this.root.hidden=true;this.track.style.transform='';this.track.style.transition='';this.track.replaceChildren();this.strip.replaceChildren();
  }
}

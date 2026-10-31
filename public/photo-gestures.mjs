export function clampPhoto(scale,x,y,{width,height,imageWidth,imageHeight}) {
  scale=Math.max(1,Math.min(4,scale));
  const fit=Math.min(width/(imageWidth||width),height/(imageHeight||height));
  const limitX=Math.max(0,((imageWidth||width)*fit*scale-width)/2),limitY=Math.max(0,((imageHeight||height)*fit*scale-height)/2);
  return {scale,x:Math.max(-limitX,Math.min(limitX,x))||0,y:Math.max(-limitY,Math.min(limitY,y))||0};
}
export function zoomAt(view,scale,point,geometry) {
  scale=Math.max(1,Math.min(4,scale));
  const ratio=scale/view.scale;
  return clampPhoto(scale,point.x-(point.x-view.x)*ratio,point.y-(point.y-view.y)*ratio,geometry);
}

export class PhotoGestures {
  constructor(viewer) {
    this.viewer=viewer;this.track=viewer.track;this.pointers=new Map();this.view={scale:1,x:0,y:0};
    this.track.addEventListener('pointerdown',event=>this.down(event));
    this.track.addEventListener('pointermove',event=>this.move(event));
    this.track.addEventListener('pointerup',event=>this.up(event));
    this.track.addEventListener('pointercancel',()=>this.cancel());
    this.track.addEventListener('dblclick',event=>event.preventDefault());
    const viewport=window.visualViewport,syncViewport=()=>{this.track.style.touchAction=(viewport?.scale||1)>1.05?'pan-x pinch-zoom':'';if((viewport?.scale||1)>1.05)this.cancel();};
    viewport?.addEventListener('resize',syncViewport);syncViewport();
  }
  geometry() {
    const image=this.image(),box=this.track.getBoundingClientRect();
    return {width:box.width,height:box.height,imageWidth:image?.naturalWidth||box.width,imageHeight:image?.naturalHeight||box.height};
  }
  image(){return this.track.querySelector(`[data-photo-image="${this.viewer.index}"]`);}
  point(x,y){const box=this.track.getBoundingClientRect();return {x:x-box.left-box.width/2,y:y-box.top-box.height/2};}
  apply(view,animate=false) {
    this.view=clampPhoto(view.scale,view.x,view.y,this.geometry());
    const image=this.image();if(image){image.style.transition=animate?'transform .2s ease':'';image.style.willChange=this.view.scale>1.01?'transform':'';image.style.transform=this.view.scale===1?'':`translate3d(${this.view.x}px,${this.view.y}px,0) scale(${this.view.scale})`;}
    this.track.classList.toggle('photo-zoomed',this.view.scale>1.01);
    this.viewer.root.dataset.zoom=String(this.view.scale);
    this.viewer.root.querySelector('.photo-dismiss-hint').textContent=this.view.scale>1.01?'双击复原 · 双指缩放 · 拖动查看':this.viewer.returnHint||'轻点退出全屏 · 双击缩放 · 下滑返回图集';
  }
  reset() {
    clearTimeout(this.tapTimer);this.tapTimer=null;this.lastTap=null;
    this.track.querySelectorAll('[data-photo-image]').forEach(image=>{image.style.transform='';image.style.transition='';image.style.willChange='';});
    this.view={scale:1,x:0,y:0};this.track.classList.remove('photo-zoomed');this.viewer.root.dataset.zoom='1';
    this.viewer.root.querySelector('.photo-dismiss-hint').textContent=this.viewer.returnHint||'轻点退出全屏 · 双击缩放 · 下滑返回图集';
  }
  tap(event,intentional=false) {
    if(!this.viewer.gallery||(window.visualViewport?.scale||1)>1.05||!intentional&&Date.now()<(this.viewer.ignoreClickUntil||0))return;
    const now=Date.now(),point=this.point(event.clientX,event.clientY);
    if(this.lastTap&&now-this.lastTap.time<300&&Math.hypot(event.clientX-this.lastTap.x,event.clientY-this.lastTap.y)<35){
      clearTimeout(this.tapTimer);this.tapTimer=null;this.lastTap=null;
      this.apply(this.view.scale>1.01?{scale:1,x:0,y:0}:zoomAt(this.view,3,point,this.geometry()),true);return;
    }
    clearTimeout(this.tapTimer);this.lastTap={time:now,x:event.clientX,y:event.clientY};
    const gallery=this.viewer.gallery,index=this.viewer.index;
    this.tapTimer=setTimeout(()=>{this.tapTimer=null;this.lastTap=null;if(this.viewer.gallery===gallery&&this.viewer.index===index&&this.view.scale<=1.01)this.viewer.callbacks.fullscreen();},300);
  }
  click(event){if(Date.now()>(this.ignoreNativeClickUntil||0))this.tap(event);}
  down(event) {
    if(!this.viewer.gallery||event.target.closest('button')||event.button>0)return;
    if((window.visualViewport?.scale||1)>1.05)return;
    this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    this.track.setPointerCapture(event.pointerId);
    if(this.pointers.size===2){
      clearTimeout(this.tapTimer);this.lastTap=null;this.multitouch=true;this.drag=null;
      this.viewer.ignoreClickUntil=Date.now()+500;this.viewer.resetDrag();
      const [a,b]=[...this.pointers.values()];
      this.pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),point:this.point((a.x+b.x)/2,(a.y+b.y)/2),view:{...this.view}};
      this.track.scrollLeft=this.viewer.index*this.track.clientWidth;return;
    }
    if(this.pointers.size!==1||this.multitouch)return;
    this.viewer.target=null;
    this.drag={x:event.clientX,y:event.clientY,left:this.track.scrollLeft,view:{...this.view},time:performance.now(),mode:this.view.scale>1.01?'pan':null};
  }
  move(event) {
    if(!this.pointers.has(event.pointerId))return;
    this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(this.pinch&&this.pointers.size>=2){
      const [a,b]=[...this.pointers.values()],point=this.point((a.x+b.x)/2,(a.y+b.y)/2),start=this.pinch;
      const scale=Math.max(1,Math.min(4,start.view.scale*Math.hypot(a.x-b.x,a.y-b.y)/start.distance)),ratio=scale/start.view.scale;
      this.apply({scale,x:point.x-(start.point.x-start.view.x)*ratio,y:point.y-(start.point.y-start.view.y)*ratio});return;
    }
    const drag=this.drag;if(!drag||this.multitouch)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.mode&&Math.hypot(dx,dy)>8)drag.mode=Math.abs(dx)>=Math.abs(dy)?'page':'dismiss';
    if(!drag.mode)return;
    if(Math.hypot(dx,dy)>8){this.viewer.ignoreClickUntil=Date.now()+500;clearTimeout(this.tapTimer);this.lastTap=null;}
    if(drag.mode==='pan')this.apply({...drag.view,x:drag.view.x+dx,y:drag.view.y+dy});
    if(drag.mode==='page'){
      this.track.style.scrollSnapType='none';this.track.style.scrollBehavior='auto';
      this.track.scrollLeft=drag.left-dx;
    }
    if(drag.mode==='dismiss'&&dy>0){this.track.style.transition='none';this.track.style.transform=`translateY(${dy}px) scale(${Math.max(.82,1-dy/(this.viewer.root.clientHeight*3))})`;}
  }
  up(event) {
    if(!this.pointers.has(event.pointerId))return;
    this.pointers.delete(event.pointerId);
    if(this.multitouch){
      if(!this.pointers.size){this.multitouch=false;this.pinch=null;this.viewer.ignoreClickUntil=Date.now()+400;if(this.view.scale<1.04)this.apply({scale:1,x:0,y:0},true);}
      return;
    }
    const drag=this.drag;this.drag=null;if(!drag)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    this.viewer.resetDrag();this.track.style.scrollSnapType='';this.track.style.scrollBehavior='';
    if(Math.hypot(dx,dy)<8){this.tap(event,true);this.ignoreNativeClickUntil=Date.now()+400;}
    if(drag.mode==='page'){
      const quick=Math.abs(dx)>20&&Math.abs(dx)/Math.max(1,performance.now()-drag.time)>.45;
      const moved=Math.abs(dx)>Math.min(70,this.track.clientWidth*.2)||quick;
      this.viewer.go(moved?Math.round(drag.left/this.track.clientWidth)+(dx<0?1:-1):Math.round(drag.left/this.track.clientWidth));
    }
    if(drag.mode==='dismiss'&&dy>80&&dy>Math.abs(dx)*1.3)this.viewer.callbacks.dismiss();
  }
  cancel() {
    this.pointers.clear();this.drag=null;this.pinch=null;this.multitouch=false;
    this.track.style.scrollSnapType='';this.track.style.scrollBehavior='';this.viewer.resetDrag();
    if(this.viewer.gallery)this.track.scrollTo({left:this.viewer.index*this.track.clientWidth,behavior:'instant'});
    this.viewer.ignoreClickUntil=Date.now()+300;
  }
  close(){this.cancel();this.reset();}
}

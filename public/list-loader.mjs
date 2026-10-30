export class InfiniteList {
  constructor(load,allowed) {
    this.load=load;this.allowed=allowed;this.key=null;this.budget=3;
    this.observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.target===this.node&&entry.isIntersecting))this.check();
    },{rootMargin:'0px 0px 240px'});
    const signal=()=>{
      if(!this.allowed(this.key))return;
      this.budget=3;
      if(this.frame)return;
      this.frame=requestAnimationFrame(()=>{this.frame=0;this.check();});
    };
    window.addEventListener('scroll',signal,{passive:true});
    window.addEventListener('wheel',signal,{passive:true});
    window.addEventListener('touchend',signal,{passive:true});
  }
  watch(node,key) {
    this.observer.disconnect();this.node=node;
    if(key!==this.key){this.key=key;this.budget=3;}
    if(node){this.observer.observe(node);if(!this.budget)node.textContent='继续上滑查看更多';}
  }
  check() {
    if(!this.node?.isConnected || !this.budget || !this.allowed(this.key))return;
    const box=this.node.getBoundingClientRect();
    if(box.top>innerHeight+240 || box.bottom<0)return;
    this.budget--;this.load(this.key);
  }
}

export function preloadNeighbors(current,count,radius=5) {
  const pages=[];
  for (let distance=1;distance<=radius;distance++) {
    if (current+distance<count) pages.push(current+distance);
    if (current-distance>=0) pages.push(current-distance);
  }
  return pages;
}

export class ReaderPreloader {
  constructor(count,load,onLoaded,concurrency=3) {
    this.count=count;this.load=load;this.onLoaded=onLoaded;this.concurrency=concurrency;
    this.loaded=new Map();this.active=new Map();this.queue=[];this.controller=new AbortController();
  }
  update(current) {
    if (this.controller.signal.aborted) return;
    this.queue=preloadNeighbors(current,this.count).filter(index=>!this.loaded.has(index)&&!this.active.has(index));
    this.drain();
  }
  markLoaded(index,dimensions) {
    this.loaded.set(index,dimensions);
    this.queue=this.queue.filter(page=>page!==index);
  }
  drain() {
    while (!this.controller.signal.aborted && this.active.size<this.concurrency && this.queue.length) {
      const index=this.queue.shift();
      const job=Promise.resolve().then(()=>this.load(index,this.controller.signal)).then(dimensions=>{
        if (this.controller.signal.aborted) return;
        this.markLoaded(index,dimensions);this.onLoaded(index,dimensions);
      }).catch(()=>{ /* Visible images expose retry controls; preloads do not interrupt reading. */ }).finally(()=>{
        this.active.delete(index);this.drain();
      });
      this.active.set(index,job);
    }
  }
  close() { this.queue=[];this.controller.abort(); }
}

export function readerPreference(state) {
  // Apply the new default once, then respect subsequent explicit mode changes.
  if (state.readerDefaultsVersion !== 1) { state.mode='scroll';state.readerDefaultsVersion=1; }
  return ['scroll','paged'].includes(state.mode) ? state.mode : 'scroll';
}

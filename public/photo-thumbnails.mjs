export class ThumbnailStore {
  constructor(loadPage) { this.loadPage=loadPage;this.pages=new Map();this.batches=new Map();this.listeners=new Set();this.perPage=null; }
  async batch(page) {
    if (!this.batches.has(page)) {
      const pending=this.loadPage(page).then(data=>{
        if (page===0) this.perPage=data.perPage;
        for (const thumbnail of data.pages) this.pages.set(thumbnail.index,thumbnail);
        this.listeners.forEach(listener=>listener());
        return data;
      }).catch(error=>{this.batches.delete(page);throw error;});
      this.batches.set(page,pending);
    }
    return this.batches.get(page);
  }
  async ensure(index) {
    if (this.pages.has(index)) return this.pages.get(index);
    await this.batch(0);
    const page=Math.floor(index/this.perPage);
    if (page) await this.batch(page);
    return this.pages.get(index);
  }
}

export class ThumbnailView {
  constructor(container,root,store) {
    this.container=container;this.store=store;this.visible=new Set();
    this.draw=()=>this.visible.forEach(node=>this.render(node));
    store.listeners.add(this.draw);
    // Prepare two screens around the album and one screen around the filmstrip.
    const vertical=Math.max(800,Math.round((root?.clientHeight||innerHeight)*2));
    const horizontal=Math.max(400,Math.round(root?.clientWidth||innerWidth));
    this.observer=new IntersectionObserver(entries=>{
      for (const entry of entries) if (entry.isIntersecting) {
        this.visible.add(entry.target);
        const index=Number(entry.target.dataset.thumb);
        store.ensure(index).then(()=>this.render(entry.target)).catch(()=>{entry.target.dataset.thumbError='true';});
      } else this.visible.delete(entry.target);
    },{root,rootMargin:`${vertical}px ${horizontal}px`});
    container.querySelectorAll('[data-thumb]').forEach(node=>this.observer.observe(node));
    this.resize=new ResizeObserver(entries=>entries.forEach(entry=>this.render(entry.target)));
    container.querySelectorAll('[data-thumb]').forEach(node=>this.resize.observe(node));this.draw();
  }
  render(node) {
    const thumb=this.store.pages.get(Number(node.dataset.thumb));
    if (!thumb || !this.visible.has(node) || !node.clientWidth) return;
    const signature=JSON.stringify([thumb,node.clientWidth,node.clientHeight]);
    if (node.dataset.thumbSignature===signature) return;
    node.dataset.thumbSignature=signature;delete node.dataset.thumbError;
    node.replaceChildren();
    if (thumb.sprite) {
      const sprite=document.createElement('span');sprite.className='thumb-sprite';
      Object.assign(sprite.style,{width:thumb.width+'px',height:thumb.height+'px',backgroundImage:`url(${JSON.stringify(thumb.src)})`,backgroundPosition:`${thumb.x}px ${thumb.y}px`,transform:`translate(-50%,-50%) scale(${Math.max(node.clientWidth/thumb.width,node.clientHeight/thumb.height)})`});
      node.append(sprite);
    } else {
      const image=new Image();image.src=thumb.src;image.alt='';image.decoding='async';node.append(image);
    }
    node.dataset.thumbReady='true';
  }
  close() {this.observer.disconnect();this.resize.disconnect();this.visible.clear();this.store.listeners.delete(this.draw);}
}

// A fixed body also prevents Safari from moving the list behind a dialog or reader.
// Keep one lock across overlay handoffs and restore the list only after all close.
export class BackgroundScrollLock {
  constructor() {
    this.locked = false;
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open','hidden'],childList:true});
    this.sync();
  }
  sync() {
    const overlay = document.querySelector('dialog[open], .reader:not([hidden]), .photo-viewer:not([hidden])');
    if (!!overlay === this.locked) return;
    this.locked = !!overlay;
    if (this.locked) {
      this.x = window.scrollX; this.y = window.scrollY;
      document.body.style.setProperty('--background-scroll-x',`${-this.x}px`);
      document.body.style.setProperty('--background-scroll-y',`${-this.y}px`);
      document.documentElement.classList.add('overlay-open');
    } else {
      document.documentElement.classList.remove('overlay-open');
      document.body.style.removeProperty('--background-scroll-x');
      document.body.style.removeProperty('--background-scroll-y');
      window.scrollTo({left:this.x,top:this.y,behavior:'instant'});
    }
  }
}
